// Editor-mode end-to-end specs. Exercises the non-lesson workspace at /editor:
// run code, edit + re-run, stdin piping, language-switch confirm modal, output
// tabs, session resilience. All network access hits the real Docker backend —
// only AI is mocked (tutor panel renders on this page but we don't drive it).

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { getMonacoValue, setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone, seedCompletedLessons } from "../fixtures/profiles";
import { criticalTest } from "../fixtures/testMetadata";
import * as S from "../utils/selectors";
import { expectDurationBadgeVisible, expectStdoutContains } from "../utils/assertions";

test.describe("editor", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await loadProfile(page, "empty");
    // Skip the EditorCoach spotlight tour — its fixed-inset backdrop would
    // otherwise intercept every click in these specs. A dedicated onboarding
    // spec exercises the tour separately.
    await markOnboardingDone(page);
  });

  test("cold load renders Python starter", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    const value = await getMonacoValue(page);
    expect(value.length, "starter should be non-empty").toBeGreaterThan(0);
    // Default starter is Python — should mention print or comment.
    expect(value).toMatch(/print|#/);
  });

  test("phone workspace keeps the editor usable and opens one reachable side panel at a time", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.removeItem("ui:filesCollapsed");
      window.localStorage.removeItem("ui:tutorCollapsed");
      window.localStorage.removeItem("ui:narrow-viewport-dismissed:phone");
      window.localStorage.removeItem("ui:narrow-viewport-dismissed:tablet");
    });
    // The walk-through control is an entitled tutor action. Establish that
    // product state explicitly so this responsive contract is identical when
    // CI boots the shared stack with the free tier disabled.
    await page.route("**/api/user/ai-status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          source: "platform",
          remainingToday: 30,
          capToday: 30,
          resetAtUtc: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          hasShownPaidInterest: false,
        }),
      }),
    );
    // The responsive streak assertion must not depend on an earlier test in
    // the same worker having completed a lesson. Give this journey its own
    // current streak so both the hidden and visible states are deterministic.
    await seedCompletedLessons(page, "python-fundamentals", ["hello-world"]);
    await page.goto("/editor");
    await waitForMonacoReady(page);

    const showFiles = page.getByRole("button", {
      name: "Show files panel",
      exact: true,
    });
    const showTutor = page.getByRole("button", {
      name: "Show tutor panel",
      exact: true,
    });
    await expect(showFiles).toBeVisible();
    await expect(showTutor).toBeVisible();

    const dismissViewportNotice = page.getByRole("button", {
      name: "Dismiss",
      exact: true,
    });
    await expect(dismissViewportNotice).toBeVisible();
    const noticeBox = await dismissViewportNotice.boundingBox();
    expect(noticeBox?.height ?? 0, "viewport notice dismiss target height").toBeGreaterThanOrEqual(44);
    expect(noticeBox?.width ?? 0, "viewport notice dismiss target width").toBeGreaterThanOrEqual(44);
    const headerBox = await page.locator("header").boundingBox();
    const noticePanelBox = await dismissViewportNotice.locator("xpath=../..").boundingBox();
    expect(noticePanelBox?.y ?? 0, "viewport notice stays clear of the header").toBeGreaterThan(
      (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
    );
    await dismissViewportNotice.click();
    await expect(showFiles).toBeFocused();

    const editor = page.locator("#main-content > section");
    await expect
      .poll(async () => (await editor.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(260);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      "phone editor horizontal overflow",
    ).toBeLessThanOrEqual(1);

    for (const [name, control] of [
      ["home", page.getByRole("button", { name: "Back to home", exact: true })],
      ["learning", page.getByRole("button", { name: "Learning", exact: true })],
      ["language", page.getByRole("combobox", { name: "Language", exact: true })],
      ["run", S.runButton(page)],
      ["user menu", page.locator("#user-menu-trigger")],
      ["files restore", showFiles],
      ["tutor restore", showTutor],
      ["editor file", page.getByRole("button", { name: "Active file main.py", exact: true })],
      ["close file", page.getByRole("button", { name: "Close main.py", exact: true })],
      ["walk through", page.getByRole("button", { name: /walk me through main\.py/i })],
    ] as const) {
      await expect(control, `${name} is visible`).toBeVisible();
      const box = await control.boundingBox();
      expect(box?.height ?? 0, `${name} touch target height`).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, `${name} touch target width`).toBeGreaterThanOrEqual(44);
    }

    await showTutor.click();
    const collapseTutor = page.getByRole("button", {
      name: "Collapse tutor",
      exact: true,
    });
    await expect(collapseTutor).toBeVisible();
    await expect(collapseTutor).toBeFocused();
    await expect(showFiles).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Collapse files",
      exact: true,
    })).toHaveCount(0);
    const tutorCloseBox = await collapseTutor.boundingBox();
    expect((tutorCloseBox?.x ?? 361) + (tutorCloseBox?.width ?? 0)).toBeLessThanOrEqual(360);
    const askBox = await page.getByRole("button", { name: "Ask", exact: true }).boundingBox();
    expect(askBox?.height ?? 0, "Ask touch target height").toBeGreaterThanOrEqual(44);

    await showFiles.click();
    const collapseFiles = page.getByRole("button", {
      name: "Collapse files",
      exact: true,
    });
    await expect(collapseFiles).toBeVisible();
    await expect(collapseFiles).toBeFocused();
    await expect(showTutor).toBeVisible();
    await expect(collapseTutor).toHaveCount(0);
    for (const control of [
      page.getByRole("button", { name: "New file", exact: true }),
      page.getByRole("button", { name: /show keyboard shortcuts/i }),
      page.getByRole("button", { name: "main.py", exact: true }),
      collapseFiles,
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    await collapseFiles.click();
    await expect(showFiles).toBeFocused();
    await expect
      .poll(async () => (await editor.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(260);

    await page.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(async () => (await page.locator("header").boundingBox())?.height ?? 999)
      .toBeLessThanOrEqual(64);
    await expect(page.getByRole("button", { name: /streak/i })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      "landscape editor horizontal overflow",
    ).toBeLessThanOrEqual(1);

    // The streak surface is portaled to document.body for the morph. It must
    // still obey the header anchor's responsive visibility in both directions.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("button", { name: /streak/i })).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole("button", { name: /streak/i })).toHaveCount(0);
  });

  test("empty-file rename succeeds, preserves collisions, and restores keyboard focus", async ({
    page,
  }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);

    const showFiles = page.getByRole("button", {
      name: "Show files panel",
      exact: true,
    });
    if (await showFiles.isVisible()) await showFiles.click();

    const newFile = page.getByRole("button", { name: "New file", exact: true });
    await newFile.click();
    const createName = page.getByRole("textbox", { name: "file.py", exact: true });
    await createName.fill("empty.py");
    await createName.press("Enter");

    await page.getByRole("button", { name: "empty.py", exact: true }).dblclick();
    const rename = page.getByRole("textbox", {
      name: "Enter to save, Esc or click away to cancel",
      exact: true,
    });
    await rename.fill("renamed-empty.py");
    await rename.press("Enter");
    const renamed = page.getByRole("button", {
      name: "renamed-empty.py",
      exact: true,
    });
    await expect(renamed).toBeVisible();
    await expect(renamed).toBeFocused();

    await newFile.click();
    await createName.fill("collision-source.py");
    await createName.press("Enter");
    const collisionSource = page.getByRole("button", {
      name: "collision-source.py",
      exact: true,
    });
    await collisionSource.dblclick();
    await rename.fill("renamed-empty.py");
    await rename.press("Enter");
    const destinationError = page.getByText("destination exists", { exact: true });
    await expect(destinationError).toBeVisible();

    await rename.press("Escape");
    await expect(collisionSource).toBeVisible();
    await expect(collisionSource).toBeFocused();
    await expect(renamed).toBeVisible();
    await expect(destinationError).toHaveCount(0);

    const renamedTab = page.locator('[data-editor-file][title="renamed-empty.py"]');
    const collisionTab = page.locator('[data-editor-file][title="collision-source.py"]');
    await renamedTab.focus();
    await renamedTab.press("ArrowRight");
    await expect(collisionTab).toBeFocused();
    await expect(collisionTab).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", {
      name: "Close collision-source.py",
      exact: true,
    }).click();
    await expect(renamedTab).toBeFocused();
  });

  test("an empty file can be deleted, persists, and restores file-tree focus", async ({
    page,
  }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);

    const newFile = page.getByRole("button", { name: "New file", exact: true });
    await newFile.click();
    const createName = page.getByRole("textbox", { name: "file.py", exact: true });
    await createName.fill("delete-empty.py");
    await createName.press("Enter");

    const emptyFile = page.getByRole("button", { name: "delete-empty.py", exact: true });
    await expect(emptyFile).toBeVisible();
    await emptyFile.focus();
    const deleteEmpty = page.getByRole("button", { name: "Delete delete-empty.py" });
    await deleteEmpty.click();

    const confirm = page.getByRole("alertdialog", { name: "Delete file?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteEmpty).toBeFocused();
    await deleteEmpty.click();
    await expect(confirm).toBeVisible();
    const saved = page.waitForResponse(
      (response) => {
        if (
          !response.url().includes("/api/user/editor-project") ||
          response.request().method() !== "PUT" ||
          !response.ok()
        ) {
          return false;
        }
        const payload = response.request().postDataJSON() as {
          files?: Record<string, string>;
        };
        return !Object.prototype.hasOwnProperty.call(
          payload.files ?? {},
          "delete-empty.py",
        );
      },
    );
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(emptyFile).toHaveCount(0);
    await expect(page.getByRole("button", { name: "main.py", exact: true })).toBeFocused();
    await saved;
    await page.reload();
    await waitForMonacoReady(page);
    await expect(page.getByRole("button", { name: "delete-empty.py", exact: true })).toHaveCount(0);
  });

  test("runner capacity recovery returns focus to Run", async ({ page }) => {
    await page.route("**/api/session", async (route) => {
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "0" },
        contentType: "text/plain",
        body: "runner capacity reached",
      });
    });
    await page.route("**/api/session/resume", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "focus-recovered-session" }),
      });
    });

    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(page.getByText("Runner capacity reached", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Use active runner" }).click();

    const run = S.runButton(page);
    await expect(page.getByText("Runner capacity reached", { exact: true })).toHaveCount(0);
    await expect(run).toBeEnabled();
    await expect(run).toBeFocused();
  });

  test("both cross-tab conflict choices return focus to the code editor", async ({
    page,
    context,
  }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);

    const peer = await context.newPage();
    await peer.goto("/editor");
    await waitForMonacoReady(peer);

    const saveFrom = (candidate: typeof page) =>
      candidate.waitForResponse(
        (response) =>
          response.url().includes("/api/user/editor-project") &&
          response.request().method() === "PUT" &&
          response.ok(),
        { timeout: 15_000 },
      );

    const firstRemoteSave = saveFrom(page);
    await setMonacoValue(page, "// newer saved version\n");
    await firstRemoteSave;

    await setMonacoValue(peer, "// stale local version\n");
    const useNewer = peer.getByRole("button", { name: "Use newer saved version" });
    await expect(useNewer).toBeVisible({ timeout: 15_000 });
    await useNewer.click();
    await expect
      .poll(() => getMonacoValue(peer))
      .toBe("// newer saved version\n");
    await expect(peer.getByRole("textbox", { name: /code editor for main\.py/i })).toBeFocused();

    const secondRemoteSave = saveFrom(page);
    await setMonacoValue(page, "// second newer version\n");
    await secondRemoteSave;

    await setMonacoValue(peer, "// version I chose to keep\n");
    const keepLocal = peer.getByRole("button", { name: "Keep this version" });
    await expect(keepLocal).toBeVisible({ timeout: 15_000 });
    const keptSave = saveFrom(peer);
    await keepLocal.click();
    await keptSave;
    await expect
      .poll(() => getMonacoValue(peer))
      .toBe("// version I chose to keep\n");
    await expect(peer.getByRole("textbox", { name: /code editor for main\.py/i })).toBeFocused();

    // Reload both tabs and repeat the remote-choice path. Monaco remounts for
    // the accepted active file; a one-frame focus attempt can otherwise land
    // on the stale textarea just before it unmounts.
    await page.reload();
    await waitForMonacoReady(page);
    await peer.reload();
    await waitForMonacoReady(peer);

    const thirdRemoteSave = saveFrom(page);
    await setMonacoValue(page, "// newer version after reload\n");
    await thirdRemoteSave;

    await setMonacoValue(peer, "// stale version after reload\n");
    await expect(useNewer).toBeVisible({ timeout: 15_000 });
    await useNewer.click();
    await expect
      .poll(() => getMonacoValue(peer))
      .toBe("// newer version after reload\n");
    await expect(peer.getByRole("textbox", { name: /code editor for main\.py/i })).toBeFocused();

    await peer.close();
  });

  test("run default starter produces stdout + duration badge", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    // Wait for session to be active before clicking Run. Session creation is
    // async — the Run button is disabled until phase === "active".
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });
    await S.runButton(page).click();
    await expectDurationBadgeVisible(page);
  });

  test(
    "edit + re-run updates output",
    criticalTest({
      risk: "p1",
      owner: "editor",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, 'print("apple")\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "apple");

    await setMonacoValue(page, 'print(1 + 2)\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "3");
    },
  );

  test("stdin tab pipes input to the program", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    // Switch to stdin tab, type input, switch back, run a program that reads 2 lines.
    await S.stdinTab(page).click();
    const stdinBox = S.stdinInput(page);
    await stdinBox.click();
    await stdinBox.fill("hello\nworld");
    // Back to combined output so we can assert on stdout.
    await S.outputTab(page).click();

    await setMonacoValue(page, "a = input()\nb = input()\nprint(a + ' and ' + b)\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "hello and world");
  });

  test("Run from the stdin tab auto-switches to combined so output is visible", async ({ page }) => {
    // Regression: before this, pressing Run while the stdin tab was selected
    // left the learner staring at their input buffer with no indication the
    // program had produced output.
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await S.stdinTab(page).click();
    await expect(S.stdinTab(page)).toHaveAttribute("aria-selected", "true");

    await setMonacoValue(page, "print('switched')\n");
    await S.runButton(page).click();

    // As soon as a run starts, focus should land on the combined tab.
    await expect(S.outputTab(page)).toHaveAttribute("aria-selected", "true", {
      timeout: 5_000,
    });
    await expectStdoutContains(page, "switched");
  });

  test("non-ASCII stdin round-trips through runner (emoji + CJK + Cyrillic)", async ({
    page,
  }) => {
    // Audit gap #9 (hazy-wishing-wren bucket 10): the runner shells stdin
    // through docker-exec. If any layer (compose, runner image, node's
    // spawn stdin pipe, the readline that backs Python's input()) defaults
    // to a non-UTF-8 locale or byte-level truncation, emoji and multi-byte
    // codepoints will come out as mojibake or '?'. Regression here would be
    // silently shipping a runner that can't round-trip a learner's own name.
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await S.stdinTab(page).click();
    const stdinBox = S.stdinInput(page);
    await stdinBox.click();
    // Three codepoint families, one per line: compound emoji (ZWJ sequence),
    // CJK ideographs, Cyrillic. `input()` reads one line each.
    await stdinBox.fill("👨‍👩‍👧\n你好世界\nПривет");
    await S.outputTab(page).click();

    await setMonacoValue(
      page,
      "a = input()\nb = input()\nc = input()\nprint(f'[{a}][{b}][{c}]')\n",
    );
    await S.runButton(page).click();
    // Single assertion covers all three — if any one mojibakes, the
    // substring match fails.
    await expectStdoutContains(page, "[👨‍👩‍👧][你好世界][Привет]");
  });

  test("non-ASCII source literals and identifiers run under the Python runner", async ({
    page,
  }) => {
    // Python 3 allows non-ASCII identifiers. If the runner pipes source
    // via a byte-stream that assumes Latin-1 (or if the temp file write
    // happens without encoding='utf-8'), identifier declaration crashes
    // with SyntaxError before the first print. Guard both the string
    // literal path (output encoding) and the identifier path (source
    // encoding) in one run.
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(
      page,
      "# -*- coding: utf-8 -*-\nπ = 3.14159\nemoji = '🎉'\nprint(f'{emoji} π={π}')\n",
    );
    await S.runButton(page).click();
    await expectStdoutContains(page, "🎉 π=3.14159");
  });

  test("runaway print loop caps at 1 MB with a truncation marker, no browser freeze", async ({
    page,
  }) => {
    // Audit-v2 fix #7: a curious learner running `while True: print(...)`
    // used to flood ~100 MB of stdout into the backend Node heap and the
    // eventual JSON response, freezing the browser and blowing the docker
    // json-file log / Log Analytics cap. `localDocker.exec` now caps each
    // stream at 1 MB and appends a truncation marker. This test proves:
    //   1. The runner still exits (10s wall-clock kill via `timeout`),
    //   2. The response is bounded (≤ ~1.1 MB, not 100 MB),
    //   3. The learner sees the truncation marker so they know output was cut.
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    // Each line is ~101 bytes (100 x's + newline). A few thousand lines cross
    // the 1 MB cap well within the 10s wall-clock.
    await setMonacoValue(
      page,
      "line='x'*100\nwhile True:\n    print(line)\n",
    );
    await S.runButton(page).click();

    // Truncation marker renders verbatim in the output panel.
    await expect(page.getByText(/\[output truncated at 1 MB\]/)).toBeVisible({
      timeout: 30_000,
    });

    // Output panel body stays bounded — we don't assert exact bytes because
    // the DOM wraps/styles the text, but it must NOT contain 10+ MB worth of
    // content. A simple ceiling: the inner text is less than 2 MB.
    const bodyText = await page.locator("#output-panel-body").innerText();
    expect(bodyText.length, "output truncated to near the 1 MB cap").toBeLessThan(
      2 * 1024 * 1024,
    );
  });

  test(
    "runaway program can be stopped and the next run still succeeds",
    criticalTest({
      risk: "p1",
      owner: "editor",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

      await setMonacoValue(page, "while True:\n    pass\n");
      await S.runButton(page).click();

      const stopButton = page.getByRole("button", { name: /stop/i });
      await expect(stopButton).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/running for \d+s/i)).toBeVisible({ timeout: 5_000 });
      await stopButton.click();

      await expect(page.getByText("Run stopped. Your code is unchanged.")).toBeVisible({
        timeout: 5_000,
      });
      await expect(S.runButton(page)).toBeEnabled();

      // A cancelled process must not poison the persistent runner session or
      // allow its late result to overwrite the learner's next execution.
      await setMonacoValue(page, "print('recovered after stop')\n");
      await S.runButton(page).click();
      await expectStdoutContains(page, "recovered after stop");
      await expect(page.getByText(/timed out|exit 137/i)).toHaveCount(0);
    },
  );

  test("language switch shows confirm modal + cancel preserves code", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('keep me')\n");
    const pyValue = await getMonacoValue(page);

    await S.languagePicker(page).selectOption("javascript");
    // Modal appears — "Switch to JavaScript?"
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Code preserved — still the Python snippet.
    const after = await getMonacoValue(page);
    expect(after).toBe(pyValue);
    // Language select snapped back to python (visible in the <select>).
    await expect(S.languagePicker(page)).toHaveValue("python");
  });

  test("language switch → confirm replaces code with new starter", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('throwaway')\n");

    await S.languagePicker(page).selectOption("javascript");
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.getByRole("button", { name: /^switch$/i }).click();
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Monaco should now hold the JS starter — no Python print left.
    await waitForMonacoReady(page);
    const after = await getMonacoValue(page);
    expect(after).not.toContain("throwaway");
    expect(after.length).toBeGreaterThan(0);
    await expect(S.languagePicker(page)).toHaveValue("javascript");
  });

  test("run twice in a row replaces output, not appends", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('first')\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "first");

    await setMonacoValue(page, "print('second')\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "second");

    // Output panel body should contain "second" but NOT "first" (replacement).
    const text = await page.locator("#output-panel-body").innerText();
    expect(text).toContain("second");
    expect(text).not.toContain("first");
  });

  test("output panel exit code + duration render in status row", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, 'print("hi")\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "hi");

    // Status row shows: "exit 0 · <n>ms · <stage>". Match the "exit 0" + "ms" parts.
    await expect(page.getByText(/exit\s*0/i).first()).toBeVisible();
    await expect(page.getByText(/\b\d+\s*ms\b/).first()).toBeVisible();
  });

  test("UserMenu → Settings opens the Settings modal (Tutor tab shows API key)", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);

    await S.openSettings(page, "tutor");
    // SettingsModal has no accessible name (no aria-labelledby) so use the
    // raw role attribute instead of getByRole, which needs an accessible name.
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.getByText(/api key/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
