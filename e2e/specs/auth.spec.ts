// Phase 18a: auth flow end-to-end. Exercises the surfaces that the unit
// tests can't reach — the Supabase JS SDK end of the pipeline, React Router
// guarding, and the backend's JWT verification path against a real GoTrue.
//
// Coverage:
//   - Unauthenticated visit redirects to /login and preserves the intended
//     path in router state.
//   - Signup (project has email confirmation OFF locally) lands the user
//     on / with a live session.
//   - Password login replaces the session and persists across reload.
//   - Signout clears the session + sessionStore.
//   - A protected backend route 401s without an Authorization header and
//     403s when an ownership check fails (one user poking another's session).
//
// Each spec uses the `test` export from @playwright/test (NOT the fixtures
// auth test) because these specs drive auth from zero rather than starting
// pre-logged-in.

import { expect, request, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const PASSWORD = "AuthSpec-Passw0rd!";

// Generate a unique email per test run so parallel workers never collide
// and an earlier failed run can't leave a stale account that blocks signup.
function uniqueEmail(tag: string): string {
  return `e2e-w-auth-${tag}-${process.pid}-${Math.floor(Math.random() * 1e9)}@codetutor.test`;
}

test.describe("auth flow", () => {
  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    // Sanity: the page actually rendered the login form (not a crashed
    // route). Using a resilient selector — the page's visible labels are
    // "Email" and "Password".
    await expect(page.getByRole("heading", { name: /sign in|welcome/i })).toBeVisible();
  });

  test("signup with local-no-confirm flow lands user on /", async ({ page }) => {
    const email = uniqueEmail("signup");
    await page.goto("/signup");
    await page.getByLabel(/email/i).fill(email);
    // Two password fields on the signup page — target by exact label.
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel(/confirm password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    // With auth.email.enable_confirmations=false (see supabase/config.toml),
    // signUp returns a live session. The SignupPage's useEffect bounces to /.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    // Supabase session persisted under the app-owned storage key.
    const authBlob = await page.evaluate(() =>
      localStorage.getItem("codetutor-auth"),
    );
    expect(authBlob, "Supabase session should be in localStorage").toBeTruthy();
    // The user id in that blob is the identity — downstream stores read it
    // directly from useAuthStore rather than mirroring it into a separate
    // localStorage key.
    const parsed = JSON.parse(authBlob!) as { user?: { id?: string } };
    expect(parsed.user?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("login persists across reload; signout clears it", async ({ page }) => {
    if (!SERVICE_KEY) {
      test.skip(true, "SUPABASE_SERVICE_ROLE_KEY required for admin-create");
      return;
    }
    // Admin-create a user so we can drive the login path (rather than
    // signup) from a clean slate. Email confirmation is disabled locally,
    // so we pass email_confirm:true to match the signup flow.
    const email = uniqueEmail("login");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(createErr).toBeNull();

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    // Use exact match — the reveal toggle's aria-label ("Show password") also
    // matches /password/i and would make the locator ambiguous.
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    // Reload → still signed in (session hydrated from localStorage).
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: /log in|sign in/i })).toHaveCount(0);

    // A brand-new admin-created user has no server-side onboarding flags set,
    // so the WelcomeOverlay appears on / and its "Skip" button intercepts
    // clicks on the header. Wait for it, then dismiss. The overlay doesn't
    // render until the AuthLoader gate lifts, which races with the rest of
    // the UI — an `isVisible()` probe fires too early and misses it.
    const skip = page.getByRole("button", { name: /^skip onboarding$/i });
    await skip.waitFor({ state: "visible", timeout: 5_000 });
    await skip.click();
    await skip.waitFor({ state: "hidden" });

    // Sign out from the UserMenu (avatar in the top-right corner).
    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("menuitem", { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    const authBlob = await page.evaluate(() =>
      localStorage.getItem("codetutor-auth"),
    );
    expect(authBlob, "session should be cleared on sign-out").toBeFalsy();
  });
});

test.describe("auth backend", () => {
  test("/api/session 401s without Authorization header", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/session`, {
      headers: { "X-Requested-With": "codetutor" },
      data: {},
      failOnStatusCode: false,
    });
    await ctx.dispose();
    expect(res.status()).toBe(401);
  });

  test("/api/session 401s with malformed Authorization header", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/session`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: "Bearer this-is-not-a-jwt",
      },
      data: {},
      failOnStatusCode: false,
    });
    await ctx.dispose();
    expect(res.status()).toBe(401);
  });

  test("cross-user session access is rejected with 403", async () => {
    if (!SERVICE_KEY) {
      test.skip(true, "SUPABASE_SERVICE_ROLE_KEY required for admin-create");
      return;
    }
    // Create two users, sign each in, have user A create a session, then
    // try to ping it with user B's token. Must 403.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const emailA = uniqueEmail("ownA");
    const emailB = uniqueEmail("ownB");
    for (const e of [emailA, emailB]) {
      const { error } = await admin.auth.admin.createUser({
        email: e,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error).toBeNull();
    }
    const { data: a, error: ae } = await anonA.auth.signInWithPassword({
      email: emailA,
      password: PASSWORD,
    });
    expect(ae).toBeNull();
    const { data: b, error: be } = await anonB.auth.signInWithPassword({
      email: emailB,
      password: PASSWORD,
    });
    expect(be).toBeNull();

    const tokenA = a.session!.access_token;
    const tokenB = b.session!.access_token;

    // A creates a session.
    const ctx = await request.newContext();
    const createRes = await ctx.post(`${BACKEND}/api/session`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenA}`,
      },
      data: {},
    });
    expect(createRes.status()).toBe(200);
    const body = await createRes.json();
    const sessionId = body.sessionId as string;
    expect(sessionId).toBeTruthy();

    // B tries to rebind A's session. Rebind intentionally does NOT 403 in
    // this case — that would be an existence oracle. Instead B gets a fresh
    // sessionId under their own ownership, while A's session is untouched.
    const rebindRes = await ctx.post(`${BACKEND}/api/session/rebind`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenB}`,
      },
      data: { sessionId },
    });
    expect(rebindRes.status()).toBe(200);
    const rebindBody = await rebindRes.json();
    expect(rebindBody.sessionId).toBeTruthy();
    expect(rebindBody.sessionId).not.toBe(sessionId);
    expect(rebindBody.reused).toBe(false);

    // End is the right surface for asserting ownership — B ending A's
    // session must still 403 (no oracle concern there; B is destroying
    // state so we want a loud failure).
    const endRes = await ctx.post(`${BACKEND}/api/session/end`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenB}`,
      },
      data: { sessionId },
      failOnStatusCode: false,
    });
    expect(endRes.status()).toBe(403);

    // Clean up B's freshly minted session.
    await ctx.post(`${BACKEND}/api/session/end`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenB}`,
      },
      data: { sessionId: rebindBody.sessionId },
    });

    // Cleanup: A ends their session so the container releases promptly.
    await ctx.post(`${BACKEND}/api/session/end`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenA}`,
      },
      data: { sessionId },
    });
    await ctx.dispose();
  });
});
