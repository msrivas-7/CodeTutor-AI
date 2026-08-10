import {
  getSystemConfig,
  type SystemConfigRow,
} from "../../db/systemConfig.js";
import { isGptFiveOrLaterTutorModel } from "./modelRegistry.js";
import {
  hasKnownModelPrice,
  isPlatformAllowedModel,
} from "./pricing.js";
import { PLATFORM_DEFAULT_TUTOR_MODEL } from "./modelRouting.js";

export const PLATFORM_TUTOR_MODEL_CONFIG_KEY = "platform_tutor_model" as const;

export interface EffectivePlatformTutorModel {
  model: string;
  source: "override" | "fallback";
  setBy: string | null;
  setAt: string | null;
  reason: string | null;
  invalidOverride: string | null;
}

export function isSelectablePlatformTutorModel(model: string): boolean {
  return isGptFiveOrLaterTutorModel(model) &&
    hasKnownModelPrice(model) &&
    isPlatformAllowedModel(model);
}

function fallback(invalidOverride: string | null = null): EffectivePlatformTutorModel {
  if (!isSelectablePlatformTutorModel(PLATFORM_DEFAULT_TUTOR_MODEL)) {
    throw new Error(
      `[platform-tutor-model] compiled fallback ${PLATFORM_DEFAULT_TUTOR_MODEL} is not approved and priced`,
    );
  }
  return {
    model: PLATFORM_DEFAULT_TUTOR_MODEL,
    source: "fallback",
    setBy: null,
    setAt: null,
    reason: null,
    invalidOverride,
  };
}

function fromRow(row: SystemConfigRow | null): EffectivePlatformTutorModel {
  if (!row) return fallback();
  if (typeof row.value !== "string" || !isSelectablePlatformTutorModel(row.value)) {
    const invalid = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
    console.error(
      JSON.stringify({
        level: "error",
        evt: "platform_tutor_model_invalid_override",
        configuredModel: invalid,
        fallbackModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      }),
    );
    return fallback(invalid);
  }
  return {
    model: row.value,
    source: "override",
    setBy: row.setBy,
    setAt: row.setAt,
    reason: row.reason,
    invalidOverride: null,
  };
}

export async function getEffectivePlatformTutorModel(
  opts: { bypassCache?: boolean; throwOnDatabaseError?: boolean } = {},
): Promise<EffectivePlatformTutorModel> {
  try {
    const row = await getSystemConfig(PLATFORM_TUTOR_MODEL_CONFIG_KEY, {
      bypassCache: opts.bypassCache,
    });
    return fromRow(row);
  } catch (error) {
    if (opts.throwOnDatabaseError) throw error;
    console.error(
      JSON.stringify({
        level: "error",
        evt: "platform_tutor_model_config_unavailable",
        fallbackModel: PLATFORM_DEFAULT_TUTOR_MODEL,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return fallback();
  }
}
