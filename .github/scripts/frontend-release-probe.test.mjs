import assert from "node:assert/strict";
import test from "node:test";

import { waitForFrontendRelease } from "./frontend-release-probe.mjs";

const expectedSha = "a".repeat(40);
const staleSha = "b".repeat(40);

function response(body, { status = 200 } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

test("polls unique cache-busted URLs until the exact candidate propagates", async () => {
  const urls = [];
  const sleeps = [];
  const observations = [];
  const replies = [
    response({ gitSha: staleSha }),
    response({ gitSha: expectedSha, workflowRunId: "123" }),
  ];

  const release = await waitForFrontendRelease({
    url: "https://codetutor.example/release.json",
    expectedSha,
    attempts: 3,
    delayMs: 1,
    timeoutMs: 10,
    now: () => 1000,
    fetchImpl: async (url, options) => {
      urls.push({ url: url.toString(), cacheControl: options.headers["cache-control"] });
      return replies.shift();
    },
    sleepImpl: async (delay) => sleeps.push(delay),
    onAttempt: (observation) => observations.push(observation),
  });

  assert.equal(release.gitSha, expectedSha);
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0].url, urls[1].url);
  assert.match(urls[0].url, new RegExp(`candidate=${expectedSha}`));
  assert.deepEqual(urls.map(({ cacheControl }) => cacheControl), ["no-cache", "no-cache"]);
  assert.deepEqual(sleeps, [1]);
  assert.deepEqual(observations.map(({ matched }) => matched), [false, true]);
});

test("retries transport, HTTP, and malformed payload failures within one bound", async () => {
  const replies = [
    new Error("network unavailable"),
    response("unavailable", { status: 503 }),
    response("not-json"),
  ];
  const observations = [];

  await assert.rejects(
    waitForFrontendRelease({
      url: "https://codetutor.example/release.json",
      expectedSha,
      attempts: 3,
      delayMs: 1,
      timeoutMs: 10,
      fetchImpl: async () => {
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      },
      sleepImpl: async () => {},
      onAttempt: ({ observation }) => observations.push(observation),
    }),
    /after 3 cache-busted probes; last observation: invalid JSON/,
  );
  assert.deepEqual(observations, ["network unavailable", "HTTP 503", "invalid JSON"]);
});

test("rejects partial SHAs and invalid retry bounds", async () => {
  await assert.rejects(
    waitForFrontendRelease({
      url: "https://codetutor.example/release.json",
      expectedSha: "abc123",
      attempts: 1,
      delayMs: 1,
      timeoutMs: 1,
    }),
    /full lowercase Git SHA/,
  );
  await assert.rejects(
    waitForFrontendRelease({
      url: "https://codetutor.example/release.json",
      expectedSha,
      attempts: 0,
      delayMs: 1,
      timeoutMs: 1,
    }),
    /attempts must be a positive integer/,
  );
});
