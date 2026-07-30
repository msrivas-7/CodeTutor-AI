import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, handleSharePage, renderShareHtml, resolveOrigin } from "../src/sharePage.js";

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
