import type { AssistanceMove } from "../types";
import type { AssistanceContextV0 } from "./contextV0";
import type { AssistanceEpisodeState } from "./episode";

export type AssistanceDecision =
  | { kind: "hidden" }
  | { kind: "result_bridge"; move: AssistanceMove | null };

/** Deterministic policy selection. This module has no AI or network imports. */
export function selectAssistanceDecision(
  enabled: boolean,
  context: AssistanceContextV0,
  episode: AssistanceEpisodeState,
  moves: readonly AssistanceMove[],
): AssistanceDecision {
  const evidence = context.latestRunEvidence;
  if (
    !enabled ||
    !evidence ||
    context.attentionOwner !== "run-result" ||
    episode.currentEvidence?.key !== evidence.key ||
    episode.suppressedEvidenceKey === evidence.key
  ) {
    return { kind: "hidden" };
  }

  const move =
    moves.find(
      (candidate) =>
        candidate.trigger.type === "repeated_error" &&
        candidate.trigger.errorCode === evidence.code &&
        episode.attempts >= candidate.trigger.minAttempts,
    ) ?? null;

  return { kind: "result_bridge", move };
}
