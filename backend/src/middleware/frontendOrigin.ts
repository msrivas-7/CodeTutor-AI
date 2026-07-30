import type { CorsOptions } from "cors";
import { config } from "../config.js";

// Azure Static Web Apps gives this CodeTutor resource a stable, product-owned
// hostname prefix. Pull-request environments add `-<PR number>` before the
// fixed regional suffix. Restricting the pattern to this exact resource keeps
// previews usable without trusting every tenant on azurestaticapps.net.
const CODETUTOR_SWA_HOST =
  /^gentle-flower-093ba7e0f(?:-\d+)?\.eastus2\.7\.azurestaticapps\.net$/;

export function isFrontendOriginAllowed(origin: string): boolean {
  if (origin === config.corsOrigin) return true;

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.port === "" &&
      parsed.origin === origin &&
      CODETUTOR_SWA_HOST.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// Requests without Origin are non-browser/server-to-server traffic. CORS is a
// browser response policy, so leave those requests alone. Mutating routes are
// independently protected by csrfGuard, which requires an allowed Origin.
export const corsOriginPolicy: NonNullable<CorsOptions["origin"]> = (
  origin,
  callback,
) => {
  callback(null, origin === undefined || isFrontendOriginAllowed(origin));
};
