import { describe, expect, it } from "vitest";
import {
  MEMORY_REFRESH_DAYS,
  classifyConceptMemory,
} from "./conceptMemory.js";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const day = (value: string) => `${value}T10:00:00.000Z`;

function aggregate(
  overrides: Partial<Parameters<typeof classifyConceptMemory>[0]> = {},
): Parameters<typeof classifyConceptMemory>[0] {
  return {
    conceptTag: "loops",
    firstExposedAt: null,
    lastExposedAt: null,
    firstEvidenceAt: null,
    lastEvidenceAt: null,
    lastRetrievalAt: null,
    practiceCount: 0,
    supportedRetrievalCount: 0,
    independentRetrievalDays: [],
    ...overrides,
  };
}

describe("classifyConceptMemory", () => {
  it("keeps recent exposure at encountered without asking for immediate recall", () => {
    const memory = classifyConceptMemory(
      aggregate({
        firstExposedAt: day("2026-07-29"),
        lastExposedAt: day("2026-07-29"),
      }),
      NOW,
    );

    expect(memory.state).toBe("encountered");
    expect(memory.independentRetrievalCount).toBe(0);
    expect(memory.refreshDue).toBe(false);
  });

  it("never asks about unseen material and spaces first recall from exposure", () => {
    const unseen = classifyConceptMemory(aggregate(), NOW);
    const oldExposure = classifyConceptMemory(
      aggregate({
        firstExposedAt: day("2026-07-20"),
        lastExposedAt: day("2026-07-25"),
      }),
      NOW,
    );

    expect(unseen).toMatchObject({ state: "unseen", refreshDue: false });
    expect(oldExposure).toMatchObject({
      state: "encountered",
      refreshDue: true,
    });
  });

  it("treats practice and retrieval after feedback as supported, not independent", () => {
    const memory = classifyConceptMemory(
      aggregate({
        firstExposedAt: day("2026-07-20"),
        lastExposedAt: day("2026-07-20"),
        lastEvidenceAt: day("2026-07-30"),
        lastRetrievalAt: day("2026-07-30"),
        practiceCount: 3,
        supportedRetrievalCount: 1,
      }),
      NOW,
    );

    expect(memory.state).toBe("practiced");
    expect(memory.refreshDue).toBe(false);
  });

  it("marks one first-attempt retrieval as remembered", () => {
    const memory = classifyConceptMemory(
      aggregate({
        firstExposedAt: day("2026-07-20"),
        lastExposedAt: day("2026-07-20"),
        lastEvidenceAt: day("2026-07-29"),
        lastRetrievalAt: day("2026-07-29"),
        independentRetrievalDays: ["2026-07-29"],
      }),
      NOW,
    );

    expect(memory.state).toBe("remembered");
    expect(memory.independentRetrievalCount).toBe(1);
    expect(memory.refreshDue).toBe(false);
  });

  it("requires independent retrievals spaced by the full refresh interval for retained", () => {
    const tooClose = classifyConceptMemory(
      aggregate({
        lastRetrievalAt: day("2026-07-30"),
        independentRetrievalDays: ["2026-07-27", "2026-07-30"],
      }),
      NOW,
    );
    const spaced = classifyConceptMemory(
      aggregate({
        lastRetrievalAt: day("2026-07-30"),
        independentRetrievalDays: ["2026-07-20", "2026-07-25", "2026-07-30"],
      }),
      NOW,
    );

    expect(MEMORY_REFRESH_DAYS).toBe(5);
    expect(tooClose.state).toBe("remembered");
    expect(spaced.state).toBe("retained");
  });

  it("makes retrieval due at five days but not one millisecond earlier", () => {
    const beforeBoundary = classifyConceptMemory(
      aggregate({
        lastRetrievalAt: new Date(NOW.getTime() - 5 * 86_400_000 + 1),
        independentRetrievalDays: ["2026-07-25"],
      }),
      NOW,
    );
    const atBoundary = classifyConceptMemory(
      aggregate({
        lastRetrievalAt: new Date(NOW.getTime() - 5 * 86_400_000),
        independentRetrievalDays: ["2026-07-25"],
      }),
      NOW,
    );

    expect(beforeBoundary.refreshDue).toBe(false);
    expect(atBoundary.refreshDue).toBe(true);
  });

  it("anchors refresh to newer practice instead of an older retrieval", () => {
    const memory = classifyConceptMemory(
      aggregate({
        lastRetrievalAt: day("2026-07-24"),
        independentRetrievalDays: ["2026-07-24"],
        lastEvidenceAt: day("2026-07-30"),
        practiceCount: 2,
      }),
      NOW,
    );

    expect(memory.state).toBe("remembered");
    expect(memory.refreshDue).toBe(false);
  });
});
