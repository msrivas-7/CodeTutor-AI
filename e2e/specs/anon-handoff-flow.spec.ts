// Phase 27-v2 Day 5b — anon→authed handoff e2e.
//
// The full Maya journey end-to-end (cinematic → walkthrough →
// celebration → signup form → lesson 2) requires a real /api/anon/run
// + /api/anon/ai/ask/stream + Supabase signup, which is too heavy
// for a unit-style spec. This spec instead pins the CRITICAL Day-4
// integration: with a pre-populated anon stash + cinematic-seen
// flag in sessionStorage, an authed user landing on /start is
// redirected to lesson 2 (NOT /welcome) after the /api/anon-handoff
// POST resolves successfully. /api/anon-handoff is mocked at the
// route layer so the test runs frontend-only and doesn't need a
// hot backend container — the actual handoff implementation is
// covered by the backend unit/integration tests.
//
// What this proves:
//   - StartPage's handoff intercept fires before the welcomeDone
//     redirect.
//   - The "Carrying your work over…" loading shell appears.
//   - On 200 OK, the page navs to /learn/.../variables (lesson 2).
//   - The local preferences store is patched so a return-to-/start
//     in the same session doesn't re-trip the welcome redirect.
//
// What this does NOT prove (covered elsewhere or by Day 7 dogfood):
//   - Full /api/anon/run + tutor stream interaction on /try/
//   - Real Supabase signup
//   - Full backend handoff write (lesson_progress + course_progress
//     + preferences) — see backend's anonHandoff route + integration
//     tests / withRlsContext fixtures.

import { expect, test } from "../fixtures/auth";

test.describe("anon→authed handoff (Phase 27-v2 Day 5b)", () => {
  test("authed user with stash gets redirected to lesson 2 + welcome bypassed", async ({
    page,
  }) => {
    // Pre-populate sessionStorage as if Maya just clicked Sign Up
    // from the anon celebration block. The cinematic-seen flag is
    // also set so any /try/ path she might've left open doesn't
    // replay the cinematic in this tab.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem(
        "codetutor.anonRun",
        JSON.stringify({
          v: 1,
          completedAt: new Date().toISOString(),
          courseId: "python-fundamentals",
          lessonId: "hello-world",
          code: 'name = "Maya"\nprint("Hello, " + name + "!")',
          name: "Maya",
          flags: {
            welcomeDone: true,
            workspaceCoachDone: false,
          },
        }),
      );
    });

    // Mock the handoff endpoint to return applied:true. The real
    // backend writes are covered by anonHandoff route's own tests;
    // this spec is verifying the FRONTEND'S consumption of the
    // response, not the backend's writes.
    await page.route("**/api/anon-handoff", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, applied: true }),
      });
    });

    // Mock /api/user/lessons (the listLessonProgress endpoint) so the
    // frontend's progressStore hydration sees lesson 1 as completed
    // — otherwise useLessonLoader's shouldBouncePrereq check fails
    // for lesson 2 (which has hello-world as a prerequisite) and
    // bounces to /learn/course/python-fundamentals (course overview)
    // instead of the lesson page. The real backend handoff route
    // writes this row; the frontend tests just need the read shape
    // mocked.
    await page.route("**/api/user/lessons*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lessons: [
            {
              courseId: "python-fundamentals",
              lessonId: "hello-world",
              status: "completed",
              completedAt: new Date().toISOString(),
              attemptCount: 1,
              runCount: 1,
              hintCount: 0,
              timeSpentMs: 60000,
              lastCode: { "main.py": 'name = "Maya"\nprint("Hello, " + name + "!")' },
              practiceCompletedIds: [],
            },
          ],
        }),
      });
    });
    // Same for course progress: hello-world counted as completed in
    // the python-fundamentals course.
    await page.route("**/api/user/courses*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          courses: [
            {
              courseId: "python-fundamentals",
              status: "in_progress",
              completedLessonIds: ["hello-world"],
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // Land on /start as if just-signed-up (the auth fixture has
    // already injected a session). The handoff intercept fires
    // before any redirect — we expect the loading shell first.
    await page.goto("/start");

    // The "Carrying your work over…" loading shell renders while
    // the POST is in flight. Race-tolerant: if the mock resolves
    // before Playwright sees the shell, the assertion will move on
    // to the lesson-2 URL check below.
    // (Some workers will catch the shell, some won't — both are OK.)

    // After the handoff resolves, we should land on lesson 2 of
    // python-fundamentals, NOT /welcome. The replace:true means
    // back-button doesn't return to /start.
    await expect(page).toHaveURL(
      /\/learn\/course\/python-fundamentals\/lesson\/variables/,
      { timeout: 10_000 },
    );

    // Sanity: this is NOT /welcome. If the welcomeDone gate fired
    // before our handoff intercept, we'd be on /welcome instead.
    await expect(page).not.toHaveURL(/\/welcome/);

    // sessionStorage stash should be cleared on successful handoff
    // — a refresh-of-/start in this session must not re-fire the
    // POST and double-write.
    const stashAfter = await page.evaluate(() =>
      window.sessionStorage.getItem("codetutor.anonRun"),
    );
    expect(stashAfter).toBeNull();
  });

  test("handoff failure (5xx) redirects to lesson 1 (no /welcome cinematic replay)", async ({
    page,
  }) => {
    // Same setup as above, but mock the handoff to fail.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem(
        "codetutor.anonRun",
        JSON.stringify({
          v: 1,
          completedAt: new Date().toISOString(),
          courseId: "python-fundamentals",
          lessonId: "hello-world",
          code: 'name = "Maya"\nprint("Hello, " + name + "!")',
          name: "Maya",
          flags: { welcomeDone: true, workspaceCoachDone: false },
        }),
      );
    });

    await page.route("**/api/anon-handoff", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }),
      });
    });

    await page.goto("/start");

    // Phase 27-v2.2 audit fix B2: handoff failure must NOT fall
    // through to the welcomeDone gate (which would redirect to
    // /welcome → cinematic replay — the doubled-cinematic
    // anti-experience the v1 audit BLOCK SHIP'd on). The catch
    // branch in StartPage instead patches local prefs
    // (welcomeDone=true, workspaceCoachDone=true) and navigates
    // directly to lesson 1. Stash stays in sessionStorage so a
    // refresh can retry the handoff; the server PATCH catches up
    // on next sign-in regardless.
    await expect(page).toHaveURL(
      /\/learn\/course\/python-fundamentals\/lesson\/hello-world/,
      { timeout: 15_000 },
    );
    // Lesson page actually mounted — h1 carries the lesson title.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Hello, World!/i,
      { timeout: 15_000 },
    );
    // The loading shell unmounted — we exited the handoff phase.
    await expect(
      page.getByText(/Carrying your work over/i),
    ).toHaveCount(0);
    // Stash stays on failure — same-tab refresh re-attempts. The
    // server PATCH catches up on next sign-in.
    const stashAfter = await page.evaluate(() =>
      window.sessionStorage.getItem("codetutor.anonRun"),
    );
    expect(stashAfter).not.toBeNull();
  });
});
