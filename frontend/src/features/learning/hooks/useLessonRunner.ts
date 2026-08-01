import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Lesson } from "../types";
import type { RunResult } from "../../../types";
import { useAIStore } from "../../../state/aiStore";
import {
  beginProjectOperation,
  isProjectOperationCurrent,
  useProjectStore,
} from "../../../state/projectStore";
import { useRunStore } from "../../../state/runStore";
import { useSessionStore } from "../../../state/sessionStore";
import { useProgressStore } from "../stores/progressStore";
import { useFirstSuccessStore } from "../stores/firstSuccessStore";
import { api } from "../../../api/client";

export interface UseLessonRunnerArgs {
  lesson: Lesson | null;
  courseId: string | undefined;
  lessonId: string | undefined;
  practiceMode: boolean;
  // Holds the "${courseId}/${lessonId}" key of the lesson whose files are
  // currently hydrated into the project store (or null before first
  // hydrate). Consumers truthy-check it to know "init ran" — the key
  // content is only meaningful inside the loader hook that owns it.
  initializedRef: RefObject<string | null>;
  // Controls the tutor pane's collapsed state from outside; "Explain Error"
  // needs to expand it when the tutor is hidden.
  tutorCollapsed: boolean;
  setTutorCollapsed: (v: boolean) => void;
  /**
   * Phase 27-v2.1 — when "anon", handleRun routes to /api/anon/run
   * (one-shot ephemeral container) instead of the session-bound
   * /api/execute. canRun is gated on `lesson` presence rather than
   * `sessionId`. Per-user PATCHes (incrementRun, saveCode,
   * saveOutput) are skipped — anon never writes to /api/user/*.
   * Default "authed" preserves all existing behavior.
   */
  mode?: "authed" | "anon";
  /**
   * The lesson shell can remain mounted while another first-run layer owns
   * interaction. Keep pointer and keyboard Run paths on the same contract so
   * Cmd/Ctrl+Enter cannot execute behind a cinematic or scripted tutor step.
   */
  interactionBlocked?: boolean;
}

export function useLessonRunner({
  lesson,
  courseId,
  lessonId,
  practiceMode,
  initializedRef,
  tutorCollapsed,
  setTutorCollapsed,
  mode = "authed",
  interactionBlocked = false,
}: UseLessonRunnerArgs) {
  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionPhase = useSessionStore((s) => s.phase);
  const running = useRunStore((s) => s.running);
  const lastResult = useRunStore((s) => s.result);
  const setPendingAsk = useAIStore((s) => s.setPendingAsk);
  const incrementRun = useProgressStore((s) => s.incrementRun);
  const saveCode = useProgressStore((s) => s.saveCode);
  const saveOutput = useProgressStore((s) => s.saveOutput);
  const projectFiles = useProjectStore((s) => s.files);

  const [hasRun, setHasRun] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  // Phase 27-v2.2 audit fix (staff-qa P2 + bug-hunter latent): a
  // monotonic counter of edits, exposed so observers can detect
  // SUBSEQUENT edits (not just the first). hasEdited stays true once
  // it flips, which made it useless as a forward-progress signal for
  // the idle watchdog after the first character. editCount changes
  // on every projectFiles update, so any consumer that reads it as
  // an effect dep gets a fresh value per edit.
  const [editCount, setEditCount] = useState(0);

  const handleRun = useCallback(async () => {
    if (interactionBlocked || running || !courseId || !lessonId || !lesson) return;
    // Phase 27-v2.1: mode="authed" still requires an active session;
    // mode="anon" skips the session check (no sessionId on /try/).
    if (mode === "authed" && (!sessionId || sessionPhase !== "active")) return;
    // QA-C2: block Run while Check is executing. The frontend Check button is
    // `disabled={runningTests}`, but Cmd+Enter fires at the window level via
    // `capture:true` and bypasses that. Without this guard, a Cmd+Enter during
    // "Checking…" fires a fresh snapshot that wipes the workspace the test
    // harness is still reading.
    if (useRunStore.getState().runningTests) return;
    const operation = beginProjectOperation();
    if (!useRunStore.getState().beginRun(operation.id)) return;
    try {
      const files = useProjectStore.getState().snapshot();
      const stdin = useRunStore.getState().stdin || undefined;
      let result: RunResult;
      if (mode === "anon") {
        // Phase 27-v2.1 — anon path: one-shot ephemeral container,
        // no project snapshot needed (the route accepts files
        // directly in the body). Skip session-bound API calls.
        result = await api.runAnon(lesson.language, files, stdin);
      } else {
        // Authed path — unchanged from v2: snapshot project then
        // execute against the persistent session container.
        await api.snapshotProject(sessionId!, files);
        if (!isProjectOperationCurrent(operation)) return;
        result = await api.execute(sessionId!, lesson.language, stdin);
      }
      if (!isProjectOperationCurrent(operation)) return;
      if (!useRunStore.getState().commitRunResult(operation.id, result)) return;
      setHasRun(true);
      // Cinema Kit — first-successful-run celebration. Session-scoped
      // (no schema change), per-lesson. Fires a single RingPulse +
      // confetti burst the first time the learner gets a zero-exit
      // run on each lesson in this browser tab.
      if (result.exitCode === 0 && result.errorType === "none") {
        useFirstSuccessStore
          .getState()
          .markIfFirst(courseId, lessonId);
      }
      // Phase 27-v2.1 — skip per-user PATCHes on anon. Anon's run
      // counter, saved code, and saved output never persist to
      // /api/user/lessons/* — the lesson 1 completion gets recorded
      // server-side only at signup-handoff time.
      if (mode === "authed") {
        incrementRun(courseId, lessonId);
        if (!practiceMode) {
          if (result.stdout) {
            saveOutput(courseId, lessonId, result.stdout);
          }
          const codeMap: Record<string, string> = {};
          for (const f of files) codeMap[f.path] = f.content;
          saveCode(courseId, lessonId, codeMap);
        }
      }
    } catch (err) {
      if (!isProjectOperationCurrent(operation)) return;
      const msg = (err as Error).message;
      // Phase A — A5: the anon daily run cap surfaces as a 429 with a
      // machine code in the body; translate it for the run panel
      // instead of printing raw JSON. Signup is the honest escape
      // hatch — the authed path has its own (larger) budget.
      if (mode === "anon" && msg.includes("ANON_RUN_CAP_EXCEEDED")) {
        useRunStore.getState().commitRunError(
          operation.id,
          "You've hit today's free-trial run limit. Sign up to keep going — or come back tomorrow.",
        );
      } else {
        useRunStore.getState().commitRunError(operation.id, msg);
      }
    } finally {
      useRunStore.getState().finishRun(operation.id);
    }
  }, [interactionBlocked, mode, sessionId, sessionPhase, running, courseId, lessonId, lesson, incrementRun, saveOutput, saveCode, practiceMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleRun();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [handleRun]);

  useEffect(() => {
    if (initializedRef.current) {
      setHasEdited(true);
      setEditCount((n) => n + 1);
      // Any code revision invalidates the previous execution evidence. The
      // output store already clears its visible result; keep the coaching
      // state in the same revision so it cannot still say "Your code ran".
      setHasRun(false);
    }
  }, [projectFiles, initializedRef]);

  const handleExplainError = useCallback(() => {
    if (!lastResult?.stderr) return;
    const errText = lastResult.stderr.trim().slice(0, 500);
    setPendingAsk(
      `I got this error when I ran my code:\n\`\`\`\n${errText}\n\`\`\`\nCan you help me understand what went wrong?`,
    );
    if (tutorCollapsed) setTutorCollapsed(false);
  }, [lastResult, setPendingAsk, tutorCollapsed, setTutorCollapsed]);

  const hasStderr = !!(lastResult?.stderr?.trim());
  // Phase 27-v2.1: anon mode doesn't need a session — Run is enabled
  // as soon as the lesson is loaded and no run is in flight. Authed
  // mode gates on sessionPhase as before.
  const canRun =
    mode === "anon"
      ? !!lesson && !running
      : !!sessionId && sessionPhase === "active" && !running;

  return {
    handleRun,
    handleExplainError,
    hasRun,
    hasEdited,
    editCount,
    canRun,
    hasStderr,
    lastResult,
    running,
    sessionId,
    sessionPhase,
    setHasRun,
    setHasEdited,
  };
}
