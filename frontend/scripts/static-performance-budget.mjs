import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

const gzip = promisify(gzipCallback);
const DIST_DIR = resolve("dist");
const ASSET_DIR = resolve(DIST_DIR, "assets");

const BUDGETS = {
  allScripts: 700_000,
  largestScript: 120_000,
  allStyles: 100_000,
  indexHtml: 10_000,
};

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }

  return files;
}

async function compressedSize(path) {
  return (await gzip(await readFile(path))).byteLength;
}

function assertMaximum(label, value, maximum, failures) {
  const pass = value <= maximum;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}: ${value} bytes (<= ${maximum})`);
  if (!pass) failures.push(`${label}: ${value} > ${maximum}`);
}

async function main() {
  const assets = await filesUnder(ASSET_DIR);
  const scripts = assets.filter((path) => extname(path) === ".js");
  const styles = assets.filter((path) => extname(path) === ".css");
  const scriptSizes = await Promise.all(scripts.map(compressedSize));
  const styleSizes = await Promise.all(styles.map(compressedSize));
  const indexHtml = await readFile(resolve(DIST_DIR, "index.html"), "utf8");
  const failures = [];

  assertMaximum(
    "all shipped JavaScript (gzip)",
    scriptSizes.reduce((sum, size) => sum + size, 0),
    BUDGETS.allScripts,
    failures,
  );
  assertMaximum(
    "largest JavaScript chunk (gzip)",
    Math.max(0, ...scriptSizes),
    BUDGETS.largestScript,
    failures,
  );
  assertMaximum(
    "all shipped CSS (gzip)",
    styleSizes.reduce((sum, size) => sum + size, 0),
    BUDGETS.allStyles,
    failures,
  );
  assertMaximum(
    "index HTML (gzip)",
    (await gzip(indexHtml)).byteLength,
    BUDGETS.indexHtml,
    failures,
  );

  const preloadsMonaco = /modulepreload[^>]+(?:monaco|editor)/i.test(indexHtml);
  console.log(`${preloadsMonaco ? "FAIL" : "PASS"} public entry avoids Monaco/editor preloads`);
  if (preloadsMonaco) failures.push("public entry preloads Monaco/editor code");

  if (failures.length) {
    throw new Error(`Production asset budgets failed: ${failures.join("; ")}`);
  }

  console.log("All production asset budgets passed.");
}

await main();
