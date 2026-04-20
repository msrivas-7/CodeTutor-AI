// Global teardown: delete every test user admin-created during the suite.
// Runs after all specs finish, even if some failed. Best-effort — we don't
// fail the suite over a lingering test user.

import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Mirror playwright.config.ts: pull SUPABASE_SERVICE_ROLE_KEY out of
// ../.env.local if present. globalSetup runs in the same node context, so
// env is usually already populated, but this makes the teardown robust to
// direct invocation (`tsx fixtures/teardown.ts`) too.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env.local") });

export default async function globalTeardown() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) return;

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // List every user; filter by our e2e- prefix so we never touch a real
    // account accidentally left over in the local dashboard.
    let page = 1;
    const victims: string[] = [];
    // The admin listUsers endpoint paginates; walk until empty page.
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      if (!data.users.length) break;
      for (const u of data.users) {
        const email = u.email ?? "";
        if (/^e2e-w/.test(email) && /@codetutor\.test$/.test(email)) {
          victims.push(u.id);
        }
      }
      if (data.users.length < 200) break;
      page += 1;
    }
    for (const id of victims) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    if (victims.length) {
      // eslint-disable-next-line no-console
      console.log(`[auth teardown] deleted ${victims.length} test users`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[auth teardown] error:", (err as Error).message);
  }
}
