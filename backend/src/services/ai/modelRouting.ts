import type {
  AIMessage,
  ProjectFile,
  TutorIntent,
  TutorStage,
} from "./provider.js";
import {
  isContextualTutorModel,
  isModelEvaluatedForTutorIntent,
} from "./modelRegistry.js";
import { classifyTutorIntent } from "./tutorIntent.js";

export const PLATFORM_DEFAULT_TUTOR_MODEL = "gpt-5.6-luna";
export const PLATFORM_TUTOR_ROUTING_POLICY_VERSION = "platform-tutor-luna.v1";

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
}: {
  requestedModel: string;
  fundingSource: "byok" | "platform";
}): string {
  if (fundingSource === "platform") return PLATFORM_DEFAULT_TUTOR_MODEL;
  return isContextualTutorModel(requestedModel)
    ? requestedModel
    : PLATFORM_DEFAULT_TUTOR_MODEL;
}

export function platformTutorModelForIntent(
  _intent: TutorIntent,
): string {
  return PLATFORM_DEFAULT_TUTOR_MODEL;
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
}: {
  requestedModel: string;
  fundingSource: "byok" | "platform";
  question: string;
  files: ProjectFile[];
  history?: AIMessage[];
  tutorStage: TutorStage;
}): TutorModelRoute {
  const intent = classifyTutorIntent({ question, files, history, tutorStage });
  const canonicalModel = canonicalTutorRequestModel({ requestedModel, fundingSource });
  if (fundingSource === "byok") return { intent, model: canonicalModel };

  const model = platformTutorModelForIntent(intent);
  if (!isModelEvaluatedForTutorIntent(model, intent)) {
    throw new Error(
      `[model-routing] ${model} is not evaluated for server-classified ${intent}`,
    );
  }
  return { intent, model };
}
