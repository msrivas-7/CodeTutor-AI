import type {
  AIMessage,
  ProjectFile,
  TutorIntent,
  TutorStage,
} from "./provider.js";
import { isModelEvaluatedForTutorIntent } from "./modelRegistry.js";
import { classifyTutorIntent } from "./tutorIntent.js";

export const PLATFORM_DEFAULT_TUTOR_MODEL = "gpt-5.6-luna";
export const PLATFORM_TUTOR_ROUTING_POLICY_VERSION = "platform-tutor-luna.v1";

export interface TutorModelRoute {
  intent: TutorIntent;
  model: string;
}

/**
 * Platform funding owns the model choice. Treat the client model as an
 * advisory compatibility field so an old tab or persisted BYOK preference
 * cannot break a platform-funded request or promote it to a costlier model.
 */
export function canonicalTutorRequestModel({
  requestedModel,
  fundingSource,
}: {
  requestedModel: string;
  fundingSource: "byok" | "platform";
}): string {
  return fundingSource === "platform"
    ? PLATFORM_DEFAULT_TUTOR_MODEL
    : requestedModel;
}

export function platformTutorModelForIntent(
  _intent: TutorIntent,
): string {
  return PLATFORM_DEFAULT_TUTOR_MODEL;
}

/**
 * Apply a server-owned routing policy to untrusted learner content plus the
 * trusted, signed progression stage. A platform client can request only the
 * evaluated platform model at the route boundary. BYOK calls always retain
 * the user's selected model. Platform funding uses the single independently
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
