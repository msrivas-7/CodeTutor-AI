// Phase 22D: streak-nudge unsubscribe route e2e.
//
// Exercises GET /api/email/unsubscribe?token=... end-to-end against the
// running backend. Skipped automatically in environments without
// EMAIL_UNSUBSCRIBE_SECRET so the spec doesn't false-fail on a stack
// that hasn't deployed Phase 22D yet (dev box pre-rebuild, CI before
// the secret is wired into refresh-env, etc.).
//
// Three scenarios:
//   1. missing token            → 401 + branded HTML page
//   2. tampered/invalid token   → 401 + branded HTML page
//   3. valid token              → 200 + branded HTML "You're unsubscribed"
//                                 + email_opt_in flipped to false in DB
//
// Token minting is duplicated here from
// backend/src/services/email/unsubscribeTokens.ts on purpose: the test
// proves the algorithms agree, not that they share an import. If a
// future change to the backend's HMAC envelope shape silently broke
// the contract, this spec catches it.

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  buildCurrentRunTestEmail,
  deleteCurrentRunTestUser,
} from "../fixtures/testIdentity";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SECRET = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? "";
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";
const API_PATH = "/api/email/unsubscribe";

// Mint a test token using the same envelope shape as the backend. Pure
// HMAC-SHA256 over base64url(userId), `<payload>.<signature>` joined.
// If this drifts from `signUnsubscribeToken`, the valid-token test
// fails — exactly the canary we want.
function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mintTestToken(userId: string, secret: string): string {
  const payload = b64url(userId);
  const sig = b64url(
    createHmac("sha256", secret).update(payload, "utf8").digest(),
  );
  return `${payload}.${sig}`;
}

const admin =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

async function createTestUserWithPrefs(): Promise<{
  userId: string;
  email: string;
}> {
  if (!admin) throw new Error("Supabase admin client not configured");
  const email = buildCurrentRunTestEmail(
    `unsub-${Date.now().toString(36)}-p${process.pid}`,
  );
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "E2E-Password-123!",
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user.id;
  // Seed a preferences row so the unsubscribe UPDATE has something to
  // touch. The trigger fixture omits this — the unsubscribe route
  // semantically succeeds even without a row, but we want to assert
  // the flip explicitly.
  const { error: insertErr } = await admin
    .from("user_preferences")
    .upsert({ user_id: userId, email_opt_in: true }, { onConflict: "user_id" });
  if (insertErr) throw insertErr;
  return { userId, email };
}

async function readEmailOptIn(userId: string): Promise<boolean | null> {
  if (!admin) return null;
  const { data, error } = await admin
    .from("user_preferences")
    .select("email_opt_in")
    .eq("user_id", userId)
    .single();
  if (error) return null;
  return data?.email_opt_in ?? null;
}

async function deleteTestUser(userId: string, email: string): Promise<void> {
  if (!admin) return;
  await deleteCurrentRunTestUser(admin, { id: userId, email });
}

const skipIfMissingSecret = !SECRET || !admin;

test.describe("Phase 22D: streak-nudge unsubscribe route", () => {
  test.skip(
    skipIfMissingSecret,
    "EMAIL_UNSUBSCRIBE_SECRET (and Supabase admin keys) required — " +
      "deploy Phase 22D backend with the KV secret wired before this spec can run",
  );

  test("missing token → 401 branded HTML", async ({ request }) => {
    const res = await request.get(`${APP_ORIGIN}${API_PATH}`);
    expect(res.status()).toBe(401);
    const body = await res.text();
    expect(body).toContain("Link no longer valid");
    expect(res.headers()["content-type"]).toMatch(/text\/html/);
  });

  test("tampered token → 401 branded HTML", async ({ request }) => {
    // Mint a real token, then mangle the signature so HMAC fails.
    const { userId, email } = await createTestUserWithPrefs();
    try {
      const real = mintTestToken(userId, SECRET);
      const [payload] = real.split(".");
      const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const res = await request.get(
        `${APP_ORIGIN}${API_PATH}?token=${tampered}`,
      );
      expect(res.status()).toBe(401);
      const body = await res.text();
      expect(body).toContain("Link no longer valid");
      // DB flag must be UNCHANGED — tampered request never mutated state.
      expect(await readEmailOptIn(userId)).toBe(true);
    } finally {
      await deleteTestUser(userId, email);
    }
  });

  test("malformed envelope (no separator) → 401", async ({ request }) => {
    const res = await request.get(
      `${APP_ORIGIN}${API_PATH}?token=notatokenatall`,
    );
    expect(res.status()).toBe(401);
  });

  test("valid token → 200 + email_opt_in flips to false in DB", async ({
    request,
  }) => {
    const { userId, email } = await createTestUserWithPrefs();
    try {
      // Sanity: precondition is opt_in = true.
      expect(await readEmailOptIn(userId)).toBe(true);
      const token = mintTestToken(userId, SECRET);
      const res = await request.get(
        `${APP_ORIGIN}${API_PATH}?token=${token}`,
      );
      expect(res.status()).toBe(200);
      const body = await res.text();
      // `escapeHtml` turns apostrophes into `&#39;`, so the literal title
      // "You're unsubscribed" never appears verbatim in the body. Assert
      // on a copy substring that survives escaping unchanged.
      expect(body).toContain("streak nudges anymore");
      expect(res.headers()["content-type"]).toMatch(/text\/html/);
      // The DB flag must now be false.
      expect(await readEmailOptIn(userId)).toBe(false);
    } finally {
      await deleteTestUser(userId, email);
    }
  });

  test("idempotent: a second click on the same token still 200s", async ({
    request,
  }) => {
    const { userId, email } = await createTestUserWithPrefs();
    try {
      const token = mintTestToken(userId, SECRET);
      const r1 = await request.get(`${APP_ORIGIN}${API_PATH}?token=${token}`);
      expect(r1.status()).toBe(200);
      expect(await readEmailOptIn(userId)).toBe(false);
      // Second click — flag is already false, but the route should
      // still 200 (idempotent unsubscribe).
      const r2 = await request.get(`${APP_ORIGIN}${API_PATH}?token=${token}`);
      expect(r2.status()).toBe(200);
      expect(await readEmailOptIn(userId)).toBe(false);
    } finally {
      await deleteTestUser(userId, email);
    }
  });
});
