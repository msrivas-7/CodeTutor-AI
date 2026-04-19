// Profile loading helpers for Playwright tests. Hydrates localStorage with a
// pre-serialized __dev__ profile seed so tests can land deterministically on
// a specific learner state (fresh install, mid-course, capstone first fail,
// etc.) without driving the UI through N lessons.

import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

export type ProfileId =
  | "empty"
  | "fresh-install"
  | "welcomed-not-started"
  | "first-lesson-editing"
  | "mid-course-healthy"
  | "stuck-on-lesson"
  | "needs-help-dashboard"
  | "capstones-pending"
  | "capstone-first-fail"
  | "all-complete"
  | "sandbox";

const SEED_DIR = path.resolve(__dirname, "seeds");

function readSeed(id: ProfileId): Record<string, string> {
  const p = path.join(SEED_DIR, `${id}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing seed ${p}. Run \`cd e2e && npm run dump-seeds\` to regenerate.`,
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Applied via addInitScript so it runs in the page's JS context BEFORE any
// SPA script (including bootstrap.ts that hydrates Zustand). This is the
// same ordering guarantee the dev bootstrap relies on.
export async function loadProfile(page: Page, id: ProfileId): Promise<void> {
  const seed = readSeed(id);
  await page.addInitScript((s) => {
    // Wipe learner state so stale progress can't bleed through. Onboarding
    // flags are intentionally preserved — they're controlled independently
    // via markOnboardingDone() and overridden by seeds that set them.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("learner:v1:")) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v as string);
  }, seed);
}

// Mark all onboarding flags as done so EditorCoach / WorkspaceCoach /
// WelcomeOverlay don't render. Use this for specs that aren't specifically
// exercising onboarding surfaces — the spotlight's full-viewport backdrop
// intercepts pointer events and breaks unrelated clicks.
export async function markOnboardingDone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("onboarding:v1:welcome-done", "1");
    localStorage.setItem("onboarding:v1:workspace-done", "1");
    localStorage.setItem("onboarding:v1:editor-done", "1");
  });
}

// Seed an OpenAI key + remember flag + selected model so the tutor panel is
// exercisable without the setup warning. Writes the same plain localStorage
// keys that aiStore reads on hydration (codetutor:openai-*). Pair with
// mockAI() from aiMocks.ts so the fake key is never actually sent upstream.
export async function seedApiKey(
  page: Page,
  opts: { key?: string; model?: string; persona?: "beginner" | "intermediate" | "advanced" } = {},
): Promise<void> {
  const { key = "sk-test-e2e", model = "gpt-4o-mini", persona = "intermediate" } = opts;
  await page.addInitScript(
    ({ k, m, p }) => {
      localStorage.setItem("codetutor:openai-remember", "1");
      localStorage.setItem("codetutor:openai-key", k);
      localStorage.setItem("codetutor:openai-model", m);
      localStorage.setItem("codetutor:openai-persona", p);
    },
    { k: key, m: model, p: persona },
  );
}

// Wipe all app-owned localStorage keys. Useful between tests that share a
// storage context (rare — prefer fresh context per test).
export async function clearAppStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const owned = (k: string) =>
      k.startsWith("learner:v1:") ||
      k.startsWith("onboarding:v1:") ||
      k.startsWith("codetutor:");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && owned(k)) localStorage.removeItem(k);
    }
  });
}
