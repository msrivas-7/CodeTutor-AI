import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const RUNS_PER_PAGE = 3;
const HOST = "127.0.0.1";
const DIST_DIR = resolve("dist");
const REPORT_DIR = resolve("lhci-reports");
const gzip = promisify(gzipCallback);

const PAGES = [
  { label: "homepage", path: "/" },
  { label: "why-not-chatgpt", path: "/why-not-chatgpt" },
];

const BUDGETS = [
  { key: "performance", label: "Performance score", min: 0.85 },
  { key: "lcp", label: "Largest Contentful Paint", max: 2_500, unit: "ms" },
  { key: "cls", label: "Cumulative Layout Shift", max: 0.1 },
  { key: "tbt", label: "Total Blocking Time", max: 200, unit: "ms" },
  { key: "scriptBytes", label: "Transferred script", max: 700_000, unit: "bytes" },
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function metric(lhr, auditId) {
  const value = lhr.audits[auditId]?.numericValue;
  if (typeof value !== "number") {
    throw new Error(`Lighthouse did not produce ${auditId}`);
  }
  return value;
}

function readMetrics(lhr) {
  const script = lhr.audits["resource-summary"]?.details?.items?.find(
    (item) => item.resourceType === "script",
  );
  const performance = lhr.categories.performance?.score;

  if (
    typeof performance !== "number" ||
    typeof script?.transferSize !== "number"
  ) {
    throw new Error("Lighthouse did not produce the performance or script-size metrics");
  }

  return {
    performance,
    lcp: metric(lhr, "largest-contentful-paint"),
    cls: metric(lhr, "cumulative-layout-shift"),
    tbt: metric(lhr, "total-blocking-time"),
    scriptBytes: script.transferSize,
  };
}

async function startStaticServer() {
  const indexHtml = await readFile(resolve(DIST_DIR, "index.html"));

  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", `http://${HOST}`).pathname,
      );
      const relativePath = pathname.replace(/^\/+/, "");
      const requestedPath = resolve(DIST_DIR, relativePath);
      const isSafePath =
        requestedPath === DIST_DIR || requestedPath.startsWith(`${DIST_DIR}/`);

      if (!isSafePath) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      let body;
      let contentType;
      try {
        body = await readFile(requestedPath);
        contentType = MIME_TYPES[extname(requestedPath)] ?? "application/octet-stream";
      } catch {
        if (extname(pathname)) {
          response.writeHead(404).end("Not found");
          return;
        }
        body = indexHtml;
        contentType = MIME_TYPES[".html"];
      }

      const acceptsGzip = request.headers["accept-encoding"]?.includes("gzip");
      const isCompressible = /^(text\/|application\/(javascript|json)|image\/svg)/.test(
        contentType,
      );
      const responseBody = acceptsGzip && isCompressible ? await gzip(body) : body;

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentType,
        ...(responseBody !== body
          ? { "content-encoding": "gzip", vary: "accept-encoding" }
          : {}),
      });
      response.end(responseBody);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "Server error");
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the Lighthouse server port");
  }

  return { server, origin: `http://${HOST}:${address.port}` };
}

async function collect(url, reportPath) {
  let lastError;
  const useHeadfulChrome = process.env.LIGHTHOUSE_HEADFUL === "1";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const chrome = await launch({
      chromeFlags: [
        ...(useHeadfulChrome ? [] : ["--headless=new"]),
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=CalculateNativeWinOcclusion",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,900",
      ],
    });

    try {
      const result = await lighthouse(url, {
        logLevel: "warn",
        output: "json",
        onlyCategories: ["performance"],
        port: chrome.port,
        maxWaitForLoad: 90_000,
      });

      if (result.lhr.runtimeError) {
        throw new Error(
          `${result.lhr.runtimeError.code}: ${result.lhr.runtimeError.message}`,
        );
      }

      await writeFile(reportPath, result.report);
      return readMetrics(result.lhr);
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(`Collection failed once for ${url}; retrying with a fresh browser.`);
      }
    } finally {
      await chrome.kill();
    }
  }

  throw lastError;
}

function assertBudgets(page, runs) {
  const failures = [];
  console.log(`\n${page.label}`);

  for (const budget of BUDGETS) {
    const values = runs.map((run) => run[budget.key]);
    const value = median(values);
    const passesMin = budget.min === undefined || value >= budget.min;
    const passesMax = budget.max === undefined || value <= budget.max;
    const pass = passesMin && passesMax;
    const threshold =
      budget.min !== undefined ? `>= ${budget.min}` : `<= ${budget.max}`;

    console.log(
      `${pass ? "PASS" : "FAIL"} ${budget.label}: median ${value}${
        budget.unit ? ` ${budget.unit}` : ""
      } (${threshold}); runs ${values.join(", ")}`,
    );

    if (!pass) failures.push(`${page.label}: ${budget.label}`);
  }

  return failures;
}

async function main() {
  await rm(REPORT_DIR, { recursive: true, force: true });
  await mkdir(REPORT_DIR, { recursive: true });
  const { server, origin } = await startStaticServer();
  const failures = [];

  try {
    for (const page of PAGES) {
      const runs = [];
      for (let run = 1; run <= RUNS_PER_PAGE; run += 1) {
        const url = `${origin}${page.path}`;
        console.log(`Auditing ${page.label}, run ${run}/${RUNS_PER_PAGE}`);
        runs.push(
          await collect(url, resolve(REPORT_DIR, `${page.label}-${run}.json`)),
        );
      }
      failures.push(...assertBudgets(page, runs));
    }
  } finally {
    await new Promise((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }

  if (failures.length) {
    throw new Error(`Lighthouse budgets failed: ${failures.join("; ")}`);
  }

  console.log("\nAll Lighthouse budgets passed.");
}

await main();
