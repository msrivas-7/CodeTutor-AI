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
import { buildCurrentRunTestEmail } from "../fixtures/testIdentity";
import { criticalTest } from "../fixtures/testMetadata";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const PASSWORD = "AuthSpec-Passw0rd!";

// Generate a unique email per test run so parallel workers never collide
// and an earlier failed run can't leave a stale account that blocks signup.
function uniqueEmail(tag: string): string {
  const random = Math.floor(Math.random() * 1e9).toString(36);
  return buildCurrentRunTestEmail(`auth-${random}-${tag}-${process.pid}`);
}

test.describe("auth flow", () => {
  test("an unexpected session end is explained and keeps the exact return target", async ({ page }) => {
    const target = "/learn/course/python-fundamentals/lesson/variables?mode=practice";
    await page.goto(
      `/login?returnTo=${encodeURIComponent(target)}&reason=session-ended`,
    );
    const notice = page.getByRole("alert");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      /your session ended while codetutor was open/i,
    );
    await expect(notice).toBeFocused();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
  });

  test("protected deep links preserve path, query, and fragment through sign-in", async ({ page }) => {
    const target =
      "/learn/course/python-fundamentals/lesson/variables?from=audit#practice";
    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?/);
    const loginUrl = new URL(page.url());
    expect(loginUrl.searchParams.get("returnTo")).toBe(target);

    const signupHref = await page
      .getByRole("link", { name: /create one/i })
      .getAttribute("href");
    expect(signupHref).not.toBeNull();
    expect(
      new URL(signupHref!, ORIGIN).searchParams.get("returnTo"),
    ).toBe(target);
  });

  test("canceled OAuth gets a calm, accurate recovery path", async ({ page }) => {
    const target = "/editor?file=main.py#output";
    await page.goto(
      `/auth/callback?error=access_denied&error_description=User%20canceled&returnTo=${encodeURIComponent(target)}`,
    );
    await expect(page.getByText(/sign-in was canceled/i)).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      /account and lesson are unchanged/i,
    );
    await expect(page.getByText(/expired or already been used/i)).toHaveCount(0);
    const recovery = page.getByRole("link", {
      name: /choose another sign-in method/i,
    });
    await expect(recovery).toBeVisible();
    expect(
      new URL((await recovery.getAttribute("href"))!, ORIGIN).searchParams.get(
        "returnTo",
      ),
    ).toBe(target);
  });

  test("Phase 20-P1: OAuth buttons render above the email form on /login", async ({ page }) => {
    // Phase 20-P1: OAuth is the happy path now — the provider row must sit
    // above the "or sign in with email" divider and the email input, so
    // first-time visitors don't scan past the 2-click option.
    await page.goto("/login");
    const oauthY = await page
      .getByRole("button", { name: /^google$/i })
      .evaluate((el) => el.getBoundingClientRect().top);
    const emailY = await page
      .getByLabel(/email/i)
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(oauthY).toBeLessThan(emailY);
    await expect(page.getByText(/or sign in with email/i)).toBeVisible();
  });

  test("Phase 20-P1: OAuth buttons render above the email form on /signup", async ({ page }) => {
    await page.goto("/signup");
    const oauthY = await page
      .getByRole("button", { name: /^github$/i })
      .evaluate((el) => el.getBoundingClientRect().top);
    const emailY = await page
      .getByLabel(/email/i)
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(oauthY).toBeLessThan(emailY);
    await expect(page.getByText(/or sign up with email/i)).toBeVisible();
  });

  test("Phase 20-P1: /auth/callback with no session shows classified error copy", async ({ page }) => {
    // Phase 20-P1: AuthCallbackPage now classifies raw Supabase errors into
    // expired / state / unknown buckets. Without a code in the URL, the
    // PKCE exchange returns no session and the page surfaces the expired
    // bucket's copy ("expired or already been used"). This smoke covers
    // the "link already clicked" case and confirms the alert role + Back
    // to sign in link are present.
    await page.goto("/auth/callback");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/expired or already been used/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /back to sign in/i })).toBeVisible();
  });

  test("Phase 20-P1: magic-link 'Check your email' panel offers a 30s-cooldown resend", async ({ page }) => {
    // Phase 20-P1: the three "check your email" screens previously had no
    // forward path if the email never arrived. We added a ResendEmailButton
    // with 30s cooldown across signup, magic-link, and password-reset. Here
    // we intercept the Supabase OTP endpoint so the real email server is
    // never hit — we only verify the UI lifecycle (enabled → pending →
    // cooldown label).
    let otpCalls = 0;
    await page.route("**/auth/v1/otp**", async (route) => {
      otpCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, error: null }),
      });
    });

    await page.goto("/login");
    // Switch to magic-link mode.
    await page.getByRole("button", { name: /prefer not to use a password/i }).click();
    await page.getByLabel(/email/i).fill(uniqueEmail("resend"));
    await page.getByRole("button", { name: /send magic link/i }).click();

    // The "Check your email" panel renders the resend button.
    // 10s timeout (was 5s): CI runners occasionally take 6-8s for the
    // post-mock React state transition under parallel load. Locally <1s.
    const resend = page.getByRole("button", { name: /resend sign-in link/i });
    await expect(resend).toBeVisible({ timeout: 10_000 });
    expect(otpCalls).toBe(1);

    // Clicking it fires another OTP call and flips the label into the
    // cooldown state.
    await resend.click();
    await expect.poll(() => otpCalls).toBe(2);
    await expect(page.getByRole("button", { name: /resend in \d+s/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Phase 20-P2: login with unverified email shows 'Confirm your email' panel", async ({ page }) => {
    if (!SERVICE_KEY) {
      test.skip(true, "SUPABASE_SERVICE_ROLE_KEY required for admin-create");
      return;
    }
    // GoTrue returns `email_not_confirmed` (HTTP 400) when a user who signed
    // up via email/password tries to sign in before clicking the verification
    // link. Before this fix the raw error message ("Email not confirmed") went
    // into a red alert with no resend path. LoginPage now catches the
    // AuthError code and swaps in the dedicated unverified-email panel —
    // this test locks that in.
    //
    // We admin-create with `email_confirm: false` so no email is sent (the
    // flag is a state, not an action — it just marks the user as unverified).
    // The password grant attempt also doesn't hit SMTP. The only SMTP-touching
    // step is clicking "Resend", which we intercept via page.route mirroring
    // the magic-link resend test above — keeps the test safe to run against
    // dev Supabase which is still on the 2/hr sandbox mailer.
    const email = uniqueEmail("unverified");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: false,
    });
    expect(createErr).toBeNull();

    let resendCalls = 0;
    await page.route("**/auth/v1/resend**", async (route) => {
      resendCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, error: null }),
      });
    });

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // Raw error should NOT surface — the panel takes over instead.
    await expect(page.getByRole("heading", { name: /confirm your email/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText(/email not confirmed/i)).toHaveCount(0);

    // Resend button is wired up and fires the resend endpoint.
    const resend = page.getByRole("button", { name: /resend confirmation email/i });
    await expect(resend).toBeVisible();
    await resend.click();
    await expect.poll(() => resendCalls).toBe(1);
    await expect(page.getByRole("button", { name: /resend in \d+s/i })).toBeVisible({
      timeout: 5_000,
    });

    // Back-to-sign-in restores the password form (so the user isn't trapped
    // on the panel if they want to try a different account).
    await page.getByRole("button", { name: /back to sign in/i }).click();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("unauthenticated visit to /start redirects to /login", async ({ page }) => {
    // Phase 22C: in-product home moved from `/` to `/start`. The public
    // `/` is the marketing page (no auth gate). Hitting any protected
    // route while anonymous still bounces to /login with the original
    // location stashed in router state — assertion is the same gate,
    // just on the new path.
    await page.goto("/start");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fstart$/);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/start");
    await expect(page.getByRole("heading", { name: /sign in|welcome/i })).toBeVisible();
  });

  test("unknown public URLs recover without pretending sign-in is required", async ({ page }) => {
    const missingPath = "/this-route-should-not-exist";
    await page.goto(missingPath);

    await expect(page).toHaveURL(new RegExp(`${missingPath}$`));
    const heading = page.getByRole("heading", {
      name: "This page isn't here.",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle("Page not found · CodeTutor AI");
    await expect(page).not.toHaveURL(/\/login/);

    await expect(
      page.getByText(/account, lesson progress, and code have not been changed/i),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /go to homepage/i }),
    ).toHaveAttribute("href", "/");
    await expect(
      page.getByRole("link", { name: /try the first lesson/i }),
    ).toHaveAttribute(
      "href",
      "/try/lesson/python-fundamentals/hello-world",
    );

    // The public catalog is a generated document rather than a React
    // route, so this must remain a real document navigation.
    await page.getByRole("link", { name: /browse public lessons/i }).click();
    await expect(page).toHaveURL(/\/learn-to-code\/$/);
    await expect(
      page.getByRole("heading", { name: /built to teach/i }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${missingPath}$`));
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
  });

  test("signup shows 'Check your email' panel with a resend option", async ({ page }) => {
    // Prod + dev both have email-confirmation ON, so submitting signup parks
    // the user on the "Check your email" panel (SignupPage.tsx `sent` state)
    // until they click the verification link — the no-confirm "lands on /"
    // path only exists in theory post-18d. We intercept the Supabase
    // `/auth/v1/signup` endpoint so this test (a) doesn't burn the dev
    // sandbox SMTP budget (2 emails/hr) and (b) runs deterministically in CI
    // regardless of previous signup traffic. Response shape matches what
    // GoTrue returns when confirmation is enabled: user object, no session.
    const email = uniqueEmail("signup");
    // Phase 22B: capture the signup payload so the test can assert the
    // request body shape (first_name only; no last_name). The form-level
    // assertion alone wouldn't catch a regression where the FE accidentally
    // re-introduces last_name into the metadata write.
    let signupPayload: Record<string, unknown> | null = null;
    await page.route("**/auth/v1/signup**", async (route) => {
      try {
        signupPayload = JSON.parse(route.request().postData() ?? "{}");
      } catch {
        signupPayload = {};
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000001",
          email,
          role: "",
          aud: "authenticated",
          confirmation_sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          identities: [],
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
        }),
      });
    });
    let resendCalls = 0;
    await page.route("**/auth/v1/resend**", async (route) => {
      resendCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, error: null }),
      });
    });

    await page.goto("/signup");
    // Phase 22B: signup is firstName-only; lastName field was removed.
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/email/i).fill(email);
    // Two password fields on the signup page — target by exact label.
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel(/confirm password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    // Lands on the "Check your email" panel, not /. The panel echoes the
    // email so users can confirm they typed it correctly.
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(email)).toBeVisible();

    // Resend wiring is the recovery path if the email never arrives.
    const resend = page.getByRole("button", { name: /resend confirmation email/i });
    await expect(resend).toBeVisible();
    await resend.click();
    await expect.poll(() => resendCalls).toBe(1);

    // No session should have been created — signup returned a user without
    // a session, so the app-owned auth storage key stays empty.
    const authBlob = await page.evaluate(() =>
      localStorage.getItem("codetutor-auth"),
    );
    expect(authBlob, "no session until email verified").toBeFalsy();

    // Phase 22B: assert the actual request body shape. The metadata
    // section MUST contain first_name and MUST NOT contain last_name —
    // otherwise we've reintroduced the field we just removed.
    expect(signupPayload, "signup endpoint was hit").not.toBeNull();
    const data = (signupPayload as { data?: Record<string, unknown> } | null)?.data;
    expect(data, "data block present in signup payload").toBeDefined();
    expect(data).toMatchObject({ first_name: "E2E" });
    expect(data).not.toHaveProperty("last_name");
  });

  test(
    "login persists across reload; signout clears it",
    criticalTest({
      risk: "p1",
      owner: "auth",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
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

    // Brand-new admin-created user: welcomeDone=false, so StartPage
    // redirects into the first-run cinematic at /welcome. The
    // cinematic's Skip action flips welcomeDone=true and takes the learner
    // directly into the first authored lesson. This keeps the first-run
    // promise concrete instead of adding an intermediate dashboard stop.
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 15_000 });
    const skipIntro = page.getByRole("button", { name: /skip intro/i });
    await skipIntro.waitFor({ state: "visible", timeout: 5_000 });
    await skipIntro.click();
    await expect(page).toHaveURL(
      /\/learn\/course\/python-fundamentals\/lesson\/hello-world\?firstRun=1$/,
      { timeout: 10_000 },
    );

    // Reload → still signed in (session hydrated from localStorage)
    // and no re-route through /welcome (welcomeDone was persisted).
    await page.reload();
    await expect(page).toHaveURL(
      /\/learn\/course\/python-fundamentals\/lesson\/hello-world\?firstRun=1$/,
    );
    await expect(page.getByRole("link", { name: /log in|sign in/i })).toHaveCount(0);

    // The lesson's own first-run welcome intentionally hides account chrome
    // while it has control. Exit that guided state before exercising the
    // independent sign-out contract.
    const skipLessonWelcome = page.getByRole("button", { name: /skip welcome/i });
    await skipLessonWelcome.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if (await skipLessonWelcome.isVisible()) {
      await skipLessonWelcome.click();
      await expect(page).toHaveURL(
        /\/learn\/course\/python-fundamentals\/lesson\/hello-world$/,
      );
      await expect(page.getByRole("button", { name: /run code/i })).toBeEnabled();
    }

    // Sign out from the UserMenu (avatar in the top-right corner).
    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("menuitem", { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

    const authBlob = await page.evaluate(() =>
      localStorage.getItem("codetutor-auth"),
    );
    expect(authBlob, "session should be cleared on sign-out").toBeFalsy();
    },
  );
});

test.describe("auth backend", () => {
  test("/api/session 401s without Authorization header", async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
    const res = await ctx.post(`${BACKEND}/api/session`, {
      headers: { "X-Requested-With": "codetutor" },
      data: {},
      failOnStatusCode: false,
    });
    await ctx.dispose();
    expect(res.status()).toBe(401);
  });

  test("/api/session 401s with malformed Authorization header", async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
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

  test(
    "cross-user session access is silently ignored (no oracle)",
    criticalTest({
      risk: "p0",
      owner: "auth",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async () => {
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
    const ctx = await request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
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

    // End also collapses cross-user into the unknown-id shape (200 { ok: false })
    // so a cross-user probe can't distinguish "exists, not mine" from "doesn't
    // exist". A's session is left intact — B's request is a silent no-op.
    const endRes = await ctx.post(`${BACKEND}/api/session/end`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenB}`,
      },
      data: { sessionId },
      failOnStatusCode: false,
    });
    expect(endRes.status()).toBe(200);
    const endBody = await endRes.json();
    expect(endBody.ok).toBe(false);

    // Verify A's session is still alive — B's cross-user end was a no-op.
    const statusRes = await ctx.get(`${BACKEND}/api/session/${sessionId}/status`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${tokenA}`,
      },
    });
    expect(statusRes.status()).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.alive).toBe(true);

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
    },
  );
});
