import { describe, expect, it } from "vitest";
import {
  assistanceEpisodeReducer,
  createAssistanceEpisodeState,
} from "./episode";
import type { AssistanceEvidence } from "./evidence";

const evidence = (line = 1): AssistanceEvidence => ({
  code: "python-unclosed-parenthesis",
  key: `python-unclosed-parenthesis:main.py:${line}`,
  path: "main.py",
  line,
  label: "Syntax error",
});
describe("assistanceEpisodeReducer", () => {
  it("requires the same error on two distinct source revisions", () => {
    let state = createAssistanceEpisodeState("course/lesson");
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 10,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 10,
      minAttempts: 2,
    });
    expect(state.attempts).toBe(1);

    state = assistanceEpisodeReducer(state, { type: "source_changed", minAttempts: 2 });
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 11,
      minAttempts: 2,
    });
    expect(state.attempts).toBe(2);
    expect(state.currentEvidence?.key).toBe(evidence().key);
  });

  it("ends an active move on edit and suppresses it until evidence changes", () => {
    let state = createAssistanceEpisodeState("course/lesson");
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 1,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "source_changed", minAttempts: 2 });
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 2,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "source_changed", minAttempts: 2 });
    expect(state.suppressedEvidenceKey).toBe(evidence().key);

    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 3,
      minAttempts: 2,
    });
    expect(state.suppressedEvidenceKey).toBe(evidence().key);

    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(2),
      projectRevision: 4,
      minAttempts: 2,
    });
    expect(state.suppressedEvidenceKey).toBeNull();
    expect(state.attempts).toBe(1);
  });

  it("resets on navigation and on a non-matching accepted result", () => {
    let state = assistanceEpisodeReducer(createAssistanceEpisodeState("a"), {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 1,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "non_matching_result" });
    expect(state.attempts).toBe(0);
    state = assistanceEpisodeReducer(state, { type: "scope_changed", scopeKey: "b" });
    expect(state).toEqual(createAssistanceEpisodeState("b"));
  });

  it("suppresses an accepted offer immediately so rapid repeat clicks cannot re-offer", () => {
    let state = createAssistanceEpisodeState("course/lesson");
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 1,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "source_changed", minAttempts: 2 });
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 2,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "accepted" });
    expect(state.suppressedEvidenceKey).toBe(evidence().key);
  });

  it("retires expired evidence until a fresh run re-arms the same error", () => {
    let state = createAssistanceEpisodeState("course/lesson");
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 1,
      minAttempts: 2,
    });
    state = assistanceEpisodeReducer(state, { type: "source_changed", minAttempts: 2 });
    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 2,
      minAttempts: 2,
    });

    state = assistanceEpisodeReducer(state, { type: "evidence_expired" });
    expect(state.currentEvidence).toBeNull();
    expect(state.suppressedEvidenceKey).toBeNull();

    state = assistanceEpisodeReducer(state, {
      type: "result_observed",
      evidence: evidence(),
      projectRevision: 2,
      minAttempts: 2,
    });
    expect(state.currentEvidence?.key).toBe(evidence().key);
    expect(state.attempts).toBe(2);
  });

});
