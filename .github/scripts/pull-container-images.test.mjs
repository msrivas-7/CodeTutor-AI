import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve(".github/scripts/pull-container-images.sh");
const workflow = readFileSync(resolve(".github/workflows/e2e.yml"), "utf8");
const compose = readFileSync(resolve("docker-compose.yml"), "utf8");

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "parallel-pulls-"));
  const docker = join(directory, "docker");
  const log = join(directory, "calls.log");
  writeFileSync(docker, `#!/usr/bin/env bash\necho "$2" >> "$PULL_LOG"\n[[ "$2" != "$FAIL_IMAGE" ]]\n`);
  chmodSync(docker, 0o755);
  return { directory, log };
}

test("pulls every supplied immutable image and succeeds when all pulls pass", () => {
  const { directory, log } = fixture();
  const result = spawnSync(script, ["backend@sha256:a", "runner@sha256:b", "frontend@sha256:c"], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PULL_LOG: log, FAIL_IMAGE: "" },
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").sort(), [
    "backend@sha256:a",
    "frontend@sha256:c",
    "runner@sha256:b",
  ]);
});
test("waits for every pull but fails closed when any one pull fails", () => {
  const { directory, log } = fixture();
  const result = spawnSync(script, ["backend", "runner", "frontend"], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PULL_LOG: log, FAIL_IMAGE: "runner" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr.toString(), /one or more container image pulls failed/);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").sort(), ["backend", "frontend", "runner"]);
});

test("E2E pre-pulls the pinned socket proxy and probes it faster without changing local defaults", () => {
  assert.match(workflow, /SOCKET_PROXY_IMAGE: tecnativa\/docker-socket-proxy:0\.3\.0/);
  assert.match(workflow, /SOCKET_PROXY_HEALTH_INTERVAL: "1s"/);
  assert.equal(
    workflow.match(/pull-container-images\.sh[^\n]+"\$SOCKET_PROXY_IMAGE"/g)?.length,
    3,
  );
  assert.match(compose, /image: \$\{SOCKET_PROXY_IMAGE:-tecnativa\/docker-socket-proxy:0\.3\.0}/);
  assert.match(compose, /interval: \$\{SOCKET_PROXY_HEALTH_INTERVAL:-5s}/);
});
