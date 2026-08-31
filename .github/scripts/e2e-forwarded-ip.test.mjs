import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { e2eForwardedIp } from "./e2e-forwarded-ip.mjs";

const e2eWorkflow = readFileSync(new URL("../workflows/e2e.yml", import.meta.url), "utf8");
const topologyWorkflow = readFileSync(new URL("../workflows/e2e-shard-topology.yml", import.meta.url), "utf8");
const securityWorkflow = readFileSync(new URL("../workflows/security.yml", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../../frontend/vite.config.ts", import.meta.url), "utf8");

test("derives a stable address from the reserved benchmark range", () => {
  const value = e2eForwardedIp("shard-5-run33390478931-attempt1");
  assert.equal(value, e2eForwardedIp("shard-5-run33390478931-attempt1"));
  assert.match(value, /^2001:db8(?::[0-9a-f]{1,4}){6}$/);
});

test("isolates shards, attempts, lanes, and benchmark stages", () => {
  const namespaces = [
    "shard-5-run33390478931-attempt1",
    "shard-6-run33390478931-attempt1",
    "shard-5-run33390478931-attempt2",
    "cross-browser-webkit-run33390478931-attempt1",
    "benchmark-prebuilt-w3-5-run33390478931-attempt1",
  ];
  assert.equal(new Set(namespaces.map(e2eForwardedIp)).size, namespaces.length);
});

test("rejects absent and unbounded namespaces", () => {
  assert.throws(() => e2eForwardedIp(""), /1-240/);
  assert.throws(() => e2eForwardedIp("x".repeat(241)), /1-240/);
});

test("every Compose-backed browser lane installs its isolated proxy identity", () => {
  assert.equal((e2eWorkflow.match(/name: Allocate isolated anonymous client identity/g) ?? []).length, 3);
  assert.equal((topologyWorkflow.match(/name: Allocate isolated anonymous client identity/g) ?? []).length, 1);
  assert.equal((securityWorkflow.match(/name: Allocate isolated anonymous client identity/g) ?? []).length, 1);
  assert.match(compose, /E2E_FORWARDED_FOR: "\$\{E2E_FORWARDED_FOR:-}"/);
  assert.match(viteConfig, /"x-forwarded-for": e2eForwardedFor/);
});
