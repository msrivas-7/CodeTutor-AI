import type { AIModel, TutorIntent } from "./provider.js";

export const MODEL_REGISTRY_VERSION = "2026-08-01.v13";
export const TUTOR_EVAL_SET_VERSION = "2.4.0+evaluator.2.12.0";

export type ModelQualityStatus = "evaluated" | "unevaluated";

export interface EvaluatedModelPolicy {
  id: string;
  qualityStatus: ModelQualityStatus;
  contextualTutorEligible: boolean;
  evalSetVersion: string | null;
  evaluatedAt: string | null;
  evaluatedTutorIntents: TutorIntent[];
  supportedTutorBehaviors: Array<
    "editor-tutor" | "guided-tutor" | "contextual-offer"
  >;
}

// Registry entries are versioned policy, not a reflection of whatever a BYOK
// key happens to expose today. A model must earn contextual eligibility via
// the full v2 gate before this file changes.
const REGISTRY: Record<string, EvaluatedModelPolicy> = {
  "gpt-4.1-nano": {
    id: "gpt-4.1-nano",
    qualityStatus: "evaluated",
    contextualTutorEligible: true,
    evalSetVersion: TUTOR_EVAL_SET_VERSION,
    evaluatedAt: "2026-07-31",
    evaluatedTutorIntents: [
      "socratic",
      "debug",
      "concept",
      "howto",
      "walkthrough",
      "checkin",
    ],
    supportedTutorBehaviors: [
      "editor-tutor",
      "guided-tutor",
      "contextual-offer",
    ],
  },
  // B3's frozen 3x comparison promoted Mini only for check-ins. It is not a
  // generally contextual-eligible model: the same evidence retained Nano for
  // walkthroughs, and the other four intents were not part of the comparison.
  "gpt-4.1-mini": {
    id: "gpt-4.1-mini",
    qualityStatus: "evaluated",
    contextualTutorEligible: false,
    evalSetVersion: TUTOR_EVAL_SET_VERSION,
    evaluatedAt: "2026-07-31",
    evaluatedTutorIntents: ["checkin"],
    supportedTutorBehaviors: ["editor-tutor", "guided-tutor"],
  },
};

const UNEVALUATED: Omit<EvaluatedModelPolicy, "id"> = {
  qualityStatus: "unevaluated",
  contextualTutorEligible: false,
  evalSetVersion: null,
  evaluatedAt: null,
  evaluatedTutorIntents: [],
  supportedTutorBehaviors: ["editor-tutor"],
};

export function getModelPolicy(modelId: string): EvaluatedModelPolicy {
  return REGISTRY[modelId] ?? { id: modelId, ...UNEVALUATED };
}

export function isContextualTutorModel(modelId: string): boolean {
  return getModelPolicy(modelId).contextualTutorEligible;
}

export function isModelEvaluatedForTutorIntent(
  modelId: string,
  intent: TutorIntent,
): boolean {
  const policy = getModelPolicy(modelId);
  return (
    policy.qualityStatus === "evaluated" &&
    policy.evaluatedTutorIntents.includes(intent)
  );
}

export function decorateModel(model: Pick<AIModel, "id" | "label">): AIModel {
  const policy = getModelPolicy(model.id);
  return {
    ...model,
    qualityStatus: policy.qualityStatus,
    contextualTutorEligible: policy.contextualTutorEligible,
    qualityLabel:
      policy.qualityStatus === "evaluated"
        ? "Evaluated for CodeTutor"
        : "Not evaluated for teaching quality",
    evalSetVersion: policy.evalSetVersion,
    registryVersion: MODEL_REGISTRY_VERSION,
  };
}

/** Evaluated, contextual-eligible models sort ahead of unknown BYOK models. */
export function rankByTeachingQuality(models: AIModel[]): AIModel[] {
  return [...models].sort((a, b) => {
    const qa = getModelPolicy(a.id).contextualTutorEligible ? 0 : 1;
    const qb = getModelPolicy(b.id).contextualTutorEligible ? 0 : 1;
    return qa - qb;
  });
}
