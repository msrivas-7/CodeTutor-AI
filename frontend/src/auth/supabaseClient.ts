import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Singleton Supabase client. The SDK keeps an internal session cache (and
// a refresh-token timer), so creating more than one client per tab would
// fight with itself — hence the single module-level instance.
//
// Env values are bound from Vite mode files. Dev reads from the gitignored
// `frontend/.env.development.local`; prod builds read `.env.production.local`.
// Values are read at build time — change the file + rebuild = different
// environment with zero code touch. Committed `.example` siblings document
// the shape; see docs/DEVELOPMENT.md for how to request real creds.

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Better to fail loudly at import time than to present a broken login
  // screen. This also makes env-file misconfiguration obvious on deploy.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Populate " +
      "frontend/.env.development.local from frontend/.env.development.example — see docs/DEVELOPMENT.md.",
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    // Persist the session in localStorage so refreshes and new tabs stay
    // logged in. The SDK manages token refresh internally.
    persistSession: true,
    autoRefreshToken: true,
    // PKCE flow for email + OAuth — the modern secure default. Implicit
    // grant (the old default) leaks tokens in URL fragments; PKCE avoids it.
    flowType: "pkce",
    detectSessionInUrl: true,
    // Stable, app-owned localStorage key so E2E fixtures can inject a
    // session deterministically (see e2e/fixtures/auth.ts) without having
    // to reverse-engineer the SDK's default `sb-<ref>-auth-token` format.
    storageKey: "codetutor-auth",
  },
});
