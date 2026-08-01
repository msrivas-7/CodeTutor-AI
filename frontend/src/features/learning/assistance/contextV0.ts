import type { AssistanceEvidence } from "./evidence";

export type AssistanceAttentionOwner =
  | "blocking"
  | "learner-requested-tutor"
  | "run-result"
  | "authored-lesson"
  | "completion";

export interface AssistanceContextV0 {
  contextVersion: 0;
  contextEpoch: string;
  courseId: string;
  lessonId: string;
  projectRevision: number;
  latestRunEvidence: AssistanceEvidence | null;
  historicallyComplete: boolean;
  currentValidity: "unknown" | "passing" | "failing";
  attentionOwner: AssistanceAttentionOwner;
}

interface DeriveAssistanceContextV0Args {
  projectContext: string | null;
  projectRevision: number;
  courseId: string;
  lessonId: string;
  latestRunEvidence: AssistanceEvidence | null;
  latestRunFailed: boolean;
  hasAcceptedRunResult: boolean;
  historicallyComplete: boolean;
  blockingAttention: boolean;
  learnerRequestedTutor: boolean;
}

/** A pure, derived snapshot. Existing stores remain the canonical state. */
export function deriveAssistanceContextV0({
  projectContext,
  projectRevision,
  courseId,
  lessonId,
  latestRunEvidence,
  latestRunFailed,
  hasAcceptedRunResult,
  historicallyComplete,
  blockingAttention,
  learnerRequestedTutor,
}: DeriveAssistanceContextV0Args): AssistanceContextV0 {
  // V0 has no Check consumer yet. A Run failure is authoritative failing
  // evidence; a successful Run is still only "unknown" for lesson validity.
  const currentValidity =
    hasAcceptedRunResult && latestRunFailed ? "failing" : "unknown";
  const attentionOwner: AssistanceAttentionOwner = blockingAttention
    ? "blocking"
    : learnerRequestedTutor
      ? "learner-requested-tutor"
      : latestRunEvidence || latestRunFailed
        ? "run-result"
        : historicallyComplete && currentValidity !== "failing"
          ? "completion"
          : "authored-lesson";

  return {
    contextVersion: 0,
    // The existing project-context key is the V0 epoch seam. Revision remains
    // separate and monotonic; combining them would incorrectly create a new
    // epoch for every keystroke.
    contextEpoch: projectContext ?? "unbound",
    courseId,
    lessonId,
    projectRevision,
    latestRunEvidence,
    historicallyComplete,
    currentValidity,
    attentionOwner,
  };
}
