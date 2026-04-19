// One-time (or on-change) serializer for the __dev__ profile seeds. Writes
// each profile's seedStorage() output to e2e/fixtures/seeds/<id>.json so
// Playwright tests can deterministically hydrate localStorage without having
// to click through the UI.
//
// Run this whenever frontend/src/__dev__/profiles.ts changes. Committed seed
// files are the source of truth for tests; drift between them and the module
// would show up in the test run + code review.
//
// Usage:  cd e2e && npm run dump-seeds

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { PROFILES } from "../../frontend/src/__dev__/profiles.ts";

const OUT_DIR = path.resolve(__dirname, "../fixtures/seeds");
mkdirSync(OUT_DIR, { recursive: true });

for (const profile of PROFILES) {
  const seed = profile.seedStorage();
  const outPath = path.join(OUT_DIR, `${profile.id}.json`);
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
  // eslint-disable-next-line no-console
  console.log(`wrote ${profile.id} (${Object.keys(seed).length} keys)`);
}

// Also emit an empty baseline for tests that want a clean slate.
writeFileSync(path.join(OUT_DIR, "empty.json"), "{}\n");
// eslint-disable-next-line no-console
console.log("wrote empty (baseline)");
