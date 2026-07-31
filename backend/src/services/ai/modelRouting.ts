import type {
  AIMessage,
  ProjectFile,
  TutorIntent,
  TutorStage,
} from "./provider.js";
import { isModelEvaluatedForTutorIntent } from "./modelRegistry.js";
import { classifyTutorIntent } from "./tutorIntent.js";

export const PLATFORM_DEFAULT_TUTOR_MODEL = "gpt-4.1-nano";
export const PLATFORM_CHECKIN_TUTOR_MODEL = "gpt-4.1-mini";
export const PLATFORM_TUTOR_ROUTING_POLICY_VERSION = "platform-tutor-b3.v1";

export interface TutorModelRoute {
  intent: TutorIntent;
  model: string;
}

export function platformTutorModelForIntent(intent: TutorIntent): string {
  return intent === "checkin"
    ? PLATFORM_CHECKIN_TUTOR_MODEL
    : PLATFORM_DEFAULT_TUTOR_MODEL;
}

/**
 * Apply a server-owned routing policy to untrusted learner content plus the
 * trusted, signed progression stage. A platform client can request only Nano
 * at the route boundary; after progression is verified, this function may
 * promote a server-classified check-in to Mini. BYOK calls always retain the
 * user's selected model.
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
  if (fundingSource === "byok") return { intent, model: requestedModel };

  const model = platformTutorModelForIntent(intent);
  if (!isModelEvaluatedForTutorIntent(model, intent)) {
    throw new Error(
      `[model-routing] ${model} is not evaluated for server-classified ${intent}`,
    );
  }
  return { intent, model };
}
