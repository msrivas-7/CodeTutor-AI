import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectPackageVersions } from "./ghcr-retention.mjs";

const versions = [
  {
    id: 3,
    updated_at: "2026-08-31T12:00:00Z",
    metadata: { container: { tags: ["run-300"] } },
  },
  {
    id: 2,
    updated_at: "2026-08-28T12:00:00Z",
    metadata: { container: { tags: ["run-200", "shared"] } },
  },
  {
    id: 1,
    updated_at: "2026-08-20T12:00:00Z",
    metadata: { container: { tags: [] } },
  },
];

test("exact-tag cleanup cannot select adjacent or untagged versions", () => {
  assert.deepEqual(
    selectPackageVersions(versions, { tag: "run-200" }).map((version) => version.id),
    [2],
  );
});

test("retention removes only expired versions outside the newest safety window", () => {
  assert.deepEqual(
    selectPackageVersions(versions, {
      olderThanMs: 48 * 60 * 60 * 1000,
      keepNewest: 1,
      now: Date.parse("2026-08-31T13:00:00Z"),
    }).map((version) => version.id),
    [2, 1],
  );
});

test("retention protects the newest requested versions even when all are old", () => {
  assert.deepEqual(
    selectPackageVersions(versions, {
      olderThanMs: 0,
      keepNewest: 2,
      now: Date.parse("2026-09-01T00:00:00Z"),
    }).map((version) => version.id),
    [1],
  );
});

test("blocking E2E adopts digest reuse but cleans images only after retry-safe success", async () => {
  const workflow = await readFile(
    new URL("../workflows/e2e.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: Prepare backend E2E image/);
  assert.match(workflow, /name: Prepare runner E2E image/);
  assert.match(workflow, /name: Prepare frontend E2E image/);
  assert.match(workflow, /FRONTEND_IMAGE: \$\{\{ needs\.prepare-frontend\.outputs\.ref \}\}/);
  assert.match(workflow, /docker compose up -d --no-build backend frontend/);
  assert.match(workflow, /needs\.e2e\.result == 'success'/);
  assert.match(workflow, /needs\.cross-browser-core\.result == 'success'/);
  assert.match(workflow, /--tag "\$RUN_TAG" --require-match/);
});

test("scheduled retention preserves one fallback and bounds stale versions", async () => {
  const workflow = await readFile(
    new URL("../workflows/e2e-image-retention.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /--older-than-hours 48/);
  assert.match(workflow, /--keep-newest 1/);
  assert.match(workflow, /packages: write/);
});
