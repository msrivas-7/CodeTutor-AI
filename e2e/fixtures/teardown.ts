// Global teardown: delete every test user admin-created during the suite.
// Runs after all specs finish, even if some failed. Best-effort — we don't
// fail the suite over a lingering test user.

import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  reapAbandonedCiTestUsers,
  requireCurrentRunSuffix,
  shouldReapAbandonedCiUsers,
  teardownCurrentRunTestUsers,
} from "./testIdentity";

// Mirror playwright.config.ts: pull SUPABASE_SERVICE_ROLE_KEY out of ../.env
// if present. globalSetup runs in the same node context, so env is usually
// already populated, but this makes the teardown robust to direct invocation
// (`tsx fixtures/teardown.ts`) too.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

export default async function globalTeardown() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) return;

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const suffix = requireCurrentRunSuffix();
    const report = await teardownCurrentRunTestUsers(admin, suffix);
    if (report.deleted > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[auth teardown] deleted ${report.deleted} users in namespace ${suffix}; ` +
          `skipped ${report.foreignSkipped} foreign users`,
      );
    }
    if (shouldReapAbandonedCiUsers(suffix)) {
      const abandoned = await reapAbandonedCiTestUsers(admin);
      if (abandoned.deleted > 0 || abandoned.truncated) {
        // eslint-disable-next-line no-console
        console.log(
          `[auth teardown] reaped ${abandoned.deleted} abandoned CI users older than 24h; ` +
            `${abandoned.eligible} eligible${abandoned.truncated ? " (bounded batch; more remain)" : ""}`,
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[auth teardown] error:", (err as Error).message);
  }
}
