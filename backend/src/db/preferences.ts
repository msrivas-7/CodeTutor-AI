import type { JSONValue } from "postgres";
import { db } from "./client.js";
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
  updatedAt: new Date(0).toISOString(),
};

interface Row {
  persona: string;
  openai_model: string | null;
  theme: string;
  welcome_done: boolean;
  workspace_coach_done: boolean;
  editor_coach_done: boolean;
  ui_layout: Record<string, unknown>;
  has_openai_key: boolean;
  updated_at: Date;
}

function rowToPrefs(r: Row): UserPreferences {
  return {
    persona: r.persona as UserPreferences["persona"],
    openaiModel: r.openai_model,
    theme: r.theme as UserPreferences["theme"],
    welcomeDone: r.welcome_done,
    workspaceCoachDone: r.workspace_coach_done,
    editorCoachDone: r.editor_coach_done,
    uiLayout: r.ui_layout ?? {},
    hasOpenaiKey: r.has_openai_key,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const sql = db();
  const rows = await sql<Row[]>`
    SELECT persona, openai_model, theme, welcome_done, workspace_coach_done,
           editor_coach_done, ui_layout,
           (openai_api_key_cipher IS NOT NULL) AS has_openai_key,
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
}

export async function upsertPreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<UserPreferences> {
  const sql = db();
  const rows = await sql<Row[]>`
    INSERT INTO public.user_preferences (
      user_id, persona, openai_model, theme, welcome_done,
      workspace_coach_done, editor_coach_done, ui_layout
    )
    VALUES (
      ${userId},
      ${patch.persona ?? DEFAULT_PREFS.persona},
      ${patch.openaiModel ?? null},
      ${patch.theme ?? DEFAULT_PREFS.theme},
      ${patch.welcomeDone ?? false},
      ${patch.workspaceCoachDone ?? false},
      ${patch.editorCoachDone ?? false},
      ${sql.json((patch.uiLayout ?? {}) as JSONValue)}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      persona              = COALESCE(${patch.persona ?? null}, public.user_preferences.persona),
      openai_model         = CASE WHEN ${patch.openaiModel !== undefined} THEN ${patch.openaiModel ?? null} ELSE public.user_preferences.openai_model END,
      theme                = COALESCE(${patch.theme ?? null}, public.user_preferences.theme),
      welcome_done         = COALESCE(${patch.welcomeDone ?? null}, public.user_preferences.welcome_done),
      workspace_coach_done = COALESCE(${patch.workspaceCoachDone ?? null}, public.user_preferences.workspace_coach_done),
      editor_coach_done    = COALESCE(${patch.editorCoachDone ?? null}, public.user_preferences.editor_coach_done),
      ui_layout            = CASE WHEN ${patch.uiLayout !== undefined} THEN ${sql.json((patch.uiLayout ?? {}) as JSONValue)} ELSE public.user_preferences.ui_layout END,
      updated_at           = now()
    RETURNING persona, openai_model, theme, welcome_done, workspace_coach_done,
              editor_coach_done, ui_layout,
              (openai_api_key_cipher IS NOT NULL) AS has_openai_key,
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
