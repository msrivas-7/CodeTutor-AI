import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Lesson } from "../types";
import {
  loadAllLessonMetas,
  loadCourse,
  loadFullLesson,
  LessonLoaderError,
  type LessonLoadError,
} from "../content/courseLoader";
import { conceptsAvailableBefore } from "../content/conceptGraph";
import { loadSavedCode, useProgressStore } from "../stores/progressStore";
import {
  bufferLessonTime,
  flushLessonHeartbeat,
  installLessonHeartbeatLifecycle,
} from "../stores/lessonHeartbeatBuffer";
import { useAIStore } from "../../../state/aiStore";
import { useProjectStore } from "../../../state/projectStore";
import { LANGUAGE_ENTRYPOINT } from "../../../types";
import { RESUME_TOAST_MS } from "../../../util/timings";
import { shouldBouncePrereq, shouldPersistLessonDraft } from "./lessonGuards";

export interface UseLessonLoaderArgs {
  courseId: string | undefined;
  lessonId: string | undefined;
  /**
   * Phase 27-v2.1: null on the anon `/try/` path (no signed-in user).
   * When null, internal /api/user/* PATCH calls (startLesson, lesson-
   * progress writes) are skipped — anon never writes to the per-user
   * progress / preferences tables. Lesson content (markdown, starter
   * files, completionRules) is loaded from the public course JSON
   * regardless of mode.
   */
  learnerId: string | null;
  // Passed in so the debounced auto-save writes to the right bucket
  // (lastCode vs. practiceExerciseCode) without the loader owning the
  // practice state machine itself.
  practiceMode: boolean;
  practiceIndex: number;
  // When true, a fresh lesson mount should reset caller-owned flags so
  // e.g. per-lesson counters don't leak between lessons. The loader signals
  // "about to load a fresh lesson" via this callback so the validator hook
  // can clear its own bookkeeping.
  onResetPerLessonState?: () => void;
  // When true, skip the resume-from-savedCode branch and always hydrate
  // the editor with the authored starterFiles. Used by the first-run
  // cinematic handoff (?firstRun=1) so the scripted choreography always
  // operates on the authored starter (Phase A — A1: an empty shell with
  // hint comments) rather than whatever the learner left in the buffer
  // on a prior visit.
  forceStarter?: boolean;
  /** Ephemeral anonymous workspace restored from this tab's sessionStorage. */
  resumeCode?: Record<string, string> | null;
  /**
   * Project/run cache identity for the main lesson workspace. Anonymous and
   * authenticated lessons must use different identities even when the course
   * and lesson slugs match, otherwise an anonymous draft can leak into a
   * signed-in account in the same tab.
   */
  workspaceContextKey: string | null;
}

export function useLessonLoader({
  courseId,
  lessonId,
  learnerId,
  practiceMode,
  practiceIndex,
  onResetPerLessonState,
  forceStarter,
  resumeCode,
  workspaceContextKey,
}: UseLessonLoaderArgs) {
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [courseTitle, setCourseTitle] = useState<string>("");
  const [totalLessons, setTotalLessons] = useState(10);
  const [lessonOrder, setLessonOrder] = useState<string[]>([]);
  // Phase A — A7: next lesson's title for the post-credits beat.
  const [nextLessonTitle, setNextLessonTitle] = useState<string | null>(null);
  const [priorConcepts, setPriorConcepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [resumed, setResumed] = useState(false);
  // QA-M2: null = no attempt or success. "not_found" = the static asset
  // returned 404. "schema_error" = the JSON parsed but Zod refused it.
  // Page shell renders different copy for each; dev console prints issues.
  const [loadError, setLoadError] = useState<LessonLoadError | null>(null);

  // `initialized` gates one-shot effects (first project hydration, edit
  // detector, test-report invalidation). Kept on a ref so the loader can
  // expose it to the runner + validator without tripping React state churn.
  // Tracks WHICH lesson-id has been hydrated into the project store, not
  // just "has init run." A plain boolean ref broke the next-lesson flow:
  // when the URL flips A → B, Effect 1 resets the ref and kicks off the
  // lesson-B fetch, but Effect 2 fires in the same render tick before
  // `lesson` state updates to B — so init runs with lesson=A but
  // lessonId=B, writing A's starterFiles under B's storage key. The
  // learner lands on B still seeing A's code until they click Reset.
  // Keying by "${courseId}/${lessonId}" means Effect 2 waits for
  // `lesson.id === lessonId` AND only inits once per lesson identity.
  const initializedForRef = useRef<string | null>(null);
  // Reactive companion used by interactive controls. The ref protects the
  // one-shot hydration effect; this state tells the rendered workspace that
  // the final project context has actually been installed.
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const resumedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const startLesson = useProgressStore((s) => s.startLesson);
  const incrementLessonTime = useProgressStore((s) => s.incrementLessonTime);
  const saveCode = useProgressStore((s) => s.saveCode);
  const savePracticeCode = useProgressStore((s) => s.savePracticeCode);
  // Phase 21A: chat context switch moved to LessonPage so it can include
  // practice mode in the key (otherwise lesson↔practice histories bleed).
  // Run context still keyed per-lesson here — runs/files don't bleed.
  const switchProjectContext = useProjectStore((s) => s.switchProjectContext);
  const projectFiles = useProjectStore((s) => s.files);
  const projectContext = useProjectStore((s) => s.projectContext);

  useEffect(() => {
    return () => clearTimeout(resumedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!courseId || !lessonId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    onResetPerLessonState?.();
    Promise.all([
      loadFullLesson(courseId, lessonId),
      loadCourse(courseId),
      loadAllLessonMetas(courseId),
    ])
      .then(([l, course, metas]) => {
        if (cancelled) return;
        // Prereq guard: a direct URL to a locked lesson must not unlock it.
        // Mirrors LessonList.tsx's gate — prereqs unmet + no prior progress
        // means bounce to the course page, which shows the lock icon and
        // the learner's actual next-up lesson. We check BEFORE startLesson
        // so an unauthorized visit doesn't create an in_progress record
        // that would then self-unlock the lesson on refresh.
        const progressState = useProgressStore.getState();
        const completedIds = progressState.courseProgress[courseId]?.completedLessonIds ?? [];
        const existingStatus =
          progressState.lessonProgress[`${courseId}/${lessonId}`]?.status ?? "not_started";
        if (
          shouldBouncePrereq({
            lessonPrerequisiteIds: l.prerequisiteLessonIds,
            completedLessonIds: completedIds,
            existingStatus,
          })
        ) {
          navigate(`/learn/course/${courseId}`, { replace: true });
          return;
        }
        setLesson(l);
        setCourseTitle(course.title);
        setTotalLessons(course.lessonOrder.length);
        setLessonOrder(course.lessonOrder);
        const metaMap = new Map(metas.map((m) => [m.id, m]));
        setPriorConcepts(conceptsAvailableBefore(course, metaMap, lessonId));
        // Phase A — A7 (post-credits): the NEXT lesson's title, for the
        // celebration's "In the next lesson…" beat when the lesson
        // hasn't authored a nextLessonHint. Null on the final lesson.
        const idx = course.lessonOrder.indexOf(lessonId);
        const nextId =
          idx >= 0 && idx < course.lessonOrder.length - 1
            ? course.lessonOrder[idx + 1]
            : null;
        setNextLessonTitle(nextId ? metaMap.get(nextId)?.title ?? null : null);
        // Phase 27-v2.1: skip the per-learner startLesson PATCH on
        // anon mode (learnerId === null). Lesson content is fetched
        // and rendered identically; only the server-side "user has
        // started this lesson" tracking is suppressed.
        if (learnerId !== null) {
          startLesson(learnerId, courseId, lessonId);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLesson(null);
        if (err instanceof LessonLoaderError) {
          if (err.kind === "schema_error") {
            setLoadError({ kind: "schema_error", message: err.message, issues: err.issues });
            if (import.meta.env.DEV) {
              console.error(`[content] ${err.message}`);
              for (const issue of err.issues) console.error(`  • ${issue}`);
            }
          } else {
            setLoadError({ kind: "not_found", message: err.message });
          }
        } else {
          const message = err instanceof Error ? err.message : "Failed to load lesson";
          setLoadError({ kind: "not_found", message });
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, lessonId, learnerId, startLesson]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lesson || !courseId || !lessonId || !workspaceContextKey) return;
    // Guard against stale `lesson` state. Effect 1 initiates the
    // lesson-B fetch when the URL flips, but this effect's `lesson`
    // closure may still point to lesson A until `setLesson(B)` lands.
    // Running init with a mismatched lesson writes A's starterFiles
    // under B's storage key — the "old code in new lesson" bug.
    if (lesson.id !== lessonId) return;
    const key = `${courseId}/${lessonId}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;

    const savedCode = forceStarter
      ? null
      : resumeCode ?? loadSavedCode(courseId, lessonId);

    const files: Record<string, string> = {};
    const order: string[] = [];

    if (savedCode && Object.keys(savedCode).length > 0) {
      for (const [path, content] of Object.entries(savedCode)) {
        files[path] = content;
        order.push(path);
      }
      setResumed(true);
      resumedTimerRef.current = setTimeout(() => setResumed(false), RESUME_TOAST_MS);
    } else {
      for (const f of lesson.starterFiles) {
        files[f.path] = f.content;
        order.push(f.path);
      }
    }

    const entry = LANGUAGE_ENTRYPOINT[lesson.language];
    if (order.length === 0) {
      files[entry] = "# Write your code here\n";
      order.push(entry);
    }

    // forceDefaults piggy-backs on forceStarter — both flags exist for
    // the same first-run cinematic case where the AUTHORED starter
    // must be visible. Without forceDefaults, projectCache would
    // re-hydrate the user's previously-edited buffer for this context
    // and the scripted choreography would mis-narrate against text
    // the learner already changed (Phase A — A1: starter is comment-
    // only, so a stale buffer would also defeat the empty-shell
    // teaching shape).
    //
    // Phase 22F2 prep: openTabs now includes EVERY starter file, not
    // just the entry point. Multi-file lessons (e.g. modules-and-imports)
    // would otherwise leave helper.py invisible — the file would load
    // into projectStore.files (Run + imports work) but the learner
    // would have no tab to click. The active tab still defaults to
    // order[0] (the entry point) so the visual starting point is
    // unchanged for single-file lessons.
    switchProjectContext(
      workspaceContextKey,
      {
        language: lesson.language,
        files,
        order,
        activeFile: order[0],
        openTabs: [...order],
      },
      forceStarter ? { forceDefaults: true } : undefined,
    );
    setInitializedFor(key);
  }, [lesson, courseId, lessonId, resumeCode, workspaceContextKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save. Lesson-mode writes to `lastCode`; practice-mode
  // writes to `practiceExerciseCode[exerciseId]` so switching exercises
  // doesn't clobber the main lesson buffer.
  useEffect(() => {
    // Only auto-save once we've actually hydrated THIS lesson's files
    // into the store. Using the same key the init effect stamps on
    // success — if it doesn't match, we'd risk saving another lesson's
    // buffer under this lesson's key.
    if (
      !courseId ||
      !lessonId ||
      !workspaceContextKey ||
      initializedForRef.current !== `${courseId}/${lessonId}`
    )
      return;
    const exercise = practiceMode
      ? lesson?.practiceExercises?.[practiceIndex]
      : null;
    const expectedContext = exercise
      ? `practice:${courseId}/${lessonId}/${exercise.id}`
      : workspaceContextKey;
    // Anonymous work is persisted by LessonPage's sessionStorage workspace.
    // Never let an authenticated browser session make /try autosaves write
    // into that signed-in user's durable lesson record.
    if (!shouldPersistLessonDraft(learnerId, projectContext, expectedContext)) return;
    const timer = setTimeout(() => {
      const snap = useProjectStore.getState().snapshot();
      if (snap.length === 0) return;
      const codeMap: Record<string, string> = {};
      for (const f of snap) codeMap[f.path] = f.content;
      if (practiceMode) {
        const exercise = lesson?.practiceExercises?.[practiceIndex];
        if (exercise) savePracticeCode(courseId, lessonId, exercise.id, codeMap);
      } else {
        void saveCode(courseId, lessonId, codeMap);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [projectFiles, projectContext, courseId, lessonId, learnerId, workspaceContextKey, saveCode, savePracticeCode, practiceMode, practiceIndex, lesson]);

  // Time-spent tracking — tick only while the document is visible and the
  // lesson isn't yet complete. Caps deltas at 60s so a long hidden/suspended
  // span can't inflate time.
  //
  // P-H4: incrementLessonTime now only updates the in-memory store (for the
  // smoothly-animating "Time spent" badge). The durable write goes through
  // the lessonHeartbeatBuffer which batches deltas and flushes on a 60s
  // cadence + pagehide/visibilitychange (via fetch keepalive). Net: ≤ 1
  // server write per lesson per minute instead of every 30s tick, and a
  // tab close flushes the in-flight delta instead of dropping it.
  //
  // Phase 27-v2.1: skip the heartbeat lifecycle entirely on anon
  // (learnerId === null). The `bufferLessonTime` + 60s flush would
  // POST /api/user/lessons/heartbeat → 401 (no token). Anon's time-
  // on-lesson is informational only; we don't track it server-side
  // because there's no per-user row to write to. The in-memory
  // "Time spent" badge IS rendered for anon (cosmetic), but the
  // durable write path is suppressed — Maya pausing on /try/ for
  // 60+s won't fire failing POSTs against the backend.
  useEffect(() => {
    if (!courseId || !lessonId || practiceMode) return;
    if (learnerId === null) return;
    const uninstall = installLessonHeartbeatLifecycle();
    let lastTick = Date.now();
    const TICK_MS = 30_000;
    const MAX_DELTA = 60_000;

    const credit = () => {
      const now = Date.now();
      const delta = Math.min(now - lastTick, MAX_DELTA);
      lastTick = now;
      const current = useProgressStore.getState().lessonProgress[`${courseId}/${lessonId}`];
      if (current?.status === "completed") return;
      if (delta > 0 && document.visibilityState === "visible") {
        incrementLessonTime(courseId, lessonId, delta);
        bufferLessonTime(courseId, lessonId, delta);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastTick = Date.now();
      } else {
        credit();
      }
    };

    const interval = setInterval(credit, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      credit();
      // Best-effort final flush on unmount so navigating to another lesson
      // in the SPA doesn't leave the buffer sitting until the 60s tick.
      void flushLessonHeartbeat();
      uninstall();
    };
  }, [courseId, lessonId, practiceMode, learnerId, incrementLessonTime]);

  return {
    lesson,
    courseTitle,
    totalLessons,
    lessonOrder,
    nextLessonTitle,
    priorConcepts,
    loading,
    resumed,
    loadError,
    initializedForRef,
    initializedFor,
  };
}
