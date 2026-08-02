// Phase 18b: profile seeding now writes to the backend (preferences + progress
// + editor-project tables), not localStorage. The seed JSON files still live
// in e2e/fixtures/seeds/ in their original shape (learner:v1:* + onboarding:v1:*
// keys); this module parses them and translates into PATCH calls against the
// logged-in test user so the server state hydrates on the next page.goto.
//
// Each Playwright worker has its own Supabase test user (see fixtures/auth.ts).
// Per-test reset is done by deleting course rows and resetting preferences back
// to defaults before seeding the new profile. The test user itself persists
// across tests within the worker — only its server-backed data is wiped.
//
// Onboarding flags live under `preferences.welcomeDone` / `workspaceCoachDone`
// / `editorCoachDone`. Persona / theme / openaiModel also live in preferences.
// Everything else (course progress, lesson progress) goes to the progress
// endpoints.

import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { request, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getWorkerUser } from "./auth";

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
export const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
// Phase 20-P1: backend csrfGuard requires Origin on every mutating call and
// allowlists it against CORS_ORIGIN. Setting it on the request context means
// every ctx.patch/put/post/delete inherits it automatically.
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";

export async function newBackendContext() {
  return request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
}

async function requireOk(response: APIResponse, operation: string): Promise<void> {
  if (response.ok()) return;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`${operation} failed (${response.status()}): ${detail}`);
}

function authenticatedHeaders(token: string): Record<string, string> {
  return {
    "X-Requested-With": "codetutor",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

const E2E_WRITER_ID = "00000000-0000-4000-8000-000000000001";

async function seedLessonState(
  ctx: APIRequestContext,
  token: string,
  courseId: string,
  lessonId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const { lastCode, ...progressBody } = body;
  const progress = await ctx.patch(
    `${BACKEND}/api/user/lessons/${courseId}/${lessonId}`,
    {
      headers: authenticatedHeaders(token),
      data: progressBody,
    },
  );
  await requireOk(progress, `seed lesson ${courseId}/${lessonId}`);

  if (lastCode === undefined || lastCode === null) return;
  if (typeof lastCode !== "object" || Array.isArray(lastCode)) {
    throw new Error(`Profile draft for ${courseId}/${lessonId} must be a file map`);
  }
  const saved = (await progress.json()) as { draftRevision?: number };
  const draft = await ctx.put(
    `${BACKEND}/api/user/lessons/${courseId}/${lessonId}/draft`,
    {
      headers: authenticatedHeaders(token),
      data: {
        code: lastCode,
        expectedRevision: saved.draftRevision ?? 0,
        writerId: E2E_WRITER_ID,
      },
    },
  );
  await requireOk(draft, `seed lesson draft ${courseId}/${lessonId}`);
}

function readSeed(id: ProfileId): Record<string, string> {
  const p = path.join(SEED_DIR, `${id}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing seed ${p}. Seeds are hand-authored JSON (legacy localStorage ` +
        `shape) committed under e2e/fixtures/seeds/ — add or restore the file there.`,
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readCourseLessonOrder(courseId: string): string[] {
  const manifestPath = path.resolve(
    __dirname,
    "../../frontend/public/courses",
    courseId,
    "course.json",
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Profile references missing course manifest ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    lessonOrder?: unknown;
  };
  if (
    !Array.isArray(manifest.lessonOrder) ||
    !manifest.lessonOrder.every((lessonId) => typeof lessonId === "string")
  ) {
    throw new Error(`Course manifest ${manifestPath} has an invalid lessonOrder`);
  }
  return manifest.lessonOrder;
}

// Turn the JSON seed (localStorage-shaped) into discrete backend writes.
interface TranslatedSeed {
  prefsPatch: Record<string, unknown>;
  coursePatches: Array<{ courseId: string; body: Record<string, unknown> }>;
  lessonPatches: Array<{
    courseId: string;
    lessonId: string;
    body: Record<string, unknown>;
  }>;
  coursesTouched: Set<string>;
}

function translateSeed(seed: Record<string, string>): TranslatedSeed {
  const prefsPatch: Record<string, unknown> = {};
  const coursePatches: TranslatedSeed["coursePatches"] = [];
  const lessonPatches: TranslatedSeed["lessonPatches"] = [];
  const coursesTouched = new Set<string>();

  for (const [key, rawVal] of Object.entries(seed)) {
    if (key === "onboarding:v1:welcome-done" && rawVal === "1") {
      prefsPatch.welcomeDone = true;
      continue;
    }
    if (key === "onboarding:v1:workspace-done" && rawVal === "1") {
      prefsPatch.workspaceCoachDone = true;
      continue;
    }
    if (key === "onboarding:v1:editor-done" && rawVal === "1") {
      prefsPatch.editorCoachDone = true;
      continue;
    }
    // learner:v1:progress:<courseId>
    const courseMatch = key.match(/^learner:v1:progress:([^:]+)$/);
    if (courseMatch) {
      const courseId = courseMatch[1];
      coursesTouched.add(courseId);
      const parsed = JSON.parse(rawVal);
      coursePatches.push({
        courseId,
        body: {
          status: parsed.status,
          startedAt: parsed.startedAt ?? null,
          completedAt: parsed.completedAt ?? null,
          lastLessonId: parsed.lastLessonId ?? null,
          completedLessonIds: parsed.completedLessonIds ?? [],
        },
      });
      continue;
    }
    // learner:v1:lesson:<courseId>:<lessonId>
    const lessonMatch = key.match(/^learner:v1:lesson:([^:]+):([^:]+)$/);
    if (lessonMatch) {
      const [, courseId, lessonId] = lessonMatch;
      coursesTouched.add(courseId);
      const parsed = JSON.parse(rawVal);
      const body: Record<string, unknown> = {
        status: parsed.status,
        startedAt: parsed.startedAt ?? null,
        completedAt: parsed.completedAt ?? null,
        attemptCount: parsed.attemptCount ?? 0,
        runCount: parsed.runCount ?? 0,
        hintCount: parsed.hintCount ?? 0,
      };
      if (typeof parsed.timeSpentMs === "number") body.timeSpentMs = parsed.timeSpentMs;
      if (parsed.lastCode !== undefined) body.lastCode = parsed.lastCode;
      if (parsed.lastOutput !== undefined) body.lastOutput = parsed.lastOutput;
      if (Array.isArray(parsed.practiceCompletedIds)) {
        body.practiceCompletedIds = parsed.practiceCompletedIds;
      }
      lessonPatches.push({ courseId, lessonId, body });
      continue;
    }
    // learner:v1:identity is frontend-only, ignored.
  }

  return { prefsPatch, coursePatches, lessonPatches, coursesTouched };
}

// Wipe every piece of server-backed state for the given user so the next
// profile seed lands on a clean slate. Deletes the courses we know about
// (discovered via GET /courses) plus resets preferences to defaults.
async function resetServerState(token: string): Promise<void> {
  const ctx = await newBackendContext();
  try {
    // Shares intentionally outlive lesson resets in the product. Test profiles
    // need a stronger boundary so attribution and snapshot state cannot leak
    // from one spec into the next worker-reused account.
    const shareList = await ctx.get(`${BACKEND}/api/shares/mine/all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await requireOk(shareList, "list shares before profile reset");
    const { shares } = (await shareList.json()) as {
      shares: Array<{ shareToken: string }>;
    };
    for (const share of shares) {
      const revoked = await ctx.delete(`${BACKEND}/api/shares/${share.shareToken}`, {
        headers: authenticatedHeaders(token),
      });
      await requireOk(revoked, `revoke share ${share.shareToken} during profile reset`);
    }

    // Discover courses the user currently has rows for.
    const res = await ctx.get(`${BACKEND}/api/user/courses`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await requireOk(res, "list course progress before profile reset");
    const body = (await res.json()) as {
      courses: Array<{ courseId: string }>;
    };
    for (const c of body.courses) {
      const deleted = await ctx.delete(`${BACKEND}/api/user/courses/${c.courseId}`, {
        headers: authenticatedHeaders(token),
      });
      await requireOk(deleted, `reset course ${c.courseId}`);
    }
    // Wipe any saved BYOK OpenAI key so state doesn't leak across tests.
    // Safe to call even when no key is stored — the DELETE is idempotent.
    const clearedKey = await ctx.delete(`${BACKEND}/api/user/openai-key`, {
      headers: authenticatedHeaders(token),
    });
    await requireOk(clearedKey, "clear profile OpenAI key");
    // Reset preferences back to defaults.
    const resetPreferences = await ctx.patch(`${BACKEND}/api/user/preferences`, {
      headers: authenticatedHeaders(token),
      data: {
        persona: "intermediate",
        openaiModel: null,
        theme: "dark",
        welcomeDone: false,
        workspaceCoachDone: false,
        editorCoachDone: false,
        uiLayout: {},
        lastWelcomeBackAt: null,
        emailOptIn: true,
        disableStreaks: false,
      },
    });
    await requireOk(resetPreferences, "reset profile preferences");
    // Editor project — overwrite with an empty/starter-like row. The app's
    // own starter templates fill in if server is empty, so we PUT a clean
    // default through the optimistic-concurrency contract.
    const currentProject = await ctx.get(`${BACKEND}/api/user/editor-project`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await requireOk(currentProject, "read editor project before profile reset");
    const { revision } = (await currentProject.json()) as { revision: number };
    const resetProject = await ctx.put(`${BACKEND}/api/user/editor-project`, {
      headers: authenticatedHeaders(token),
      data: {
        language: "python",
        files: {},
        activeFile: null,
        openTabs: [],
        fileOrder: [],
        stdin: "",
        expectedRevision: revision,
        writerId: E2E_WRITER_ID,
      },
    });
    await requireOk(resetProject, "reset editor project");
  } finally {
    await ctx.dispose();
  }
}

async function seedServerState(
  token: string,
  seed: TranslatedSeed,
): Promise<void> {
  const ctx = await newBackendContext();
  try {
    if (Object.keys(seed.prefsPatch).length > 0) {
      const preferences = await ctx.patch(`${BACKEND}/api/user/preferences`, {
        headers: authenticatedHeaders(token),
        data: seed.prefsPatch,
      });
      await requireOk(preferences, "seed profile preferences");
    }

    const lessonsByCourse = new Map<string, Map<string, Record<string, unknown>>>();
    for (const lesson of seed.lessonPatches) {
      const courseLessons = lessonsByCourse.get(lesson.courseId) ?? new Map();
      courseLessons.set(lesson.lessonId, lesson.body);
      lessonsByCourse.set(lesson.courseId, courseLessons);
    }

    for (const { courseId, body: courseBody } of seed.coursePatches) {
      const completedLessonIds = Array.isArray(courseBody.completedLessonIds)
        ? courseBody.completedLessonIds.filter(
            (lessonId): lessonId is string => typeof lessonId === "string",
          )
        : [];
      if (courseBody.status === "completed") {
        const authoredLessonOrder = readCourseLessonOrder(courseId);
        if (
          authoredLessonOrder.length !== completedLessonIds.length ||
          authoredLessonOrder.some(
            (lessonId, index) => completedLessonIds[index] !== lessonId,
          )
        ) {
          throw new Error(
            `Completed profile for ${courseId} must include the current authored lessonOrder exactly; ` +
              `expected ${authoredLessonOrder.join(", ")}, received ${completedLessonIds.join(", ")}`,
          );
        }
      }
      const courseLessons = lessonsByCourse.get(courseId) ?? new Map();
      const seededLessons = new Set<string>();

      // The server owns unlock state. Seed authored completion rows in
      // prerequisite order, then let one final course write derive the
      // canonical completedLessonIds from those trusted rows.
      for (const lessonId of completedLessonIds) {
        const authored = courseLessons.get(lessonId);
        if (authored?.status && authored.status !== "completed") {
          throw new Error(
            `Profile marks ${courseId}/${lessonId} completed at course level but lesson status is ${String(authored.status)}`,
          );
        }
        const now = new Date().toISOString();
        await seedLessonState(ctx, token, courseId, lessonId, {
          status: "completed",
          startedAt: now,
          completedAt: now,
          attemptCount: 1,
          ...authored,
        });
        seededLessons.add(lessonId);
      }

      for (const [lessonId, lessonBody] of courseLessons) {
        if (seededLessons.has(lessonId)) continue;
        await seedLessonState(ctx, token, courseId, lessonId, lessonBody);
      }

      const finalCourse = await ctx.patch(`${BACKEND}/api/user/courses/${courseId}`, {
        headers: authenticatedHeaders(token),
        data: courseBody,
      });
      await requireOk(finalCourse, `finalize seeded course ${courseId}`);
      lessonsByCourse.delete(courseId);
    }

    for (const [courseId, courseLessons] of lessonsByCourse) {
      for (const [lessonId, lessonBody] of courseLessons) {
        await seedLessonState(ctx, token, courseId, lessonId, lessonBody);
      }
    }
  } finally {
    await ctx.dispose();
  }
}

/**
 * Apply a named seed profile to the server for the current worker's test user.
 * Wipes previous server state first, then PATCHes the translated rows. Runs
 * BEFORE page.goto so the next SPA boot hydrates the seeded state.
 *
 * The Playwright `test.info()` call locates the current worker index; that
 * matches the user who was logged in by fixtures/auth.ts.
 *
 * `onboarded` (default true): after reset+seed, flip the three onboarding
 * flags to true unless the seed already sets them. Most specs don't want
 * onboarding spotlights blocking their clicks, so this is the default. Tests
 * that exercise the first-visit surfaces explicitly pass `{ onboarded: false }`.
 */
export async function loadProfile(
  page: Page,
  id: ProfileId,
  opts: { onboarded?: boolean } = {},
): Promise<void> {
  void page; // reserved for future per-page state (e.g. browser cookies)
  const onboarded = opts.onboarded ?? true;
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const token = user.session.access_token;

  const seed = readSeed(id);
  const translated = translateSeed(seed);

  await resetServerState(token);
  if (
    Object.keys(translated.prefsPatch).length > 0 ||
    translated.coursePatches.length > 0 ||
    translated.lessonPatches.length > 0
  ) {
    await seedServerState(token, translated);
  }
  if (onboarded) {
    const hasWelcome = translated.prefsPatch.welcomeDone === true;
    const hasWorkspace = translated.prefsPatch.workspaceCoachDone === true;
    const hasEditor = translated.prefsPatch.editorCoachDone === true;
    if (!hasWelcome || !hasWorkspace || !hasEditor) {
      const ctx = await newBackendContext();
      try {
        const onboarding = await ctx.patch(`${BACKEND}/api/user/preferences`, {
          headers: authenticatedHeaders(token),
          data: {
            welcomeDone: true,
            workspaceCoachDone: true,
            editorCoachDone: true,
          },
        });
        await requireOk(onboarding, "mark seeded profile onboarding complete");
      } finally {
        await ctx.dispose();
      }
    }
  }
}

/**
 * Mark all three onboarding flags done on the server so the welcome / editor
 * / workspace coach surfaces don't fire. Use this for specs that aren't
 * specifically testing onboarding — their click paths get blocked by the
 * spotlight backdrop otherwise.
 */
export async function markOnboardingDone(page: Page): Promise<void> {
  void page;
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const token = user.session.access_token;
  const ctx = await newBackendContext();
  try {
    const onboarding = await ctx.patch(`${BACKEND}/api/user/preferences`, {
      headers: authenticatedHeaders(token),
      data: {
        welcomeDone: true,
        workspaceCoachDone: true,
        editorCoachDone: true,
      },
    });
    await requireOk(onboarding, "mark onboarding complete");
  } finally {
    await ctx.dispose();
  }
}

// Phase 18e: the OpenAI key lives encrypted in user_preferences. The seeded
// value is an obviously-fake "sk-test-e2e" placeholder; specs that exercise
// the tutor either mock /api/ai/* via Playwright routes or run against a
// real key supplied out-of-band. Persona + model go to preferences in the
// same PATCH.
export async function seedApiKey(
  page: Page,
  opts: {
    key?: string;
    model?: string;
    persona?: "beginner" | "intermediate" | "advanced";
  } = {},
): Promise<void> {
  void page;
  // Server schema enforces min-20 chars / `[A-Za-z0-9_-]+`. The value never
  // leaves the seeded Supabase project; specs that would hit OpenAI for real
  // intercept /api/ai/* via Playwright routes.
  const {
    key = "sk-test-e2e-12345678901234",
    model = "gpt-4o-mini",
    persona = "intermediate",
  } = opts;

  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const token = user.session.access_token;
  const ctx = await newBackendContext();
  try {
    const preferences = await ctx.patch(`${BACKEND}/api/user/preferences`, {
      headers: authenticatedHeaders(token),
      data: { persona, openaiModel: model },
    });
    await requireOk(preferences, "seed tutor preferences");
    const openaiKey = await ctx.put(`${BACKEND}/api/user/openai-key`, {
      headers: authenticatedHeaders(token),
      data: { key },
    });
    await requireOk(openaiKey, "seed tutor key");
  } finally {
    await ctx.dispose();
  }
}

// Seed an authored prerequisite chain through the same trusted lesson rows
// the server uses for access decisions. Callers must provide the complete
// prerequisite prefix in course order; a sparse client-side unlock list is
// intentionally no longer accepted by the product.
export async function seedCompletedLessons(
  _page: Page,
  courseId: string,
  completedLessonIds: string[],
): Promise<void> {
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const token = user.session.access_token;
  const ctx = await newBackendContext();
  try {
    const startedAt = new Date().toISOString();
    for (const lessonId of completedLessonIds) {
      const completedAt = new Date().toISOString();
      await seedLessonState(ctx, token, courseId, lessonId, {
        status: "completed",
        startedAt,
        completedAt,
        attemptCount: 1,
      });
    }

    const course = await ctx.patch(`${BACKEND}/api/user/courses/${courseId}`, {
      headers: authenticatedHeaders(token),
      data: {
        status: "in_progress",
        startedAt,
        lastLessonId: completedLessonIds.at(-1) ?? null,
        completedLessonIds,
      },
    });
    await requireOk(course, `finalize completed lessons for ${courseId}`);
  } finally {
    await ctx.dispose();
  }
}

// Seed a single lesson's server row so the SPA's next hydrate finds saved
// lastCode / status / attemptCount. Callers pass the fields they care about;
// all others default to the backend's zero state.
export async function seedLessonProgress(
  _page: Page,
  courseId: string,
  lessonId: string,
  opts: {
    status?: "not_started" | "in_progress" | "completed";
    attemptCount?: number;
    lastCode?: Record<string, string> | null;
    lastOutput?: string | null;
    startedAt?: string | null;
  } = {},
): Promise<void> {
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const token = user.session.access_token;
  const ctx = await newBackendContext();
  const body: Record<string, unknown> = {
    status: opts.status ?? "in_progress",
    startedAt: opts.startedAt ?? new Date().toISOString(),
    attemptCount: opts.attemptCount ?? 1,
  };
  if (opts.lastCode !== undefined) body.lastCode = opts.lastCode;
  if (opts.lastOutput !== undefined) body.lastOutput = opts.lastOutput;
  try {
    await seedLessonState(ctx, token, courseId, lessonId, body);
  } finally {
    await ctx.dispose();
  }
}

// Wipe per-device LS keys (OpenAI key, any stragglers). Used by the smoke
// spec that asserts clearAppStorage works as documented.
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
