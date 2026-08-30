import { config } from "../../config.js";
import { getSystemConfig } from "../../db/systemConfig.js";

/** Independent Release 1C runtime gate. DB override wins; env is fallback. */
export async function isContextualTutorEnabled(
  opts: { bypassCache?: boolean } = {},
): Promise<boolean> {
  try {
    const row = await getSystemConfig("contextual_tutor_enabled", opts);
    return typeof row?.value === "boolean"
      ? row.value
      : config.contextualTutorEnabled;
  } catch {
    // This gate protects an optional intervention, not ordinary Tutor access.
    // A control-plane read failure therefore disables contextual offers while
    // allowing status and non-contextual Tutor flows to remain available.
    return false;
  }
}
