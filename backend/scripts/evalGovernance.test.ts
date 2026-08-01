import { describe, expect, it } from "vitest";
import { verifyEvalDatasetGovernance } from "./evalGovernance.js";

const baseManifest = {
  version: 1,
  policy: {
    trafficLane: "traffic_candidate",
    trustedLane: "repository_golden_holdout",
    directTrafficPromotionAllowed: false,
    minimumSyntheticReviewers: 2,
  },
  declarations: [
    {
      caseIds: ["g001"],
      origin: "expert-authored" as const,
      authoredContext: "expert fixture",
    },
  ],
};

describe("B8 golden holdout governance", () => {
  it("accepts explicit expert provenance", () => {
    expect(() => verifyEvalDatasetGovernance({
      cases: [{ id: "g001", userMessage: "why", userFile: "value = 1" }],
      manifest: baseManifest,
      manifestRaw: JSON.stringify(baseManifest),
    })).not.toThrow();
  });

  it("rejects direct traffic fields in the trusted manifest", () => {
    expect(() => verifyEvalDatasetGovernance({
      cases: [{ id: "g001", userMessage: "why", userFile: "value = 1" }],
      manifest: baseManifest,
      manifestRaw: JSON.stringify({ ...baseManifest, sampleId: "private" }),
    })).toThrow(/forbidden traffic field: sampleId/);
  });

  it("rejects an unknown origin instead of treating it as expert-authored", () => {
    const manifest = {
      ...baseManifest,
      declarations: [{
        caseIds: ["g001"],
        origin: "traffic" as unknown as "expert-authored",
        authoredContext: "copied traffic",
      }],
    };
    expect(() => verifyEvalDatasetGovernance({
      cases: [{ id: "g001", userMessage: "why", userFile: "value = 1" }],
      manifest,
      manifestRaw: JSON.stringify(manifest),
    })).toThrow(/origin must be expert-authored or synthetic/);
  });

  it("requires two distinct reviewers and a source fingerprint for synthetic cases", () => {
    const manifest = {
      ...baseManifest,
      declarations: [{
        caseIds: ["g001"],
        origin: "synthetic" as const,
        authoredContext: "new synthetic case",
        sourcePatternFingerprint: "a".repeat(64),
        reviewedBy: ["reviewer-a"],
        authoredAt: "2026-07-31",
        independentAuthoringAttested: true,
      }],
    };
    expect(() => verifyEvalDatasetGovernance({
      cases: [{ id: "g001", userMessage: "why", userFile: "value = 1" }],
      manifest,
      manifestRaw: JSON.stringify(manifest),
    })).toThrow(/two distinct reviewers/);
  });

  it("requires an explicit independent-authoring attestation", () => {
    const manifest = {
      ...baseManifest,
      declarations: [{
        caseIds: ["g001"],
        origin: "synthetic" as const,
        authoredContext: "new synthetic case",
        sourcePatternFingerprint: "a".repeat(64),
        reviewedBy: ["reviewer-a", "reviewer-b"],
        authoredAt: "2026-07-31",
      }],
    };
    expect(() => verifyEvalDatasetGovernance({
      cases: [{ id: "g001", userMessage: "why", userFile: "value = 1" }],
      manifest,
      manifestRaw: JSON.stringify(manifest),
    })).toThrow(/independent-authoring attestation/);
  });

  it("rejects two golden cases derived from the same sampled pattern", () => {
    const pattern = "a".repeat(64);
    const manifest = {
      ...baseManifest,
      declarations: ["g001", "g002"].map((id) => ({
        caseIds: [id],
        origin: "synthetic" as const,
        authoredContext: `new synthetic case ${id}`,
        sourcePatternFingerprint: pattern,
        reviewedBy: ["reviewer-a", "reviewer-b"],
        authoredAt: "2026-07-31",
        independentAuthoringAttested: true,
      })),
    };
    expect(() => verifyEvalDatasetGovernance({
      cases: [
        { id: "g001", userMessage: "why", userFile: "value = 1" },
        { id: "g002", userMessage: "how", userFile: "value = 2" },
      ],
      manifest,
      manifestRaw: JSON.stringify(manifest),
    })).toThrow(/reuses source pattern/);
  });

  it("rejects missing provenance and duplicate learner content", () => {
    expect(() => verifyEvalDatasetGovernance({
      cases: [
        { id: "g001", userMessage: "same", userFile: "same" },
        { id: "g002", userMessage: "same", userFile: "same" },
      ],
      manifest: baseManifest,
      manifestRaw: JSON.stringify(baseManifest),
    })).toThrow(/missing provenance|duplicates learner content/);
  });
});
