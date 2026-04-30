// Phase 20-P5: Admin Controls visibility gate.
//
// The hidden Settings → Admin tab is gated on `user.app_metadata.role`
// === "admin", populated by the Supabase Custom Access Token Hook
// (`public.attach_role_claim`). Without that hook wired, no JWT carries
// the claim — non-admin path is the only deterministic e2e until the
// hook is set up in the dev project's Supabase Dashboard.
//
// What this spec guarantees:
//   1. Non-admin user opening Settings sees Account / AI / Appearance /
//      Data tabs but NOT Admin. Hard guarantee — even if a user crafted
//      JWT carries app_metadata.role=admin, the backend's adminGuard
//      double-checks the user_roles table.
//   2. Hitting /api/admin/users without admin claim returns 403.
//
// Admin-path tests (override flow, project caps edit, audit log read,
// safety-guard ladder) require:
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

  test("non-admin user: Settings opens; no Admin tab in the nav", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");
    await S.openSettings(page);

    // Settings panel renders. Phase 24A: three user tabs (Profile, Tutor,
    // Account) — Appearance + Data folded back into Profile + Account.
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^profile$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^tutor$/i }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^account$/i }).first(),
    ).toBeVisible();

    // The Admin tab MUST NOT render for a non-admin. Settings panel
    // visibility-filters it via authStore.isAdmin().
    await expect(
      page.getByRole("button", { name: /^admin$/i }),
    ).toHaveCount(0);
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
