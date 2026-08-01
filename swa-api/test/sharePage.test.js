import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSharePageHandler,
  escapeHtml,
  handleSharePage,
  renderShareHtml,
  resolveOrigin,
  signPreviewHeaders,
} from "../src/sharePage.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../../contracts/share-preview-auth-v1.json", import.meta.url),
    "utf8",
  ),
);
const vectorSecret = Buffer.from(
  Array.from(
    { length: vector.secretRecipe.length },
    (_, index) => vector.secretRecipe.start + index,
  ),
).toString("base64");

const previewDto = {
  schemaVersion: 1,
  lessonTitle: "Hello, Python!",
  lessonOrder: 1,
  courseTitle: "Python Fundamentals",
  mastery: "strong",
  timeSpentMs: 180_000,
  attemptCount: 1,
  displayName: "Maya",
  ogImageUrl: "https://images.example/share.png",
};

function request(token = "abc234def567") {
  return {
    params: { token },
    headers: new Headers({ host: "codetutor.msrivas.com" }),
    url: `https://codetutor.msrivas.com/api/share/${token}`,
  };
}

test("escapes untrusted share fields", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("renders crawler metadata and a canonical interactive destination", () => {
  const html = renderShareHtml(
    {
      shareToken: "abc123token",
      displayName: "Maya",
      lessonTitle: "Hello, Python!",
      lessonOrder: 1,
      courseTitle: "Python Fundamentals",
      mastery: "strong",
      timeSpentMs: 180_000,
      attemptCount: 1,
      ogImageUrl: "https://images.example/share.png",
    },
    "https://codetutor.example",
  );

  assert.match(html, /<meta property="og:title" content="Maya completed Hello, Python! \| CodeTutor">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/images\.example\/share\.png">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/codetutor\.example\/s\/abc123token">/);
  assert.match(html, /Completed confidently in 3 minutes · 1 attempt/);
  assert.doesNotMatch(html, /Strong mastery/);
});

test("does not trust a malformed forwarded host", () => {
  const request = new Request("https://safe.example/api/share/abc", {
    headers: { "x-forwarded-host": 'bad.example\"><script>alert(1)</script>' },
  });
  assert.equal(resolveOrigin(request), "https://codetutor.msrivas.com");
});

test("uses the SWA disguised host instead of the internal Functions URL", () => {
  const request = new Request(
    "https://internal-function.azurewebsites.net/api/share/abc",
    {
      headers: {
        "disguised-host":
          "gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net",
        "x-appservice-proto": "https",
      },
    },
  );
  assert.equal(
    resolveOrigin(request),
    "https://gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net",
  );
});

test("accepts an Azure original URL when no public host header is present", () => {
  const request = new Request(
    "https://internal-function.azurewebsites.net/api/share/abc",
    {
      headers: {
        "x-ms-original-url":
          "https://gentle-flower-093ba7e0f.azurestaticapps.net/api/share/abc",
      },
    },
  );
  assert.equal(
    resolveOrigin(request),
    "https://gentle-flower-093ba7e0f.azurestaticapps.net",
  );
});

test("rejects a syntactically valid but untrusted host", () => {
  const request = new Request(
    "https://internal-function.azurewebsites.net/api/share/abc",
    { headers: { host: "attacker.example" } },
  );
  assert.equal(resolveOrigin(request), "https://codetutor.msrivas.com");
});

test("rejects tokens outside the public 12-character alphabet before fetching", async () => {
  const result = await handleSharePage({
    params: { token: "../../secrets" },
    headers: new Headers(),
    url: "https://codetutor.example/api/share/../../secrets",
  });
  assert.equal(result.status, 404);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("escapes untrusted learner content throughout the document", () => {
  const html = renderShareHtml(
    {
      shareToken: "abc234def567",
      displayName: "</script><script>alert(1)</script>",
      lessonTitle: "<img src=x onerror=alert(1)>",
      lessonOrder: 1,
      courseTitle: "Python <script>",
      mastery: "okay",
      timeSpentMs: 0,
      attemptCount: 0,
      ogImageUrl: "https://images.example/share.png",
    },
    "https://codetutor.example/path-is-discarded",
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /https:\/\/codetutor\.example\/s\/abc234def567/);
  assert.match(html, /1 attempt/);
});

test("matches the backend HMAC v1 signing vector", () => {
  const headers = signPreviewHeaders({
    token: vector.canonicalPath.split("/").at(-1),
    keyId: vector.keyId,
    secret: vectorSecret,
    timestamp: vector.timestamp,
    nonce: vector.nonce,
  });
  assert.equal(
    headers["x-codetutor-preview-signature"],
    vector.signatureBase64Url,
  );
});

test("uses only the authenticated non-counting preview endpoint", async () => {
  const calls = [];
  const handler = createSharePageHandler({
    apiBaseUrl: "https://backend.example",
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => Number(vector.timestamp) * 1000,
    nonceFactory: () => vector.nonce,
    readinessRetryDelayMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(previewDto);
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers["x-codetutor-preview-state"], "full");
  assert.equal(result.headers["x-codetutor-preview-cache"], "miss");
  assert.match(result.body, /Maya completed Hello, Python!/);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://backend.example/api/internal/share-previews/abc234def567",
  );
  assert.doesNotMatch(calls[0].url, /\/api\/shares\//);
  assert.equal(
    calls[0].init.headers["x-codetutor-preview-signature"],
    vector.signatureBase64Url,
  );
});

test("coalesces concurrent crawler requests and serves a bounded cache", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let fetches = 0;
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => Number(vector.timestamp) * 1000,
    readinessRetryDelayMs: 0,
    fetchImpl: async () => {
      fetches += 1;
      await gate;
      return Response.json(previewDto);
    },
  });
  const first = handler(request());
  const second = handler(request());
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.deepEqual(
    new Set([
      a.headers["x-codetutor-preview-cache"],
      b.headers["x-codetutor-preview-cache"],
    ]),
    new Set(["miss", "coalesced"]),
  );
  const cached = await handler(request());
  assert.equal(cached.headers["x-codetutor-preview-cache"], "hit");
  assert.equal(
    cached.headers["cache-control"],
    "public, max-age=30, must-revalidate",
  );
  assert.equal(fetches, 1);
});

test("expires positive cache quickly enough for revocation to take effect", async () => {
  let now = Number(vector.timestamp) * 1000;
  let fetches = 0;
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => now,
    positiveTtlMs: 30_000,
    readinessRetryDelayMs: 0,
    fetchImpl: async () => {
      fetches += 1;
      return fetches === 1
        ? Response.json(previewDto)
        : Response.json({ error: "share not found" }, { status: 404 });
    },
  });
  assert.equal((await handler(request())).status, 200);
  now += 29_999;
  assert.equal((await handler(request())).status, 200);
  assert.equal(fetches, 1);
  now += 2;
  assert.equal((await handler(request())).status, 404);
  assert.equal(fetches, 2);
});

test("negative-caches unknown tokens without confirming them as real shares", async () => {
  let fetches = 0;
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => Number(vector.timestamp) * 1000,
    readinessRetryDelayMs: 0,
    fetchImpl: async () => {
      fetches += 1;
      return Response.json({ error: "share not found" }, { status: 404 });
    },
  });
  const first = await handler(request());
  const second = await handler(request());
  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
  assert.equal(second.headers["x-codetutor-preview-cache"], "hit");
  assert.equal(fetches, 1);
});

test("treats an older backend's HTML 404 as safe deployment degradation", async () => {
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => Number(vector.timestamp) * 1000,
    readinessRetryDelayMs: 0,
    log: () => {},
    fetchImpl: async () =>
      new Response("Cannot GET /api/internal/share-previews/token", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers["x-codetutor-preview-state"], "degraded");
  assert.match(result.body, /A CodeTutor learner shared a coding win/);
});

test("degrades safely and never falls back to the public reader endpoint", async () => {
  for (const response of [
    Response.json({ error: "no" }, { status: 401 }),
    Response.json({ error: "slow down" }, { status: 429 }),
    Response.json({ error: "down" }, { status: 503 }),
    Response.json({ ...previewDto, codeSnippet: "must be rejected" }),
  ]) {
    const urls = [];
    const handler = createSharePageHandler({
      keyId: vector.keyId,
      secret: vectorSecret,
      now: () => Number(vector.timestamp) * 1000,
      readinessRetryDelayMs: 0,
      log: () => {},
      fetchImpl: async (url) => {
        urls.push(String(url));
        return response.clone();
      },
    });
    const result = await handler(request());
    assert.equal(result.status, 200);
    assert.equal(result.headers["x-codetutor-preview-state"], "degraded");
    assert.match(result.body, /A CodeTutor learner shared a coding win/);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes("/api/internal/share-previews/"));
    assert.ok(!urls[0].includes("/api/shares/"));
  }

  const urls = [];
  const timeoutHandler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => Number(vector.timestamp) * 1000,
    readinessRetryDelayMs: 0,
    log: () => {},
    fetchImpl: async (url) => {
      urls.push(String(url));
      throw new DOMException("timed out", "TimeoutError");
    },
  });
  const timedOut = await timeoutHandler(request());
  assert.equal(timedOut.status, 200);
  assert.equal(timedOut.headers["x-codetutor-preview-state"], "degraded");
  assert.equal(urls.length, 1);
  assert.ok(!urls[0].includes("/api/shares/"));
});

test("opens a short circuit after sustained upstream failures", async () => {
  let now = Number(vector.timestamp) * 1000;
  let fetches = 0;
  const logs = [];
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    now: () => now,
    degradedTtlMs: 0,
    circuitFailureThreshold: 3,
    readinessRetryDelayMs: 0,
    log: (event) => logs.push(event),
    fetchImpl: async () => {
      fetches += 1;
      return Response.json({ error: "down" }, { status: 503 });
    },
  });
  for (const token of ["abc234def567", "bcd345efg678", "cde456fgh789"]) {
    assert.equal((await handler(request(token))).status, 200);
  }
  assert.equal(fetches, 3);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].evt, "share_preview_circuit_open");
  assert.equal((await handler(request("def567ghj892"))).status, 200);
  assert.equal(fetches, 3);
  now += 10_001;
  assert.equal((await handler(request("efg678hjk923"))).status, 200);
  assert.equal(fetches, 4);
});

test("fails closed to generic metadata when the adapter credential is absent", async () => {
  let fetches = 0;
  const handler = createSharePageHandler({
    fetchImpl: async () => {
      fetches += 1;
      return Response.json(previewDto);
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers["x-codetutor-preview-state"], "degraded");
  assert.equal(fetches, 0);
});

test("adapter kill switch serves generic metadata without touching the backend", async () => {
  let fetches = 0;
  const handler = createSharePageHandler({
    keyId: vector.keyId,
    secret: vectorSecret,
    previewDisabled: true,
    fetchImpl: async () => {
      fetches += 1;
      return Response.json(previewDto);
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers["x-codetutor-preview-state"], "degraded");
  assert.equal(result.headers["x-codetutor-preview-cache"], "bypass");
  assert.match(result.body, /A CodeTutor learner shared a coding win/);
  assert.equal(fetches, 0);
});
