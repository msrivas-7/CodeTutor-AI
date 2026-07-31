import { useEffect, useMemo, useReducer, useRef } from "react";
import type { RunResult } from "../../../types";
import type { AssistanceMoves } from "../types";
import { deriveAssistanceContextV0 } from "./contextV0";
import {
  assistanceEpisodeReducer,
  createAssistanceEpisodeState,
} from "./episode";
import { normalizeRunEvidence } from "./evidence";
import { selectAssistanceDecision } from "./policy";

interface UseContextualGuideArgs {
  enabled: boolean;
  courseId: string;
  lessonId: string;
  projectContext: string | null;
  projectRevision: number;
  projectPaths: readonly string[];
  result: RunResult | null;
  assistanceMoves?: AssistanceMoves;
  historicallyComplete: boolean;
  blockingAttention: boolean;
  learnerRequestedTutor: boolean;
}

const V0_MIN_ATTEMPTS = 2;

export function useContextualGuide({
  enabled,
  courseId,
  lessonId,
  projectContext,
  projectRevision,
  projectPaths,
  result,
  assistanceMoves,
  historicallyComplete,
  blockingAttention,
  learnerRequestedTutor,
}: UseContextualGuideArgs) {
  const scopeKey = `${courseId}/${lessonId}`;
  const [episode, dispatch] = useReducer(
    assistanceEpisodeReducer,
    scopeKey,
    createAssistanceEpisodeState,
  );
  const observedResultRef = useRef<RunResult | null>(null);
  const observedRevisionRef = useRef(projectRevision);

  useEffect(() => {
    observedResultRef.current = null;
    observedRevisionRef.current = projectRevision;
    dispatch({ type: "scope_changed", scopeKey });
  }, [scopeKey]); // projectRevision is intentionally captured only on scope reset

  useEffect(() => {
    if (!enabled || result === observedResultRef.current) return;
    observedResultRef.current = result;
    if (!result) return;

    const evidence = normalizeRunEvidence(result, projectPaths);
    if (!evidence) {
      dispatch({ type: "non_matching_result" });
      return;
    }
    dispatch({
      type: "result_observed",
      evidence,
      projectRevision,
      minAttempts: V0_MIN_ATTEMPTS,
    });
  }, [enabled, projectPaths, projectRevision, result]);

  useEffect(() => {
    if (!enabled) return;
    if (observedRevisionRef.current === projectRevision) return;
    observedRevisionRef.current = projectRevision;
    if (!result) {
      dispatch({ type: "source_changed", minAttempts: V0_MIN_ATTEMPTS });
    }
  }, [enabled, projectRevision, result]);

  const latestRunEvidence = useMemo(
    () => normalizeRunEvidence(result, projectPaths),
    [projectPaths, result],
  );
  const context = useMemo(
    () =>
      deriveAssistanceContextV0({
        projectContext,
        projectRevision,
        courseId,
        lessonId,
        latestRunEvidence,
        latestRunFailed:
          !!result && (result.exitCode !== 0 || result.errorType !== "none"),
        hasAcceptedRunResult: result !== null,
        historicallyComplete,
        blockingAttention,
        learnerRequestedTutor,
      }),
    [
      blockingAttention,
      courseId,
      historicallyComplete,
      latestRunEvidence,
      learnerRequestedTutor,
      lessonId,
      projectContext,
      projectRevision,
    ],
  );
  const moves = assistanceMoves?.version === 1 ? assistanceMoves.moves : [];
  const decision = selectAssistanceDecision(enabled, context, episode, moves);

  return {
    context,
    decision,
    episode,
    target:
      decision.kind === "result_bridge" && latestRunEvidence
        ? { path: latestRunEvidence.path, line: latestRunEvidence.line }
        : null,
    dismiss: () => dispatch({ type: "dismissed" }),
  };
}
