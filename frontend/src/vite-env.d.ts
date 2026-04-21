/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project API URL. `https://<ref>.supabase.co` — dev points at
   * `codetutor-dev`, prod at `codetutor-prod` (Phase 18d cloud-only model). */
  readonly VITE_SUPABASE_URL: string;
  /** Publishable (anon) key. Safe to ship in the bundle — the real secret
   * lives on Supabase's side and is never exposed to the browser. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Absolute backend URL (Phase 19d). Set in prod where the frontend is
   * hosted on SWA and cannot reach the backend through a same-origin
   * `/api/*` path — prepended to every fetch in the api client. Left
   * undefined in dev so Vite's proxy handles `/api/*` as before. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
