// Per-language starter-project runs in editor mode. Guards against the
// class of regression where a runtime change only breaks SOME languages —
// specifically the compiled ones. The `/tmp/out: Permission denied` bug
// (2026-04-21) was the motivating incident: interpreted languages (Python,
// JS, TS, Ruby) kept working, so the existing editor.spec.ts passed. But
// C/C++/Go/Rust/Java all compile to /tmp/out, and the runner's tmpfs was
// mounted with the Docker default `noexec` — so every compiled-language
// run failed silently to e2e. This spec closes that gap by exercising
// every supported language's starter through the real backend.
//
// Each starter ships a pre-filled stdin (see frontend/src/util/starters.ts);
// switching language in the Toolbar resets stdin to the new language's
// starter stdin, so Run produces deterministic output. The assertion is a
// per-language substring chosen to be:
//   - unique to that starter's output (no cross-language false positives)
//   - stable against formatting tweaks (match numbers, not whitespace)
//   - short enough to survive copy edits to prompts/prose

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";

type Language =
  | "python"
  | "javascript"
  | "typescript"
  | "c"
  | "cpp"
  | "java"
  | "go"
  | "rust"
  | "ruby";

interface Case {
  lang: Language;
  compiled: boolean;
  // A substring that MUST appear in stdout when the starter runs against
  // its default stdin. Pinned in frontend/src/util/starters.ts — if you
  // change a starter's output shape, update the anchor here too.
  stdout: RegExp;
}

const CASES: Case[] = [
  { lang: "python", compiled: false, stdout: /mean\s+:/ },
  { lang: "javascript", compiled: false, stdout: /top 5 words/i },
  { lang: "typescript", compiled: false, stdout: /rows\s+:\s*5/ },
  { lang: "ruby", compiled: false, stdout: /total:\s*\d/ },
  // Compiled languages — the group the /tmp/out regression silently broke.
  { lang: "c", compiled: true, stdout: /10!\s*=\s*3628800/ },
  { lang: "cpp", compiled: true, stdout: /racecar/ },
  { lang: "go", compiled: true, stdout: /sum\s+:\s*39/ },
  { lang: "rust", compiled: true, stdout: /total area/ },
  { lang: "java", compiled: true, stdout: /transpose:/i },
];

test.describe("editor: per-language starter run", () => {
  // Rust's cold compile is the tall pole (~15–25s); cold session + container
  // start adds another 10–15s. 90s leaves room without masking a real hang.
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  for (const { lang, compiled, stdout } of CASES) {
    test(`${lang} starter runs and produces expected stdout (${
      compiled ? "compiled" : "interpreted"
    })`, async ({ page }) => {
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

      if (lang !== "python") {
        // Switch language via the picker — confirm modal resets BOTH the
        // project files AND stdin to the new language's starter.
        await S.languagePicker(page).selectOption(lang);
        await expect(page.locator('[role="alertdialog"]')).toBeVisible();
        await page.getByRole("button", { name: /^switch$/i }).click();
        await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
        await waitForMonacoReady(page);
      }
      // Python is the /editor default — no switch needed. EditorPage
      // seeds starterStdin(language) on first mount so the Python
      // starter's default input ("12 4 7 9 …") is already present.

      await expect(S.languagePicker(page)).toHaveValue(lang);
      await S.runButton(page).click();
      // Longer timeout than the generic expectStdoutContains helper
      // because Rust compile in particular can push past 20s on a cold
      // runner container.
      await expect(S.outputPanel(page)).toContainText(stdout, { timeout: 45_000 });
    });
  }
});
