// Centralized Playwright locator factories. Keeping them here means a DOM
// rename only touches one file, and specs read like feature descriptions
// rather than CSS-selector puzzles.
//
// Strategy: prefer role+name → aria-label → text content → structural class.
// No `data-testid` attributes exist in the app (an explicit product choice —
// every selector below is semantics the user or a11y tooling would also rely
// on). If a surface has no stable hook, extend this file, not the specs.

import type { Locator, Page } from "@playwright/test";

// ─── Global chrome ────────────────────────────────────────────────────────

// Exact-match on the gear-icon's aria-label ("Open settings" — lowercase s).
// Case-insensitive regex would also match the tutor setup warning's
// "Open Settings →" link, which is a sibling button that DOESN'T open the
// modal directly (it goes through the parent's onOpenSettings prop chain).
export const settingsButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Open settings", exact: true });

export const modal = (page: Page): Locator =>
  page.locator('[role="dialog"], [role="alertdialog"]').last();

// Confirm modals pair a destructive-ish primary with a cancel. Pass the name
// of the primary action as it appears on the button.
export const modalPrimary = (page: Page, name: string | RegExp): Locator =>
  modal(page).getByRole("button", { name });

export const modalCancel = (page: Page): Locator =>
  modal(page).getByRole("button", { name: /cancel/i });

// ─── Editor / toolbar ─────────────────────────────────────────────────────

export const runButton = (page: Page): Locator =>
  // Visible label is "▶ Run". Accessible name on the <button> includes that
  // glyph + text so match on the "Run" substring rather than anchoring.
  page.getByRole("button", { name: /run/i }).filter({ hasText: /run/i }).first();

export const languagePicker = (page: Page): Locator =>
  page.getByRole("combobox", { name: /language/i });

export const outputPanel = (page: Page): Locator =>
  page.locator("#output-panel-body");

export const stdinTab = (page: Page): Locator =>
  page.getByRole("tab", { name: /^stdin/i });

// "Combined" is the default view that shows both stderr + stdout. Named
// `outputTab` in call sites because "combined" is an implementation detail.
export const outputTab = (page: Page): Locator =>
  page.getByRole("tab", { name: /^combined/i });

// Monaco: the visible editor container + the hidden textarea that receives key events.
export const monacoEditor = (page: Page): Locator =>
  page.locator(".monaco-editor").first();

// ─── Tutor panel ──────────────────────────────────────────────────────────

export const tutorInput = (page: Page): Locator =>
  page.getByRole("textbox", { name: /ask|question|tutor/i }).first();

export const tutorSubmit = (page: Page): Locator =>
  // The submit is a `button[type="submit"]` inside the composer form.
  page.locator("form").filter({ has: page.getByRole("textbox") }).getByRole("button").last();

export const hintButton = (page: Page): Locator =>
  page.getByRole("button", { name: /level \d of 3/i });

export const tutorSetupWarning = (page: Page): Locator =>
  page.getByText(/set up your openai key|open settings/i).first();

// ─── Learning surfaces ────────────────────────────────────────────────────

export const checkMyWorkButton = (page: Page): Locator =>
  page.getByRole("button", { name: /check my work/i });

// Lesson page has its own Run button (distinct aria-label "Run code"). The
// editor-page `runButton` selector would accidentally match here too via the
// "▶ Run" glyph, so specs exercising guided lessons should prefer this one.
export const lessonRunButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^run code/i });

export const overflowMenuButton = (page: Page): Locator =>
  page.getByRole("button", { name: /more lesson actions/i });

export const resetCodeMenuItem = (page: Page): Locator =>
  page.getByRole("menuitem", { name: /^reset code$/i });

export const resetLessonMenuItem = (page: Page): Locator =>
  page.getByRole("menuitem", { name: /^reset lesson$/i });

export const nextLessonLessonPageButton = (page: Page): Locator =>
  page.getByRole("button", { name: /go to next lesson/i });

export const instructionsTab = (page: Page): Locator =>
  page.getByRole("tab", { name: /^instructions/i });

export const examplesTab = (page: Page): Locator =>
  page.getByRole("tab", { name: /^examples/i });

export const failedTestCallout = (page: Page): Locator =>
  page.locator('[role="status"]').filter({ hasText: /failed|not quite|try again/i }).first();

export const lessonCompletePanel = (page: Page): Locator =>
  page.getByRole("alertdialog").filter({ hasText: /complete|nice work|great job|🎉/i });

export const nextLessonButton = (page: Page): Locator =>
  page.getByRole("button", { name: /next lesson/i });

// ─── Navigation + route cards ─────────────────────────────────────────────

export const startPageEditorCard = (page: Page): Locator =>
  page.locator("button,a").filter({ hasText: /open editor/i }).first();

export const startPageLearningCard = (page: Page): Locator =>
  page.locator("button,a").filter({ hasText: /guided course|start learning/i }).first();

export const dashboardContinueButton = (page: Page): Locator =>
  page.getByRole("button", { name: /continue|^start$|resume/i }).first();

// ─── Coach / onboarding surfaces ──────────────────────────────────────────

export const welcomeOverlayDismiss = (page: Page): Locator =>
  page.getByRole("button", { name: /skip onboarding|get started|dismiss/i }).first();

export const coachRailNudge = (page: Page): Locator =>
  page.locator('[aria-label="Coach nudge"], [data-coach-rail-nudge]').first();

// ─── Developer switcher ───────────────────────────────────────────────────

export const developerTab = (page: Page): Locator =>
  page.getByRole("tab", { name: /developer/i });

export const profileSelect = (page: Page): Locator =>
  page.getByRole("combobox", { name: /profile|seed/i }).first();

// ─── Export / Import progress ─────────────────────────────────────────────

export const exportProgressButton = (page: Page): Locator =>
  page.getByRole("button", { name: /export progress/i });

export const importProgressButton = (page: Page): Locator =>
  page.getByRole("button", { name: /import progress/i });
