import type { JSONValue } from "postgres";
import { z } from "zod";
import { db } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { decryptKey, encryptKey } from "../services/crypto/byok.js";

export interface UserPreferences {
  persona: "beginner" | "intermediate" | "advanced";
  openaiModel: string | null;
  theme: "system" | "light" | "dark";
  welcomeDone: boolean;
  workspaceCoachDone: boolean;
  editorCoachDone: boolean;
  uiLayout: Record<string, unknown>;
  // Boolean surfaced to the frontend so the UI can show "key set / not set"
  // without ever shipping the decrypted key off the server.
  hasOpenaiKey: boolean;
  // First-run cinematic: timestamp of the last "welcome back" overlay
  // shown to this user. Server-backed so one device suppresses the
  // next device the same day. Null = never shown.
  lastWelcomeBackAt: string | null;
  updatedAt: string;
}

const DEFAULT_PREFS: UserPreferences = {
  persona: "intermediate",
  openaiModel: null,
  theme: "dark",
  welcomeDone: false,
  workspaceCoachDone: false,
  editorCoachDone: false,
  uiLayout: {},
  hasOpenaiKey: false,
  lastWelcomeBackAt: null,
  updatedAt: new Date(0).toISOString(),
};

// Phase 20-P3 Bucket 3 (#2): parse rows at the DB boundary instead of hard-
// casting strings into union types. A bad migration that writes e.g.
// persona='bogus' used to land unchecked and silently mis-render prompts;
// now it fails fast with a 500 the logs can pin down.
export const PrefsRowSchema = z.object({
  persona: z.enum(["beginner", "intermediate", "advanced"]),
  openai_model: z.string().nullable(),
  theme: z.enum(["system", "light", "dark"]),
  welcome_done: z.boolean(),
  workspace_coach_done: z.boolean(),
  editor_coach_done: z.boolean(),
  ui_layout: z.record(z.string(), z.unknown()).nullable(),
  has_openai_key: z.boolean(),
  last_welcome_back_at: z.date().nullable(),
  updated_at: z.date(),
});

function rowToPrefs(raw: unknown): UserPreferences {
  const parsed = PrefsRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt user_preferences row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    persona: r.persona,
    openaiModel: r.openai_model,
    theme: r.theme,
    welcomeDone: r.welcome_done,
    workspaceCoachDone: r.workspace_coach_done,
    editorCoachDone: r.editor_coach_done,
    uiLayout: r.ui_layout ?? {},
    hasOpenaiKey: r.has_openai_key,
    lastWelcomeBackAt: r.last_welcome_back_at
      ? r.last_welcome_back_at.toISOString()
      : null,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const sql = db();
  const rows = await sql`
    SELECT persona, openai_model, theme, welcome_done, workspace_coach_done,
           editor_coach_done, ui_layout,
           (openai_api_key_cipher IS NOT NULL) AS has_openai_key,
           last_welcome_back_at,
           updated_at
      FROM public.user_preferences
     WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return { ...DEFAULT_PREFS };
  return rowToPrefs(rows[0]);
}

export interface PreferencesPatch {
  persona?: UserPreferences["persona"];
  openaiModel?: string | null;
  theme?: UserPreferences["theme"];
  welcomeDone?: boolean;
  workspaceCoachDone?: boolean;
  editorCoachDone?: boolean;
  uiLayout?: Record<string, unknown>;
  // ISO-8601 timestamp. null clears; undefined = no-op.
  lastWelcomeBackAt?: string | null;
}

export async function upsertPreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<UserPreferences> {
  const sql = db();
  // lastWelcomeBackAt is a Date | null payload — callers send an ISO
  // string, but postgres wants a timestamptz comparison. Normalize here
  // so the SQL below can bind a single typed value.
  const lastWelcomeBackAt =
    patch.lastWelcomeBackAt === undefined
      ? undefined
      : patch.lastWelcomeBackAt === null
        ? null
        : new Date(patch.lastWelcomeBackAt);
  const rows = await sql`
    INSERT INTO public.user_preferences (
      user_id, persona, openai_model, theme, welcome_done,
      workspace_coach_done, editor_coach_done, ui_layout, last_welcome_back_at
    )
    VALUES (
      ${userId},
      ${patch.persona ?? DEFAULT_PREFS.persona},
      ${patch.openaiModel ?? null},
      ${patch.theme ?? DEFAULT_PREFS.theme},
      ${patch.welcomeDone ?? false},
      ${patch.workspaceCoachDone ?? false},
      ${patch.editorCoachDone ?? false},
      ${sql.json((patch.uiLayout ?? {}) as JSONValue)},
      ${lastWelcomeBackAt ?? null}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      persona              = COALESCE(${patch.persona ?? null}, public.user_preferences.persona),
      openai_model         = CASE WHEN ${patch.openaiModel !== undefined} THEN ${patch.openaiModel ?? null} ELSE public.user_preferences.openai_model END,
      theme                = COALESCE(${patch.theme ?? null}, public.user_preferences.theme),
      welcome_done         = COALESCE(${patch.welcomeDone ?? null}, public.user_preferences.welcome_done),
      workspace_coach_done = COALESCE(${patch.workspaceCoachDone ?? null}, public.user_preferences.workspace_coach_done),
      editor_coach_done    = COALESCE(${patch.editorCoachDone ?? null}, public.user_preferences.editor_coach_done),
      ui_layout            = CASE WHEN ${patch.uiLayout !== undefined} THEN ${sql.json((patch.uiLayout ?? {}) as JSONValue)} ELSE public.user_preferences.ui_layout END,
      last_welcome_back_at = CASE WHEN ${lastWelcomeBackAt !== undefined} THEN ${lastWelcomeBackAt ?? null} ELSE public.user_preferences.last_welcome_back_at END,
      updated_at           = now()
    RETURNING persona, openai_model, theme, welcome_done, workspace_coach_done,
              editor_coach_done, ui_layout,
              (openai_api_key_cipher IS NOT NULL) AS has_openai_key,
              last_welcome_back_at,
              updated_at
  `;
  return rowToPrefs(rows[0]);
}

// BYOK helpers. The plaintext key never leaves the backend: `getOpenAIKey`
// is only called from the AI routes to forward to OpenAI's API, never
// serialized to the client. `setOpenAIKey` upserts so a first-time caller
// that has no preferences row yet still works — defaults are inlined.
export async function getOpenAIKey(userId: string): Promise<string | null> {
  const sql = db();
  const rows = await sql<
    Array<{ cipher: Buffer | null; nonce: Buffer | null }>
  >`
    SELECT openai_api_key_cipher AS cipher, openai_api_key_nonce AS nonce
      FROM public.user_preferences
     WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return null;
  const { cipher, nonce } = rows[0];
  if (!cipher || !nonce) return null;
  return decryptKey(cipher, nonce, userId);
}

// P-M7 (adversarial audit, bucket 4b): /ai-status needs BYOK presence +
// the "has the user ever clicked the paid-access CTA?" flag on every
// poll. Previously that was two round-trips against two different tables
// (user_preferences + paid_access_interest); after the 20260422020000
// migration, both signals live on user_preferences and a single PK
// lookup returns everything the route needs. BYOK key material is
// decrypted here so the route never handles nonce/cipher shapes.
export interface AIStatusPrefs {
  openaiKey: string | null;
  hasShownPaidInterest: boolean;
}

export async function getAIStatusPrefs(userId: string): Promise<AIStatusPrefs> {
  const sql = db();
  const rows = await sql<
    Array<{
      cipher: Buffer | null;
      nonce: Buffer | null;
      paid_access_shown_at: Date | null;
    }>
  >`
    SELECT openai_api_key_cipher AS cipher,
           openai_api_key_nonce  AS nonce,
           paid_access_shown_at
      FROM public.user_preferences
     WHERE user_id = ${userId}
  `;
  if (rows.length === 0) {
    return { openaiKey: null, hasShownPaidInterest: false };
  }
  const { cipher, nonce, paid_access_shown_at } = rows[0];
  const openaiKey =
    cipher && nonce ? decryptKey(cipher, nonce, userId) : null;
  return { openaiKey, hasShownPaidInterest: paid_access_shown_at !== null };
}

export async function setOpenAIKey(
  userId: string,
  key: string,
): Promise<void> {
  const { cipher, nonce } = encryptKey(key, userId);
  const sql = db();
  await sql`
    INSERT INTO public.user_preferences (
      user_id, openai_api_key_cipher, openai_api_key_nonce
    )
    VALUES (${userId}, ${cipher}, ${nonce})
    ON CONFLICT (user_id) DO UPDATE SET
      openai_api_key_cipher = EXCLUDED.openai_api_key_cipher,
      openai_api_key_nonce  = EXCLUDED.openai_api_key_nonce,
      updated_at            = now()
  `;
}

export async function clearOpenAIKey(userId: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.user_preferences
       SET openai_api_key_cipher = NULL,
           openai_api_key_nonce  = NULL,
           updated_at            = now()
     WHERE user_id = ${userId}
  `;
}
