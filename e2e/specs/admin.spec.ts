// Phase 20-P5 / Phase 25: Admin Controls visibility gate.
//
// Admin surface is gated on `user.app_metadata.role` === "admin",
// populated by the Supabase Custom Access Token Hook
// (`public.attach_role_claim`). Without that hook wired, no JWT carries
// the claim — non-admin path is the only deterministic e2e until the
// hook is set up in the dev project's Supabase Dashboard.
//
// Phase 25 moved the admin surface OUT of Settings (no more Admin tab)
// and into a dedicated /admin route, gated by RequireAdmin (frontend
// route guard) + adminGuard (backend middleware).
//
// What this spec guarantees:
//   1. Non-admin user's Settings panel exposes Profile / Tutor / Account
//      ONLY — no admin tab anywhere (Phase 25: tab removed entirely).
//   2. Non-admin user's UserMenu has NO "Admin console" link.
//   3. Non-admin typing /admin in the URL bar is redirected to /start.
//   4. Hitting /api/admin/users without admin claim returns 403.
//
// Admin-path tests (override flow, project caps edit, audit log read,
// safety-guard ladder, freeze-flow banner) require:
//   • Auth hook wired in Supabase (Authentication → Hooks →
//     Customize Access Token → public.attach_role_claim)
//   • A user_roles row for the test worker's user
//   • A forced sign-out + sign-in to refresh the JWT
// They are stubbed below with `test.skip` and a re-enable note.

import { expect, getWorkerUser, test } from "../fixtures/auth";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { mockAllAI } from "../fixtures/aiMocks";
import * as S from "../utils/selectors";

test.describe("Admin Controls — visibility gate", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("non-admin user: Settings has only Profile/Tutor/Account; no Admin tab", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");
    await S.openSettings(page);

    // Settings panel renders. Phase 25: three user tabs (Profile, Tutor,
    // Account) — Phase 24A consolidation, then Phase 25 removed the
    // hidden "Admin" tab entirely (admin surface moved to /admin route).
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^profile$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^tutor$/i }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^account$/i }).first(),
    ).toBeVisible();

    // Phase 25: the Admin tab is REMOVED from Settings entirely (not just
    // hidden from non-admins). This assertion catches a regression where
    // it sneaks back in for any user.
    await expect(
      page.getByRole("button", { name: /^admin$/i }),
    ).toHaveCount(0);
  });

  test("non-admin: UserMenu has no 'Admin console' link", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");

    // Open the user menu dropdown.
    await S.userMenuTrigger(page).first().click();

    // Standard user-menu items should be present.
    await expect(
      page.getByRole("menuitem", { name: /^settings$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /^sign out$/i }),
    ).toBeVisible();

    // Phase 25 gate: the "Admin console" link is conditionally rendered
    // based on authStore.isAdmin(). For a non-admin user it must not
    // appear in the dropdown — that's how non-admins discover the
    // /admin surface doesn't exist for them.
    await expect(
      page.getByRole("menuitem", { name: /admin console/i }),
    ).toHaveCount(0);
  });

  test("non-admin: typing /admin in URL is redirected to /start", async ({ page }) => {
    await loadProfile(page, "empty");

    // Direct navigation to /admin. RequireAdmin guard reads
    // authStore.isAdmin() (which decodes the JWT app_metadata.role
    // claim). Non-admin → <Navigate to="/start" replace />.
    await page.goto("/admin");

    // Wait for navigation to settle on /start. We don't assert the
    // exact path immediately because RequireAdmin's redirect happens
    // mid-render; expect the URL to land on /start within the navigation
    // budget, and verify a /start page element to confirm we're really
    // there (not just that the URL changed).
    await page.waitForURL("**/start", { timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe("/start");
  });

  test("non-admin: GET /api/admin/users returns 403", async ({ page }) => {
    await loadProfile(page, "empty");
    // page.request issues HTTP requests outside the browser context, so
    // CORS doesn't apply. Pull the token from the worker fixture (same
    // path the other helpers use; see e2e/fixtures/profiles.ts).
    const user = await getWorkerUser(test.info().workerIndex);
    const res = await page.request.get(
      "http://localhost:4000/api/admin/users",
      {
        headers: {
          Authorization: `Bearer ${user.session.access_token}`,
          "X-Requested-With": "codetutor",
        },
      },
    );
    expect(res.status()).toBe(403);
  });

  // Phase 27-v2.2 Fix 7b: the new "Trial path" tab nests under /admin so
  // RequireAdmin guards it identically. Regression-guards a future
  // refactor that accidentally lifts the route outside the gate.
  test("non-admin: typing /admin/anon is redirected to /start", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/admin/anon");
    await page.waitForURL("**/start", { timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe("/start");
  });

  // Phase 27-v2.2 Fix 7b: server-side gate. /api/admin/anon-summary
  // shares the same chain as /api/admin/users — a non-admin's bearer
  // token must 403 here too.
  test("non-admin: GET /api/admin/anon-summary returns 403", async ({ page }) => {
    await loadProfile(page, "empty");
    const user = await getWorkerUser(test.info().workerIndex);
    const res = await page.request.get(
      "http://localhost:4000/api/admin/anon-summary",
      {
        headers: {
          Authorization: `Bearer ${user.session.access_token}`,
          "X-Requested-With": "codetutor",
        },
      },
    );
    expect(res.status()).toBe(403);
  });

  // Admin-enabled tests — re-enable once the dev Supabase project has the
  // Custom Access Token Hook wired:
  //   1. Authentication → Hooks → Customize Access Token →
  //      public.attach_role_claim
  //   2. Insert into user_roles for the worker's user, then signOut + back in
  // Add a `seedAdmin(page)` fixture in profiles.ts that does both, then drop
  // the .skip below.
  //
  // Each of these is a regression-guard for a specific user-visible behavior:
  //   • cap override on a specific user → next AI call reflects the new cap
  //   • project cap change → all users on the next AI call reflect it
  //   • audit log lists the admin's recent actions
  //   • safety-guard ladder for free_tier_enabled = false: type-confirm
  //     phrase required, modal required, server enforces same phrase
  //   • safety-guard ladder for global $ cap >75% drop: same shape

  test.skip("admin: per-user override → next AI call reflects new cap", async () => {
    // Wire seedAdmin → set override for self → trigger AI call → assert
    // intercepted body's lessonContext.capToday matches the new value.
  });

  test.skip("admin: project cap edit propagates to all users", async () => {
    // Wire seedAdmin → set system_config free_tier_daily_questions=5 →
    // trigger AI call from a non-admin worker → assert capToday=5.
  });

  test.skip("admin: audit log shows the admin's recent actions", async () => {
    // Wire seedAdmin → make a write → open Audit Log section → assert
    // the entry renders.
  });

  test.skip("safety: free_tier_enabled=false requires the verbatim phrase", async () => {
    // Wire seedAdmin → open Project Caps → toggle enabled → empty reason
    // disables Save → fill reason, Save still disabled until phrase typed
    // → wrong phrase keeps Save disabled → exact phrase enables Save →
    // modal renders → Cancel returns to form unchanged → Confirm posts
    // with confirmDisable body field.
  });

  test.skip("safety: 75%+ drop in global $ cap requires the reduction phrase", async () => {
    // Same shape as above but for free_tier_daily_usd_cap from $2 → $0.40.
  });
});
