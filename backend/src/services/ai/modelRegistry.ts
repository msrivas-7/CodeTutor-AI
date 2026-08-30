import type { AIModel, TutorIntent } from "./provider.js";

export const MODEL_REGISTRY_VERSION = "2026-08-30.contextual-offer-v1";
export const TUTOR_EVAL_SET_VERSION = "2.10.0+evaluator.2.16.0";

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
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    qualityStatus: "evaluated",
    contextualTutorEligible: true,
    evalSetVersion: TUTOR_EVAL_SET_VERSION,
    evaluatedAt: "2026-08-10",
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
};

const REQUIRED_PLATFORM_TUTOR_INTENTS: TutorIntent[] = [
  "socratic",
  "debug",
  "concept",
  "howto",
  "walkthrough",
  "checkin",
];

const UNEVALUATED: Omit<EvaluatedModelPolicy, "id"> = {
  qualityStatus: "unevaluated",
  contextualTutorEligible: true,
  evalSetVersion: null,
  evaluatedAt: null,
  evaluatedTutorIntents: [],
  supportedTutorBehaviors: ["editor-tutor"],
};

export function isGptFiveOrLaterTutorModel(modelId: string): boolean {
  const normalized = modelId.trim().toLocaleLowerCase();
  const excluded = [
    "audio",
    "realtime",
    "image",
    "transcribe",
    "tts",
    "search",
    "codex",
    "chat-latest",
    "pro",
  ];
  if (excluded.some((family) => normalized.includes(family))) return false;
  const major = normalized.match(/^gpt-(\d+)(?:[.-]|$)/)?.[1];
  return major !== undefined && Number(major) >= 5;
}

export function getModelPolicy(modelId: string): EvaluatedModelPolicy {
  return REGISTRY[modelId] ?? {
    id: modelId,
    ...UNEVALUATED,
    contextualTutorEligible: isGptFiveOrLaterTutorModel(modelId),
  };
}

export function isContextualTutorModel(modelId: string): boolean {
  return getModelPolicy(modelId).contextualTutorEligible;
}

/**
 * Release 1C is stricter than ordinary BYOK guided tutoring. A model may be a
 * compatible GPT-5+ choice for a learner-funded conversation while still
 * lacking the complete CodeTutor evaluation needed for a product-initiated
 * contextual offer. Keep that distinction explicit at the route boundary.
 */
export function isEvaluatedContextualOfferModel(modelId: string): boolean {
  const policy = getModelPolicy(modelId);
  return (
    policy.qualityStatus === "evaluated" &&
    policy.contextualTutorEligible &&
    policy.supportedTutorBehaviors.includes("contextual-offer")
  );
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

/**
 * Platform-funded models must pass every teaching-intent gate. A model can be
 * visible in OpenAI discovery or usable in a narrower BYOK context without
 * being eligible for the operator-funded default.
 */
export function isApprovedPlatformTutorModel(modelId: string): boolean {
  const policy = getModelPolicy(modelId);
  return (
    policy.qualityStatus === "evaluated" &&
    policy.contextualTutorEligible &&
    REQUIRED_PLATFORM_TUTOR_INTENTS.every((intent) =>
      policy.evaluatedTutorIntents.includes(intent),
    )
  );
}

export function approvedPlatformTutorModels(): string[] {
  return Object.keys(REGISTRY).filter(isApprovedPlatformTutorModel);
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
