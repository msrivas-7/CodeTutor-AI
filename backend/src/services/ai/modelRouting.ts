import type {
  AIMessage,
  ProjectFile,
  TutorAction,
  TutorIntent,
  TutorStage,
} from "./provider.js";
import {
  isContextualTutorModel,
  isModelEvaluatedForTutorIntent,
} from "./modelRegistry.js";
import { classifyTutorIntent } from "./tutorIntent.js";

export const PLATFORM_DEFAULT_TUTOR_MODEL = "gpt-5.6-luna";
export const PLATFORM_TUTOR_ROUTING_POLICY_VERSION = "platform-tutor-config.v2";

export interface TutorModelRoute {
  intent: TutorIntent;
  model: string;
}

/**
 * Platform funding owns the model choice. Treat the client model as an
 * advisory compatibility field so an old tab or persisted preference cannot
 * bypass the evaluated GPT-5 Tutor floor. BYOK still owns the credential and
 * billing; model eligibility remains a server-owned product decision.
 */
export function canonicalTutorRequestModel({
  requestedModel,
  fundingSource,
  platformModel = PLATFORM_DEFAULT_TUTOR_MODEL,
}: {
  requestedModel: string | null | undefined;
  fundingSource: "byok" | "platform";
  platformModel?: string;
}): string {
  if (fundingSource === "platform") return platformModel;
  return requestedModel && isContextualTutorModel(requestedModel)
    ? requestedModel
    : PLATFORM_DEFAULT_TUTOR_MODEL;
}

export function platformTutorModelForIntent(
  _intent: TutorIntent,
  platformModel = PLATFORM_DEFAULT_TUTOR_MODEL,
): string {
  return platformModel;
}

/**
 * Apply a server-owned routing policy to untrusted learner content plus the
 * trusted, signed progression stage. A platform client can request only the
 * evaluated platform model at the route boundary. BYOK retains the user's
 * credential while stale or unevaluated model choices canonicalize to the
 * same GPT-5 quality floor. Platform funding uses the single independently
 * evaluated Luna policy for every teaching intent; clients cannot promote
 * themselves to a different operator-funded model.
 */
export function routeTutorModel({
  requestedModel,
  fundingSource,
  question,
  files,
  history,
  tutorStage,
  tutorAction,
  platformModel = PLATFORM_DEFAULT_TUTOR_MODEL,
}: {
  requestedModel: string | null | undefined;
  fundingSource: "byok" | "platform";
  question: string;
  files: ProjectFile[];
  history?: AIMessage[];
  tutorStage: TutorStage;
  tutorAction?: TutorAction;
  platformModel?: string;
}): TutorModelRoute {
  const intent = classifyTutorIntent({
    question,
    files,
    history,
    tutorStage,
    tutorAction,
  });
  const canonicalModel = canonicalTutorRequestModel({
    requestedModel,
    fundingSource,
    platformModel,
  });
  if (fundingSource === "byok") return { intent, model: canonicalModel };

  const model = platformTutorModelForIntent(intent, platformModel);
  if (!isContextualTutorModel(model)) {
    throw new Error(
      `[model-routing] ${model} is not compatible with the contextual Tutor for ${intent}`,
    );
  }
  return { intent, model };
}
