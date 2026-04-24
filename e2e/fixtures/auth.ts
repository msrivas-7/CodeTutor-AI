// Phase 18a: auth helpers for Playwright specs.
//
// Every protected route in the app now requires a Supabase session. Rather
// than click through the login UI in each spec (slow + brittle + burns
// GoTrue rate limits under parallel workers), we:
//
//  1. admin-create a per-worker test user in globalSetup (via the Supabase
//     service_role key from ../.env or CI secrets);
//  2. sign that user in once, snapshot the session JSON, and
//  3. inject it into the page's localStorage under the same storageKey the
//     frontend's supabaseClient uses (`codetutor-auth`) BEFORE any app
//     script runs — so `supabase.auth.getSession()` on boot finds a live
//     session and `<RequireAuth>` renders children immediately.
//
// Each Playwright worker gets its own user (suffix by worker index) so
// user-keyed rate-limit buckets don't collide across parallel tests.

import { test as baseTest, request as playwrightRequest } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const BACKEND_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    // boot.ts asserts these already, but we double-check because this module
    // is imported by every spec — if someone runs a single spec bypassing
    // globalSetup, the failure mode should still be loud.
    throw new Error(
      `auth.ts: ${name} is required. Populate \`../.env\` from \`../.env.example\`.`,
    );
  }
  return v;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const STORAGE_KEY = "codetutor-auth";
const PASSWORD = "E2E-Password-123!";

// Admin client — service_role, talks to /auth/v1/admin. NEVER expose this
// key in the browser.
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Per-worker identity so parallel specs don't share a user (and thus a
// user-keyed rate-limit bucket). Playwright sets TEST_WORKER_INDEX in the
// fixture runtime; fall back to a PID + random suffix for one-off usage.
function workerEmail(workerIndex: number): string {
  const suffix =
    process.env.E2E_USER_SUFFIX ?? `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
  return `e2e-w${workerIndex}-${suffix}@codetutor.test`;
}

type CachedUser = {
  email: string;
  userId: string;
  session: Session;
};

// Cache the worker's session in-process so we sign in once per worker
// rather than once per test. The access token is valid an hour — plenty
// for a full spec run.
const workerCache = new Map<number, Promise<CachedUser>>();
const createdUserIds = new Set<string>();

// Walk every page of `/auth/v1/admin/users`. GoTrue caps perPage at 1000;
// if a CI environment ever accumulates more test users than that (e.g. the
// teardown was skipped across multiple runs) a single-page listing would
// silently miss rows and leave the stale pile to grow forever.
async function listAllUsers(): Promise<User[]> {
  const out: User[] = [];
  let page = 1;
  // Hard ceiling on pagination depth so a misbehaving GoTrue can't put us
  // in an infinite loop; 50 pages × 1000 per page = 50k users, well beyond
  // anything our E2E suite would ever produce.
  const MAX_PAGES = 50;
  while (page <= MAX_PAGES) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    if (data.users.length === 0) break;
    out.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return out;
}

async function createOrReuseUser(email: string): Promise<string> {
  // `createUser` returns the existing record when email collides (by
  // design — this endpoint is idempotent on the email key as of GoTrue
  // 2.x). We still rely on email_confirm:true so the session we issue
  // downstream lands with email_verified = true.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    // Supabase returns 422 with "User already registered" when the email
    // exists. We can still sign in, so treat this as a non-fatal reuse.
    const isDuplicate = /already registered|already exists/i.test(error.message);
    if (!isDuplicate) throw error;
    // Look the user up so we can track the id for teardown.
    const users = await listAllUsers();
    const existing = users.find((u) => u.email === email);
    if (!existing) throw error;
    return existing.id;
  }
  createdUserIds.add(data.user.id);
  return data.user.id;
}

async function freshSession(email: string): Promise<Session> {
  // Use a short-lived anon client with in-memory storage so sign-in here
  // doesn't touch node filesystem or collide with any other Supabase
  // instance in the test process.
  const store = new Map<string, string>();
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      flowType: "pkce",
      detectSessionInUrl: false,
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
    },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  if (!data.session) throw new Error("signIn returned no session");
  return data.session;
}

/**
 * Ensure a per-worker test user exists and has a live session. Memoized:
 * subsequent calls in the same worker return the cached result.
 */
export async function getWorkerUser(workerIndex: number): Promise<CachedUser> {
  const cached = workerCache.get(workerIndex);
  if (cached) return cached;
  const email = workerEmail(workerIndex);
  const promise = (async () => {
    const userId = await createOrReuseUser(email);
    const session = await freshSession(email);
    // First-run-cinematic redirect gate: new users land on `/welcome`
    // until `welcomeDone === true`. E2E users are admin-created and
    // default to welcomeDone=false, which would route every spec
    // through the greeting screen. Patch the prefs once per
    // worker-user so the rest of the suite sees the "returning user"
    // shape of the product. Specs that want to exercise the first-run
    // flow skip this helper and use `getFirstRunUser` below.
    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Origin: APP_ORIGIN,
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    });
    try {
      await ctx
        .patch(`${BACKEND_URL}/api/user/preferences`, {
          data: { welcomeDone: true },
        })
        .catch(() => {
          // Non-fatal — the suite can still drive most flows even if
          // the patch fails; at worst the test redirects through
          // /welcome and eats the cinematic budget once.
        });
    } finally {
      await ctx.dispose();
    }
    return { email, userId, session };
  })();
  workerCache.set(workerIndex, promise);
  return promise;
}

/**
 * Inject a Supabase session into the page's localStorage before any app
 * code runs. Call INSIDE a test's setup (beforeEach or top of the test),
 * before `page.goto`. The injected session key matches the `storageKey`
 * configured on the frontend's supabaseClient.
 */
export async function loginAsTestUser(
  page: Page,
  workerIndex: number,
): Promise<CachedUser> {
  const user = await getWorkerUser(workerIndex);
  const storedSession = {
    access_token: user.session.access_token,
    refresh_token: user.session.refresh_token,
    expires_at: user.session.expires_at,
    expires_in: user.session.expires_in,
    token_type: user.session.token_type,
    user: user.session.user,
  };
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: JSON.stringify(storedSession) },
  );
  return user;
}

/**
 * Purge every test user whose email begins with `e2e-w`. Invoked by
 * globalTeardown.ts after the suite completes.
 *
 * We can't rely on `createdUserIds` here — globalTeardown runs in a
 * different process than the workers that created users, so it would see
 * an empty set. Listing by email prefix also sweeps users left behind by
 * earlier crashed runs, which keeps the local Supabase instance clean
 * without manual intervention. The paginated walk matters here: if a
 * previous teardown failed mid-delete and the pile grew past 1000, a
 * single-page listing would silently leave the excess behind every run.
 */
export async function teardownTestUsers(): Promise<void> {
  createdUserIds.clear();
  let users: User[];
  try {
    users = await listAllUsers();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("[auth teardown] listAllUsers failed:", msg);
    return;
  }
  const toDelete = users.filter(
    (u) => typeof u.email === "string" && u.email.startsWith("e2e-w"),
  );
  if (toDelete.length === 0) return;
  const results = await Promise.allSettled(
    toDelete.map((u) => admin.auth.admin.deleteUser(u.id)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(
      `[auth teardown] ${failed}/${toDelete.length} delete calls failed`,
    );
  }
}

/**
 * Convenience `test` export with a `worker` fixture pre-logged-in. Use this
 * in specs that don't need anything beyond "user is authenticated":
 *
 *   import { test } from "../fixtures/auth";
 *   test("does a thing", async ({ page }) => { ... });
 *
 * Specs that want finer control (e.g. signup.spec.ts which tests the
 * unauthenticated path) can still import `test` from @playwright/test.
 */
// Playwright's `pagehide` → keepalive-fetch endSession path is unreliable
// during context teardown: the browser process gets torn down before the
// request leaves the wire, so many tests leak their session into the backend
// Map. That pile-up is what trips the per-user `MAX_SESSIONS_PER_USER` cap
// (CI: 20) and surfaces as spurious 429 "Too many requests" banners in
// downstream tests for the same worker.
//
// Fix: sniff POST /api/session responses for the session id the test spun
// up, then explicitly end each one after the spec body returns via a
// backend-only request context (the page has already closed by teardown
// time, so in-browser fetch won't work).
export const test = baseTest.extend({
  page: async ({ page }, use, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);

    const createdSessionIds = new Set<string>();
    // Each response's body read is async; stash the promises so we can await
    // them before teardown — Playwright doesn't block on `page.on` callbacks
    // and the test could finish before a late JSON parse resolves.
    const inflight: Promise<unknown>[] = [];
    page.on("response", (res) => {
      if (res.request().method() !== "POST") return;
      const path = new URL(res.url()).pathname;
      if (path !== "/api/session" && path !== "/api/session/rebind") return;
      if (!res.ok()) return;
      inflight.push(
        res
          .json()
          .then((body) => {
            const id = (body as { sessionId?: unknown }).sessionId;
            if (typeof id === "string" && id.length > 0) createdSessionIds.add(id);
          })
          .catch(() => {
            // Body may already be consumed / not JSON — ignore; the sweeper
            // still reaps idle containers within ~2m if we miss one.
          }),
      );
    });

    await use(page);
    await Promise.allSettled(inflight);

    if (createdSessionIds.size > 0) {
      const user = await getWorkerUser(testInfo.workerIndex);
      const ctx = await playwrightRequest.newContext({
        extraHTTPHeaders: {
          Origin: APP_ORIGIN,
          "X-Requested-With": "codetutor",
          Authorization: `Bearer ${user.session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      try {
        await Promise.all(
          [...createdSessionIds].map((sessionId) =>
            ctx
              .post(`${BACKEND_URL}/api/session/end`, {
                data: { sessionId },
              })
              .catch(() => {
                // Best-effort: a stray 404 (already reaped) or transient
                // network hiccup here must not fail the test.
              }),
          ),
        );
      } finally {
        await ctx.dispose();
      }
    }
  },
});

export { expect } from "@playwright/test";
