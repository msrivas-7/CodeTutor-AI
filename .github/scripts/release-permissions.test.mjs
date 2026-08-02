import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflowUrl = new URL("../workflows/release.yml", import.meta.url);

test("the release caller grants every permission requested by its reusable E2E gate", async () => {
  const releaseWorkflow = await readFile(releaseWorkflowUrl, "utf8");
  const topLevelPermissions = releaseWorkflow.match(
    /^permissions:\n(?<body>(?: {2}[^\n]+\n)+)/m,
  )?.groups?.body;

  assert.ok(topLevelPermissions, "release.yml must declare top-level permissions");
  assert.match(
    topLevelPermissions,
    /^ {2}pull-requests: read$/m,
    "release.yml calls e2e.yml, which requests pull-requests: read",
  );
});

test("a test-only follow-up can explicitly promote the complete tested candidate", async () => {
  const releaseWorkflow = await readFile(releaseWorkflowUrl, "utf8");

  assert.match(
    releaseWorkflow,
    /^ {2}workflow_dispatch:\n {4}inputs:\n {6}force_promote_all:/m,
    "release.yml must expose an explicit recovery control after a failed promotion",
  );
  for (const artifact of ["backend", "runner", "frontend"]) {
    assert.match(
      releaseWorkflow,
      new RegExp(
        `^ {6}${artifact}: \\\${{ \\(github\\.event_name == 'workflow_dispatch' && inputs\\.force_promote_all\\) \\|\\| steps\\.filter\\.outputs\\.${artifact} }}$`,
        "m",
      ),
      `force_promote_all must override the detected ${artifact} scope`,
    );
  }
});
