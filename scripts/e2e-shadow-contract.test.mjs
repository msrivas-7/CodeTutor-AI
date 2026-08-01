import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateShadowContract } from "./e2e-shadow-contract.mjs";

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-shadow-contract-"));
  fs.mkdirSync(path.join(rootDir, "frontend"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "frontend", "unit.test.ts"), 'it("catches lower defect", () => {})\n');
  const tags = [
    "lane:critical",
    "risk:p0",
    "owner:security",
    "browser:chromium",
    "device:desktop",
    "quarantine:none",
  ];
  const annotations = ["risk", "owner", "browser", "device", "quarantine"].map((type) => ({
    type,
    description:
      type === "risk"
        ? "p0"
        : type === "owner"
          ? "security"
          : type === "browser"
            ? "chromium"
            : type === "device"
              ? "desktop"
              : "none",
  }));
  const inventory = {
    suites: [
      {
        title: "critical.spec.ts",
        suites: [
          {
            title: "critical group",
            specs: Array.from({ length: 2 }, (_, index) => ({
              title: `catches browser defect ${index}`,
              file: "critical.spec.ts",
              tags,
              tests: [{ annotations, expectedStatus: "passed" }],
            })),
          },
        ],
      },
    ],
  };
  const corpus = {
    schemaVersion: 1,
    frozenAt: "2026-07-30",
    criticalLane: { minimumTests: 2, minimumFiles: 1 },
    entries: [
      {
        id: "browser-defect",
        severity: "p0",
        source: "historical",
        originatingDefect: "Browser defect",
        expectedCatchingLayer: {
          kind: "critical-browser",
          file: "critical.spec.ts",
          titleIncludes: "catches browser defect",
        },
      },
      {
        id: "lower-defect",
        severity: "p1",
        source: "seeded",
        originatingDefect: "Lower defect",
        expectedCatchingLayer: {
          kind: "lower-layer",
          file: "frontend/unit.test.ts",
          testIncludes: "catches lower defect",
        },
      },
    ],
  };
  return { rootDir, inventory, corpus };
}

test("accepts a complete critical inventory and frozen corpus", () => {
  const data = fixture();
  assert.deepEqual(validateShadowContract(data), {
    tests: 2,
    files: 1,
    corpusEntries: 2,
    migrationPilots: 0,
  });
});

test("rejects missing source-owned metadata", () => {
  const data = fixture();
  data.inventory.suites[0].suites[0].specs[0].tags = ["lane:critical"];
  assert.throws(() => validateShadowContract(data), /missing risk metadata/);
});

test("rejects active quarantine in the critical lane", () => {
  const data = fixture();
  data.inventory.suites[0].suites[0].specs[0].tags = data.inventory.suites[0].suites[0].specs[0].tags.map(
    (tag) => (tag === "quarantine:none" ? "quarantine:active" : tag),
  );
  assert.throws(() => validateShadowContract(data), /cannot contain active quarantine/);
});

test("rejects a frozen regression without a catching anchor", () => {
  const data = fixture();
  data.corpus.entries[0].expectedCatchingLayer.titleIncludes = "missing browser proof";
  assert.throws(() => validateShadowContract(data), /no critical browser test matches/);
});

test("rejects tags and annotations that disagree", () => {
  const data = fixture();
  data.inventory.suites[0].suites[0].specs[0].tests[0].annotations[0].description = "p1";
  assert.throws(() => validateShadowContract(data), /risk annotation does not match/);
});
