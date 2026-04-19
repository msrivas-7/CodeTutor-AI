// Dev profile switcher specs (Phase 8c). Exercises the Cmd/Ctrl+Shift+Alt+D
// shortcut, the General ⇄ Developer tabs that appear only when dev mode is
// on, profile apply + reload, exit-profile → real snapshot restoration, and
// the API-key allow-list that keeps non-owned keys untouched across swaps.

import { expect, test, type Page } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import { markOnboardingDone, seedApiKey } from "../fixtures/profiles";
import * as S from "../utils/selectors";

// The app's DevShortcut uses `e.code === "KeyD"` so it survives Option-key
// glyph transforms on macOS. The handler accepts either metaKey or ctrlKey —
// we use Control so the test works identically on all platforms and doesn't
// depend on OS keyboard layout.
async function toggleDevMode(page: Page): Promise<void> {
  // Wait for the SPA to hydrate — DevShortcut registers its window-level
  // keydown listener in a useEffect, so we need React to have committed at
  // least once or the press is a no-op. The settings gear renders on every
  // page and is a reliable "app is alive" sentinel.
  await S.settingsButton(page).first().waitFor({ state: "visible", timeout: 10_000 });
  const before = await page.evaluate(() => localStorage.getItem("__dev__:enabled"));
  // Focus body so the keyboard event isn't swallowed by a stray focused input.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+Shift+Alt+KeyD");
  const target = before === "1" ? null : "1";
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("__dev__:enabled")), {
      timeout: 5_000,
    })
    .toBe(target);
}

async function openSettings(page: Page): Promise<void> {
  await S.settingsButton(page).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe("dev profiles", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
    // Start every test from a clean slate: wipe __dev__:* flags so the toggle
    // starts from "off". profiles.loadProfile only wipes learner:v1:* — we
    // wipe __dev__:* here.
    //
    // Critical: only wipe on the FIRST navigation of this test. Tests that
    // deliberately reload (Apply → reloadSoon) would otherwise lose the
    // __dev__:enabled flag they just set, causing the Developer tab to
    // disappear and cascade failures. sessionStorage is per-origin and
    // per-tab, so it's the right scope for "first paint of this test".
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("__e2e_dev_wiped__")) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith("__dev__:")) localStorage.removeItem(k);
        }
        sessionStorage.setItem("__e2e_dev_wiped__", "1");
      }
    });
  });

  test("shortcut toggles dev mode: toast, tabs appear, toast on exit", async ({ page }) => {
    await page.goto("/");
    // Pre-toggle: no dev flag in localStorage.
    expect(await page.evaluate(() => localStorage.getItem("__dev__:enabled"))).toBeNull();

    await toggleDevMode(page);
    // Toast surface has role="status" and the "enabled" copy.
    await expect(
      page.locator('[role="status"]').filter({ hasText: /dev mode enabled/i }).first(),
    ).toBeVisible({ timeout: 3_000 });
    // Dev flag in localStorage.
    await expect.poll(async () =>
      page.evaluate(() => localStorage.getItem("__dev__:enabled")),
    ).toBe("1");

    // Tabs now render in Settings. Open it — gear button is on the start page.
    await openSettings(page);
    await expect(page.getByRole("tab", { name: /^general$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^developer$/i })).toBeVisible();
    await page.keyboard.press("Escape");

    // Exit shortcut — toast returns.
    await toggleDevMode(page);
    await expect(
      page.locator('[role="status"]').filter({ hasText: /dev mode disabled/i }).first(),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("Applying a profile seeds its localStorage state after reload", async ({ page }) => {
    await page.goto("/");
    await toggleDevMode(page);
    await openSettings(page);

    // Switch to Developer tab.
    await page.getByRole("tab", { name: /^developer$/i }).click();

    // Select the "all-complete" profile via the profile <select>. Options are
    // <option value={profile.id}>...</option>, so match by value.
    const profileSelect = page.getByRole("combobox").first();
    await profileSelect.selectOption("all-complete");

    // Click Apply — this calls window.location.reload() via reloadSoon().
    // Stub reload so the addInitScript doesn't fire again and wipe __dev__.
    // `window.location.reload` is read-only in modern browsers, so the
    // assignment may silently no-op. To guard against that, we fold ALL
    // assertions into a single waitForFunction so they complete before the
    // reload can fire (and strip __dev__:*).
    await page.evaluate(() => {
      try { window.location.reload = () => {}; } catch { /* noop */ }
    });
    await page.getByRole("button", { name: /^apply$/i }).click();

    // Wait for both the 12-lesson progress row AND the active profile id.
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem("learner:v1:progress:python-fundamentals");
        const activeId = localStorage.getItem("__dev__:activeProfileId");
        if (!raw || activeId !== "all-complete") return false;
        try {
          const p = JSON.parse(raw) as { completedLessonIds: string[] };
          return (p.completedLessonIds?.length ?? 0) >= 12;
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 10_000 },
    );
  });

  test("Apply respects the API-key allow-list (does not wipe codetutor:* keys)", async ({ page }) => {
    // Seed a fake API key BEFORE toggling dev mode — the allow-list should
    // keep it intact across profile applies.
    await seedApiKey(page, { key: "sk-test-preserved", model: "gpt-4o-mini" });

    await page.goto("/");
    await toggleDevMode(page);
    await openSettings(page);
    await page.getByRole("tab", { name: /^developer$/i }).click();

    // Pick "fresh-install" which has no AI keys in its seed.
    const profileSelect = page.getByRole("combobox").first();
    await profileSelect.selectOption("fresh-install");

    await page.evaluate(() => {
      try { window.location.reload = () => {}; } catch { /* noop */ }
    });
    await page.getByRole("button", { name: /^apply$/i }).click();

    // Wait for BOTH the profile id to land AND the API key to still be there.
    // Folding both into one waitForFunction avoids a TOCTOU window where the
    // page reloads (the stub above is unreliable — reload can be read-only)
    // between the two assertions.
    await page.waitForFunction(
      () =>
        localStorage.getItem("__dev__:activeProfileId") === "fresh-install" &&
        localStorage.getItem("codetutor:openai-key") === "sk-test-preserved",
      undefined,
      { timeout: 10_000 },
    );
  });

  test("Exit profile button restores real snapshot (and keeps dev mode on)", async ({ page }) => {
    // Arrange: seed a fake "real" state (simulating the user's pre-dev state),
    // enable dev mode (captures realSnapshot once), apply a frozen profile.
    // Then click Exit profile — real snapshot should come back, dev mode stays
    // on (Developer tab still visible).
    //
    // reloadSoon() is racy to stub via page.evaluate, so let both reloads
    // fire naturally. After Apply's reload, re-open Settings → Developer →
    // click Exit profile (button is only enabled when activeProfileId is set,
    // which survives the reload via the dev bootstrap).
    await page.addInitScript(() => {
      localStorage.setItem(
        "learner:v1:progress:python-fundamentals",
        JSON.stringify({
          status: "in_progress",
          completedLessonIds: ["hello-world"],
          lastLessonId: "hello-world",
        }),
      );
    });
    await page.goto("/learn");
    await toggleDevMode(page);
    await openSettings(page);
    await page.getByRole("tab", { name: /^developer$/i }).click();

    const profileSelect = page.getByRole("combobox").first();
    await profileSelect.selectOption("all-complete");
    await page.getByRole("button", { name: /^apply$/i }).click();

    // Wait for Apply's reload to settle and the all-complete seed to land.
    await page.waitForFunction(
      () => {
        const ap = localStorage.getItem("__dev__:activeProfileId");
        const de = localStorage.getItem("__dev__:enabled");
        return ap === "all-complete" && de === "1";
      },
      undefined,
      { timeout: 15_000 },
    );
    // Sanity — dev bootstrap re-applied, URL settled.
    await page.waitForLoadState("domcontentloaded");

    // Re-open Settings → Developer → click Exit profile.
    await openSettings(page);
    await page.getByRole("tab", { name: /^developer$/i }).click();
    await page.getByRole("button", { name: /^exit profile$/i }).click();

    // Real snapshot restored AND dev mode stays on after Exit's reload.
    await page.waitForFunction(
      () => {
        const activeId = localStorage.getItem("__dev__:activeProfileId");
        const devEnabled = localStorage.getItem("__dev__:enabled");
        const raw = localStorage.getItem("learner:v1:progress:python-fundamentals");
        if (activeId !== null) return false;
        if (devEnabled !== "1") return false;
        if (!raw) return false;
        try {
          const p = JSON.parse(raw) as { completedLessonIds: string[] };
          return p.completedLessonIds?.length === 1 && p.completedLessonIds[0] === "hello-world";
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 15_000 },
    );
  });

  test("Content health dev dashboard loads at /dev/content and lists python-fundamentals", async ({ page }) => {
    // The dashboard is dev-only (guarded by import.meta.env.DEV). It doesn't
    // require dev mode to be toggled — the route is always available when the
    // frontend is running in dev. Docker compose's frontend uses `npm run dev`
    // so the page resolves here. Prod builds tree-shake this route entirely.
    await page.goto("/dev/content");

    // Main heading.
    await expect(
      page.getByRole("heading", { name: /content health/i, level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    // The course section title pulls course.json's `title` — python-fundamentals
    // ships as "Python fundamentals".
    await expect(page.getByRole("heading", { name: /python fundamentals/i })).toBeVisible({
      timeout: 10_000,
    });
    // The internal JS smoke course ALSO appears on this page (unfiltered list).
    await expect(page.getByRole("heading", { name: /javascript smoke test/i })).toBeVisible({
      timeout: 10_000,
    });
    // Lesson rows render inside a <table>.
    await expect(page.locator("table").first()).toBeVisible();
  });

  test("Dashboard shows 12/12 after applying all-complete", async ({ page }) => {
    await page.goto("/learn");
    await toggleDevMode(page);
    await openSettings(page);
    await page.getByRole("tab", { name: /^developer$/i }).click();

    const profileSelect = page.getByRole("combobox").first();
    await profileSelect.selectOption("all-complete");

    // Don't stub reload — we want the page to reload so the dashboard
    // re-renders with the new state. The beforeEach init-script will fire
    // again on reload and wipe __dev__:* — but it does NOT wipe learner:v1:*
    // (per the updated loadProfile semantics), so the applied state survives.
    await page.getByRole("button", { name: /^apply$/i }).click();
    await page.waitForLoadState("networkidle");

    // When all lessons are complete the dashboard copy flips to "You
    // completed all 12 lessons!" instead of "N of 12".
    await expect(page.getByText(/completed all 12 lessons/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
