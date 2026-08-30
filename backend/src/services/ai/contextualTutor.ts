import { config } from "../../config.js";
import { getSystemConfig } from "../../db/systemConfig.js";

/** Independent Release 1C runtime gate. DB override wins; env is fallback. */
export async function isContextualTutorEnabled(
  opts: { bypassCache?: boolean } = {},
): Promise<boolean> {
  const row = await getSystemConfig("contextual_tutor_enabled", opts);
  return typeof row?.value === "boolean"
    ? row.value
    : config.contextualTutorEnabled;
}
