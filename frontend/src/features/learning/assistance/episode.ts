import type { AssistanceEvidence } from "./evidence";

export interface AssistanceEpisodeState {
  scopeKey: string;
  trackedEvidenceKey: string | null;
  currentEvidence: AssistanceEvidence | null;
  attempts: number;
  lastAttemptRevision: number | null;
  suppressedEvidenceKey: string | null;
}
export type AssistanceEpisodeEvent =
  | { type: "scope_changed"; scopeKey: string }
  | {
      type: "result_observed";
      evidence: AssistanceEvidence;
      projectRevision: number;
      minAttempts: number;
    }
  | { type: "non_matching_result" }
  | { type: "source_changed"; minAttempts: number }
  | { type: "dismissed" }
  | { type: "accepted" };

export function createAssistanceEpisodeState(scopeKey: string): AssistanceEpisodeState {
  return {
    scopeKey,
    trackedEvidenceKey: null,
    currentEvidence: null,
    attempts: 0,
    lastAttemptRevision: null,
    suppressedEvidenceKey: null,
  };
}

/**
 * Session-only evidence episode reducer. It counts the same allowlisted error
 * only after a source revision, and suppresses a completed/dismissed episode
 * until the evidence key changes.
 */
export function assistanceEpisodeReducer(
  state: AssistanceEpisodeState,
  event: AssistanceEpisodeEvent,
): AssistanceEpisodeState {
  switch (event.type) {
    case "scope_changed":
      return event.scopeKey === state.scopeKey
        ? state
        : createAssistanceEpisodeState(event.scopeKey);

    case "result_observed": {
      const { evidence, projectRevision, minAttempts } = event;
      if (state.trackedEvidenceKey !== evidence.key) {
        return {
          ...createAssistanceEpisodeState(state.scopeKey),
          trackedEvidenceKey: evidence.key,
          currentEvidence: evidence,
          attempts: 1,
          lastAttemptRevision: projectRevision,
        };
      }

      // A fresh learner-initiated Run ends an already-visible authored move,
      // even if the source did not change. Do not nag again for the same key.
      if (
        state.currentEvidence?.key === evidence.key &&
        state.attempts >= minAttempts &&
        state.suppressedEvidenceKey !== evidence.key
      ) {
        return {
          ...state,
          currentEvidence: evidence,
          suppressedEvidenceKey: evidence.key,
        };
      }

      const revisionChanged = state.lastAttemptRevision !== projectRevision;
      return {
        ...state,
        currentEvidence: evidence,
        attempts: revisionChanged ? state.attempts + 1 : state.attempts,
        lastAttemptRevision: projectRevision,
      };
    }

    case "non_matching_result":
      return createAssistanceEpisodeState(state.scopeKey);

    case "source_changed":
      return {
        ...state,
        currentEvidence: null,
        suppressedEvidenceKey:
          state.currentEvidence && state.attempts >= event.minAttempts
            ? state.currentEvidence.key
            : state.suppressedEvidenceKey,
      };

    case "dismissed":
    case "accepted":
      return state.currentEvidence
        ? {
            ...state,
            suppressedEvidenceKey: state.currentEvidence.key,
          }
        : state;
  }
}
