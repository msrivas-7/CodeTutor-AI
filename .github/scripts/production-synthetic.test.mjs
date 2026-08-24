import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(
  new URL("../workflows/production-synthetic.yml", import.meta.url),
  "utf8",
);

test("production synthetic incident commands bind to the triggering repository", () => {
  const incidentStep = workflow.match(
    /- name: Open an actionable incident issue[\s\S]*$/,
  )?.[0];

  assert.ok(incidentStep, "incident-creation step must remain present");
  assert.match(
    incidentStep,
    /gh issue list --repo "\$GITHUB_REPOSITORY"/,
    "issue lookup must not depend on a checked-out git repository",
  );
  assert.match(
    incidentStep,
    /gh issue create \\\n\s+--repo "\$GITHUB_REPOSITORY" \\/,
    "issue creation must not depend on a checked-out git repository",
  );
  assert.match(
    workflow,
    /permissions:\n\s+contents: read\n\s+issues: write/,
    "the workflow token must retain issue-write permission",
  );
});

test("production synthetic exposes an operator-only controlled incident drill", () => {
  assert.match(
    workflow,
    /workflow_dispatch:\n\s+inputs:\n\s+incident_drill:/,
    "workflow_dispatch must expose the controlled drill input",
  );
  assert.match(
    workflow,
    /- name: Exercise incident automation\n\s+if: github\.event_name == 'workflow_dispatch' && inputs\.incident_drill/,
    "the deliberate failure must be unreachable from scheduled runs",
  );
  assert.match(
    workflow,
    /Production was not reported unhealthy by this drill\./,
    "the incident must distinguish an operator drill from a detected outage",
  );
});

test("production synthetic incident step runs without a git checkout", () => {
  const runBlock = workflow.match(
    /      - name: Open an actionable incident issue[\s\S]*?        run: \|\n([\s\S]*)$/,
  )?.[1];
  assert.ok(runBlock, "incident run block must remain extractable");
  const script = runBlock
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");

  const sandbox = mkdtempSync(path.join(tmpdir(), "codetutor-synthetic-test-"));
  const ghLog = path.join(sandbox, "gh.log");
  const fakeGh = path.join(sandbox, "gh");
  writeFileSync(
    fakeGh,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_LOG"\nexit 0\n',
  );
  chmodSync(fakeGh, 0o755);

  try {
    const result = spawnSync("bash", ["-c", script], {
      cwd: sandbox,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${sandbox}:${process.env.PATH ?? ""}`,
        GH_LOG: ghLog,
        GH_TOKEN: "test-token",
        INCIDENT_DRILL: "false",
        GITHUB_REPOSITORY: "msrivas-7/CodeTutor-AI",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_RUN_ID: "12345",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = readFileSync(ghLog, "utf8");
    assert.match(
      calls,
      /issue list --repo msrivas-7\/CodeTutor-AI/,
      "deduplication must resolve the explicit repository",
    );
    assert.match(
      calls,
      /issue create --repo msrivas-7\/CodeTutor-AI/,
      "incident creation must resolve the explicit repository",
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
