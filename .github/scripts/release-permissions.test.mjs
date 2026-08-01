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
