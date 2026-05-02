// Phase 27 §3e — prompt regression v0 for buildSituationBlock.
//
// The hint-ladder logic + escalation rules (situation.ts) shape every
// tutor reply. A subtle copy edit ("favour 'explain' over new hints" →
// "prefer 'explain'") changes how the model behaves; without a
// regression net, those edits land in PRs invisible to review.
//
// This is a CHANGE-DETECTION test, not a quality test. Each fixture
// pins the exact output of buildSituationBlock for a known input.
// When situation.ts is edited intentionally, the snapshots fail — the
// developer reruns with `vitest -u` to re-capture, and the resulting
// diff makes the prompt change visible in the PR. Unintended edits
// (a typo, a stale phrase, a copy regression) fail loudly.
//
// Fixtures span the state space:
//   1. Canonical: fresh first turn — empty history, neutral question.
//      The full prose snapshot serves as the prompt-drift canary; if
//      ANY static text in situation.ts changes, this fixture's diff
//      tells you exactly what.
//   2-8. Variations on history, stuck-signal, and activity counters.
//      These pin the input → output mapping (counter values, boolean
//      flags). A bug like "stuck always reports false" or "runs
//      counter always 0" would trip these.

import { describe, it, expect } from "vitest";
import { buildSituationBlock } from "./situation.js";
import type { AIMessage } from "../provider.js";

const NEUTRAL_QUESTION = "Why does this print Hello, World!?";

// Canonical baseline: zero history, neutral question, no activity.
// Used as the dynamic-line reference across other fixtures.
const BASELINE: Parameters<typeof buildSituationBlock>[0] = {
  history: [],
  question: NEUTRAL_QUESTION,
};

const ASSIST = (content: string): AIMessage => ({ role: "assistant", content });
const USER = (content: string): AIMessage => ({ role: "user", content });

describe("buildSituationBlock — prompt regression v0", () => {
  // Canonical full-prose snapshot. The static text below is the
  // single source of truth for the prompt's static skeleton; an
  // unintended edit anywhere in situation.ts's template lights this
  // up. (Other fixtures only assert on dynamic-line content to
  // avoid 8x snapshot churn on static-prose changes.)
  it("canonical: fresh first turn, neutral question, no activity", () => {
    expect(buildSituationBlock(BASELINE)).toMatchInlineSnapshot(`
      "SITUATION:
      - Prior tutor turns in this conversation: 0
      - Student signalled being stuck: false
      - Runs since last tutor turn: 0
      - Edits since last tutor turn: 0

      Use activity counters to calibrate tone:
      - Zero edits AND zero runs after a prior tutor turn → the student is probably
        re-reading or confused; favour "explain"/clarification over new hints.
      - High edits AND high runs with the same failure → experimentation isn't
        working; escalate hints sooner.

      For intent="debug", calibrate escalation using SITUATION:
      - 0 prior turns AND not stuck → fill "diagnose" + "checkQuestions" only; leave "hint",
        "nextStep", "strongerHint" null. Let the student think first.
      - Prior turns > 0 AND not stuck → may add "hint" (small nudge) and/or "nextStep".
        Leave "strongerHint" null unless the student explicitly said they're stuck.
      - Stuck = true → fill "hint", "nextStep", AND "strongerHint". Strongest hint still
        points at the location, never the replacement code.

      STUCKNESS (emit in the "stuckness" field, one of "low" | "medium" | "high" | null):
      - "low" → student is making progress (fresh question or obvious follow-up).
      - "medium" → two+ follow-ups on the same issue, or edits+runs+still-failing without
        explicit frustration.
      - "high" → student said they're stuck OR three+ unsuccessful runs on the same
        symptom OR repeating a question we already answered. When you emit "high" you
        MUST also fill "strongerHint".
      - Leave null if it's a first turn with no prior context."
    `);
  });

  // Per-fixture: assert on the four dynamic lines that vary with
  // input. The static skeleton is covered by the canonical snapshot
  // above — these fixtures focus on the input→output mapping.

  it("counts assistant turns: one prior tutor turn", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      history: [
        USER("how do I print?"),
        ASSIST("`print(...)` displays text. What goes inside the parens?"),
      ],
    });
    expect(out).toContain("Prior tutor turns in this conversation: 1");
    expect(out).toContain("Student signalled being stuck: false");
    expect(out).toContain("Runs since last tutor turn: 0");
    expect(out).toContain("Edits since last tutor turn: 0");
  });

  it("counts assistant turns: three prior tutor turns (USER messages don't count)", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      history: [
        USER("hi"), ASSIST("hi back"),
        USER("more"), ASSIST("more back"),
        USER("again"), ASSIST("again back"),
      ],
    });
    expect(out).toContain("Prior tutor turns in this conversation: 3");
  });

  it("stuck signal: explicit \"I'm stuck\"", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      question: "I'm stuck on this — what should I do?",
    });
    expect(out).toContain("Student signalled being stuck: true");
  });

  it("stuck signal: \"I don't get it\"", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      question: "I don't get it. Can you walk me through?",
    });
    expect(out).toContain("Student signalled being stuck: true");
  });

  it("stuck signal: \"just tell me the answer\" — surrender / spoiler-seeking", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      question: "ugh just tell me the answer",
    });
    expect(out).toContain("Student signalled being stuck: true");
  });

  it("activity counters: experimentation pattern (high runs + edits)", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      history: [USER("help"), ASSIST("try X")],
      runsSinceLastTurn: 7,
      editsSinceLastTurn: 12,
    });
    expect(out).toContain("Prior tutor turns in this conversation: 1");
    expect(out).toContain("Runs since last tutor turn: 7");
    expect(out).toContain("Edits since last tutor turn: 12");
  });

  it("activity counters: zero activity after a prior turn (confused/re-reading pattern)", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      history: [USER("explain functions"), ASSIST("a function groups...")],
      runsSinceLastTurn: 0,
      editsSinceLastTurn: 0,
    });
    expect(out).toContain("Prior tutor turns in this conversation: 1");
    expect(out).toContain("Runs since last tutor turn: 0");
    expect(out).toContain("Edits since last tutor turn: 0");
  });

  it("undefined activity counters default to 0", () => {
    const out = buildSituationBlock({
      ...BASELINE,
      // runsSinceLastTurn + editsSinceLastTurn intentionally omitted
    });
    expect(out).toContain("Runs since last tutor turn: 0");
    expect(out).toContain("Edits since last tutor turn: 0");
  });
});
