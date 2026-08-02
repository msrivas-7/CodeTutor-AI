// QA-L4 + M-12 + QA-M2 coverage.
//
// Three user-visible surfaces landed in bucket 9 that unit tests alone can't
// prove end-to-end:
//
//   1. "?" opens a keyboard-cheatsheet dialog; Esc closes it. The dialog is
//      mounted at the App root (GlobalShortcuts), so it must work from any
//      page — including one with its own Esc handler. We assert that it
//      does not fire while a textarea is focused.
//   2. ⌘/Ctrl+K focuses the tutor composer from a surface outside Monaco.
//      Monaco has its own addCommand that handles the in-editor case; this
//      spec covers the "click somewhere in the tutor panel, press ⌘K"
//      fallback that M-12 added.
//   3. A lesson whose lesson.json parses but fails the Zod schema renders
//      distinct "malformed" copy, not the generic 404 branch. That's the
//      QA-M2 split; before this, an authoring typo silently looked like a
//      missing file.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { loadProfile, markOnboardingDone, seedApiKey } from "../fixtures/profiles";
import { waitForMonacoReady } from "../fixtures/monaco";

const COURSE_ID = "python-fundamentals";

test.describe("keyboard shortcuts + schema-error branch", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("pressing '?' opens the keyboard cheatsheet; Esc closes it", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");

    // `/start` loads the authenticated application as a lazy bundle. Wait for
    // the real page rather than firing the shortcut at the loading skeleton,
    // before GlobalShortcuts has mounted its window listener.
    await expect(page.getByRole("heading", { name: /continue learning/i })).toBeVisible();

    // Dialog is absent until the shortcut fires.
    await expect(page.getByRole("dialog", { name: /keyboard shortcuts/i })).toHaveCount(0);

    // Shift+/ emits "?" on every common layout. Using `Shift+Slash` rather
    // than `.type("?")` because the latter skips the keydown event path that
    // GlobalShortcuts listens on.
    await page.keyboard.press("Shift+Slash");

    const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();
    // Rows document ⌘/Ctrl+Enter, ⌘/Ctrl+K, Esc, and "?".
    await expect(dialog.getByText(/jump focus to the tutor composer/i)).toBeVisible();
    await expect(dialog.getByText(/cancel an in-flight tutor response/i)).toBeVisible();

    // Esc dismisses the dialog.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /keyboard shortcuts/i })).toHaveCount(0);
  });

  test("the visible Files help button opens the same shortcuts dialog", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/editor");
    await waitForMonacoReady(page);

    const help = page.getByRole("button", { name: "Show keyboard shortcuts" });
    await help.click();

    const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/jump focus to the tutor composer/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test("pressing '?' inside a textarea does NOT open the cheatsheet", async ({ page }) => {
    // isTypingTarget bails on INPUT/TEXTAREA/contenteditable/.monaco-editor —
    // the unit test pins the predicate, but this spec confirms the app-level
    // wiring. We need a focused, enabled textarea; the tutor composer on a
    // lesson page is the natural fit once a key is seeded.
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    const composer = page.getByRole("textbox", { name: /ask the tutor/i });
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.click();
    await composer.fill(""); // ensure focus without lingering text

    await page.keyboard.press("Shift+Slash");
    // Composer should now contain "?" and the cheatsheet must not be open.
    await expect(composer).toHaveValue("?");
    await expect(page.getByRole("dialog", { name: /keyboard shortcuts/i })).toHaveCount(0);
  });

  test("⌘/Ctrl+K from outside Monaco focuses the tutor composer", async ({ page, browserName }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    // The composer must be enabled for `toBeFocused` to succeed — seedApiKey
    // above takes care of that. Now explicitly blur Monaco so the handler we
    // exercise is the GlobalShortcuts window listener, NOT Monaco's own
    // addCommand. (Monaco also calls bumpFocusComposer; this spec only
    // passes when the non-Monaco path works, which is what M-12 added.)
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      active?.blur();
    });

    const composer = page.getByRole("textbox", { name: /ask the tutor/i });
    await expect(composer).toBeEnabled();
    await expect(composer).not.toBeFocused();

    const mod = browserName === "webkit" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+KeyK`);

    await expect(composer).toBeFocused({ timeout: 3_000 });
  });

  test("schema-error lesson renders malformed copy, not 'not found'", async ({ page }) => {
    // Intercept the lesson.json for hello-world and return a payload that
    // parses as JSON but fails the Zod schema (wrong `language`, missing
    // required `objectives`). useLessonLoader should surface this as
    // kind="schema_error" → LessonPage renders the author-oriented copy.
    await page.route(
      `**/courses/${COURSE_ID}/lessons/hello-world/lesson.json`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "hello-world",
            courseId: COURSE_ID,
            title: "Hello World",
            description: "stub",
            order: 1,
            language: "not-a-real-language", // rejects the enum
            estimatedMinutes: 5,
            // `objectives` is required and omitted — Zod will flag it.
            teachesConceptTags: [],
            usesConceptTags: [],
            completionRules: [{ type: "expected_stdout", expected: "hi" }],
            prerequisiteLessonIds: [],
          }),
        });
      },
    );

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);

    // Schema-error copy includes a <p> telling the author to run lint:content.
    await expect(
      page.getByText(/this lesson's content file is malformed/i),
    ).toBeVisible({ timeout: 10_000 });
    // Must NOT fall through to the generic not-found branch.
    await expect(page.getByText(/^lesson not found$/i)).toHaveCount(0);
  });
});
