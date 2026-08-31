import type { AssistanceEvidence } from "./evidence";

export interface AssistanceEpisodeState {
  scopeKey: string;
  trackedEvidenceKey: string | null;
  currentEvidence: AssistanceEvidence | null;
  attempts: number;
  evidenceTokens: string[];
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
      evidenceToken?: string;
    }
  | { type: "non_matching_result" }
  | { type: "source_changed"; minAttempts: number }
  | { type: "evidence_expired" }
  | { type: "dismissed" }
  | { type: "accepted" };

export function createAssistanceEpisodeState(scopeKey: string): AssistanceEpisodeState {
  return {
    scopeKey,
    trackedEvidenceKey: null,
    currentEvidence: null,
    attempts: 0,
    evidenceTokens: [],
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
      const { evidence, projectRevision, minAttempts, evidenceToken } = event;
      if (state.trackedEvidenceKey !== evidence.key) {
        return {
          ...createAssistanceEpisodeState(state.scopeKey),
          trackedEvidenceKey: evidence.key,
          currentEvidence: evidence,
          attempts: 1,
          evidenceTokens: evidenceToken ? [evidenceToken] : [],
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
        evidenceTokens:
          revisionChanged && evidenceToken
            ? [...state.evidenceTokens, evidenceToken].slice(-10)
            : state.evidenceTokens,
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

    case "evidence_expired":
      // Retire the complete signed chain without suppressing this evidence
      // key forever. A chain may contain an expired receipt or a receipt from
      // a previous token format, so retaining any of it would make every
      // subsequent offer fail closed until the ten-token window rolled over.
      return {
        ...state,
        currentEvidence: null,
        attempts: 0,
        evidenceTokens: [],
        lastAttemptRevision: null,
        suppressedEvidenceKey: null,
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
