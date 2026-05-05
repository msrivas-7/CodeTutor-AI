import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { loadFullLesson } from "../content/courseLoader";
import { validateLesson } from "../utils/validator";
import type { Lesson } from "../types";
import type { RunResult } from "../../../types";
import { SignupWallDialog, type SignupWallReason } from "../components/SignupWallDialog";
import { CinematicGreeting } from "../../firstRun/CinematicGreeting";
import { useFirstRunStore } from "../../firstRun/useFirstRunStore";
import { useFirstRunChoreography } from "../../firstRun/useFirstRunChoreography";
import { useAIStore } from "../../../state/aiStore";
import { useRunStore } from "../../../state/runStore";
import {
  extractNameFromCode,
  hasCinematicSeen,
  markCinematicSeen,
  writeAnonStash,
} from "../../anon/anonStash";

// Phase 27 §3a — anonymous lesson 1 page.
//
// Loaded at /try/lesson/:courseId/:lessonId, OUTSIDE the AuthedLayout
// guard. Hard-locked to python-fundamentals/hello-world via the
// allowlist below — any other (courseId, lessonId) pair redirects
// home so a future signed-out marketing post-Maya audience can't
// stumble into a lesson the backend allowlist would 403 anyway.
//
// Surfaces:
//   - First-run CinematicGreeting (mode="full", firstName="there")
//     on first /try/ visit per browser tab — dissolves into the
//     editor below. sessionStorage flag prevents replay after
//     dismiss. Phase 27-v2 Day 2.
//   - lesson title + content.md (rendered with the same minimal
//     markdown style as LessonInstructionsPanel)
//   - Monaco editor seeded from the lesson's starter file
//   - Run button — POSTs to /api/anon/run
//   - Output panel
//   - Tutor "Nudge me" affordance — POSTs to /api/anon/ai/ask/stream
//   - SignupWallDialog on Save / Next-lesson clicks (Maya's win
//     moment), and on AI exhaustion (you're getting it — sign up).
//
// What's intentionally absent: streak chip, save state, progress
// tracking, BYOK key surfaces, share dialog, lesson-complete panel.
// The signup wall covers the cases that would land users in any of
// those gated flows.

const ANON_ALLOWED = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
} as const;

interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AnonLessonPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Phase 27-v2 Day 3b: capture the starter contents at lesson load
  // so the choreography's runner.hasEdited can flip from false → true
  // when the learner mutates the buffer. Without a stable starter
  // baseline, hasEdited would always read true (the runner sees
  // `code` which equals starterFiles[0].content from the moment the
  // page mounts).
  const [starterCode, setStarterCode] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<RunResult | null>(null);
  // Tracks how many times handleRun has resolved — the runner
  // contract uses `hasRun: boolean` (any run done), but the
  // choreography also disambiguates "auto-run for celebrateRun" from
  // "user's own run for awaitEdit" by watching for a NEW result
  // reference after step transitions to awaitEdit. Counter is just
  // for debugging tooling; the boolean derived below is what the
  // hook reads.
  const [runCount, setRunCount] = useState(0);
  const [tutorInput, setTutorInput] = useState("");
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [tutorAsking, setTutorAsking] = useState(false);
  const [tutorErr, setTutorErr] = useState<string | null>(null);
  const [wall, setWall] = useState<{ open: boolean; reason: SignupWallReason }>({
    open: false,
    reason: "save",
  });
  // Mobile-only collapse state for the instructions block. On md:+
  // breakpoints the instructions live in a side column and are
  // always visible. On phones the instructions stack ABOVE the
  // editor — and the markdown body for hello-world is ~25 lines
  // tall, which pushes the Run button + tutor input two folds
  // below the arrival point. Maya gives this 90 seconds; she
  // wouldn't scroll twice. Default-collapsed on mobile, expandable
  // via a "Show instructions" affordance.
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Phase 27-v2 Day 2: full first-run cinematic on the trial path.
  // Same component the authed /welcome page uses (no fork) — anon
  // learners get the SAME hero moment as a direct-signup user, just
  // earlier in the funnel. firstName is "there" because we don't
  // yet know Maya's name (option d in the v2 plan: personalization
  // is earned at the praise turn after she replaces YOUR_NAME). The
  // cinematic plays once per browser tab; reload mid-lesson does
  // NOT replay (sessionStorage flag).
  const [showCinematic, setShowCinematic] = useState(() => !hasCinematicSeen());
  const dismissCinematic = () => {
    markCinematicSeen();
    setShowCinematic(false);
    // CinematicGreeting in mode="full" stamps cinematicExitingAt for
    // the /welcome → /learn/... match-cut RingPulse handoff. On the
    // anon path that signal must NOT leak: if Maya immediately clicks
    // Sign-up after dismiss and the post-signup nav lands on an
    // authed LessonPage within the 1.5s match-cut window, LessonPage
    // would render a contracting ring choreographed for the welcome
    // boundary — wrong cut for the anon→signup→lesson-2 path. Clear
    // it explicitly here so the anon dismiss never leaves a stale
    // marker in the module-scoped store.
    useFirstRunStore.getState().clearCinematicExiting();
  };

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // Phase 27-v2 Day 3b: shared run state for the choreography hook.
  // hasRun = at least one /api/anon/run round-trip has resolved (which
  // updates `output` and bumps runCount). hasEdited = the buffer
  // diverges from the captured starter — once true it stays true
  // even if the learner reverts (Monaco's history is the recovery
  // path, the runner just cares about "did they ever touch it").
  const hasEdited = code !== starterCode && starterCode.length > 0;
  // Phase 27 first-run choreography step (also drives the Check
  // affordance reveal — Check is hidden until the praise turn lands).
  const firstRunStep = useFirstRunStore((s) => s.step);

  // Choreography wakes up only after the cinematic has dismissed
  // AND the lesson has loaded (otherwise the greet beat fires while
  // Maya's still watching the cinematic, or before Monaco is ready
  // to receive the auto-Run). step === "done" tear-down handled by
  // the hook itself.
  const choreographyEnabled = !showCinematic && lesson !== null;

  // handleRun is defined later in this function (it depends on
  // state declared above), but the choreography needs a stable
  // reference NOW to bind into runner.handleRun. A ref breaks the
  // declaration cycle: render → ref-update effect → choreography
  // reads ref.current at the moment it auto-clicks, never during
  // the render that reads useFirstRunChoreography itself.
  const handleRunRef = useRef<() => Promise<void>>(async () => {});

  // Stable wrapper for the praise-time name extractor. Without this
  // useRef indirection, the inline `() => extractNameFromCode(code)`
  // arrow we'd otherwise pass to useFirstRunChoreography is a NEW
  // function identity on every render — and `code` changes on every
  // Monaco keystroke, so each render triggers the choreography
  // effect's deps to re-fire, which would re-execute step transitions
  // (praiseEditRun would stream the praise turn TWICE if Maya types
  // a character mid-stream). The ref gives the hook a stable reference
  // it can call lazily at the praise-time moment to read the current
  // code, without participating in render-trigger reactivity.
  const codeRef = useRef(code);
  codeRef.current = code;
  const resolvePraiseNameRef = useRef(() =>
    extractNameFromCode(codeRef.current),
  );

  // Phase 27-v2 Day 3c: lesson-completion validator. Pure derivation
  // off (output, code, lesson.completionRules) — runs every render
  // but the validator itself is cheap (substring + small string ops).
  // Used by (a) the choreography's awaitCheck step, which transitions
  // to seed when validation.passed flips true, and (b) the Check
  // button's enable state. The dual-rule lesson 1 (expected_stdout
  // "Hello, " + forbidden_in_stdout "YOUR_NAME") guarantees this
  // only flips true after Maya replaces YOUR_NAME with her own
  // value AND runs the program.
  const validation = useMemo(() => {
    if (!output || !lesson) return null;
    return validateLesson(
      output,
      [{ path: "main.py", content: code }],
      lesson.completionRules,
      { language: lesson.language },
    );
  }, [output, lesson, code]);

  // Lesson-complete state — flipped when the user clicks Check AND
  // validation passes. Mounts the celebration overlay below in place
  // of the bottom Save / Next-lesson row.
  const [lessonComplete, setLessonComplete] = useState(false);

  // Single source of the typed name. The celebration JSX header AND
  // the Sign Up CTA's stash payload both must agree on what gets
  // shown post-signup: if the celebration says "You did it, Maya."
  // and the stash carries name="maya" (lowercase) due to a future
  // parser tweak, lesson 2's tutor would open with "Hey maya" while
  // the celebration she JUST saw said "Maya." Memoizing once means
  // any future change to the parser stays consistent across both
  // surfaces. No deps on `code` directly because the parser already
  // closes over it; React recomputes on every code edit, which is
  // what we want.
  const parsedName = useMemo(() => extractNameFromCode(code), [code]);

  // Phase 27-v2 Day 3b: scripted-tutor history rendered alongside
  // the user-driven tutor Q&A. The choreography pushes turns into
  // useAIStore via pushScriptedAssistant; we read history + pending
  // here so the bubble shows greet → celebrateRun → praise as they
  // type in. The local `tutorMessages` state continues to hold the
  // user's post-scripted Q&A turns. Both lists are rendered in
  // chronological order (scripted first — they always fire before
  // any user-driven question can land).
  const scriptedHistory = useAIStore((s) => s.history);
  const scriptedPending = useAIStore((s) => s.pending);
  const scriptedActive = firstRunStep !== "idle" && firstRunStep !== "done";

  useFirstRunChoreography({
    enabled: choreographyEnabled,
    firstName: "there",
    runner: {
      canRun: !!lesson && !running,
      hasRun: runCount > 0,
      hasEdited,
      running,
      handleRun: () => handleRunRef.current(),
    },
    validator: { validation },
    onSeed: "anon-stash",
    resolvePraiseName: resolvePraiseNameRef.current,
  });

  // Clear runStore on unmount so a user signing up immediately
  // doesn't have anon stdout sitting in the shared store when
  // LessonPage mounts. Same hygiene the authed page applies.
  useEffect(() => {
    return () => {
      useRunStore.getState().setResult(null);
    };
  }, []);

  // Allowlist check — short-circuit with a redirect for any path
  // that doesn't match. The backend would 403 too; this saves a
  // round trip and keeps the anon URL space honest.
  const allowed =
    courseId === ANON_ALLOWED.courseId && lessonId === ANON_ALLOWED.lessonId;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    loadFullLesson(ANON_ALLOWED.courseId, ANON_ALLOWED.lessonId)
      .then((l) => {
        if (cancelled) return;
        setLesson(l);
        const starter = l.starterFiles[0]?.content ?? "";
        setCode(starter);
        setStarterCode(starter);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  if (!allowed) return <Navigate to="/" replace />;

  // Phase 27-v2 Day 2 — full first-run cinematic on /try/.
  // Mounted at the SAME tree position (inside the single outer div
  // pattern) regardless of loadError / !lesson / loaded state, so React
  // preserves the CinematicGreeting instance across the
  // loading→loaded transition. If we returned different root element
  // types from each branch (Fragment vs div), React would unmount the
  // cinematic mid-arc when lesson resolution flipped state, restarting
  // the 14.2s timer at character 0 — visible glitch on the hero
  // moment. The overlay is fixed inset-0 z-[60] so it covers
  // whichever inner content is rendered (loading placeholder, error
  // block, or full workspace).
  const cinematicNode = showCinematic ? (
    <CinematicGreeting
      mode="full"
      firstName="there"
      heroLine="Hello, there!"
      subtitle="Every lesson works like this. Write code, watch it answer."
      supportLine="Starting your first lesson…"
      onComplete={dismissCinematic}
      onSkip={dismissCinematic}
    />
  ) : null;

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col bg-bg text-ink">
        {cinematicNode}
        <div className="flex h-full items-center justify-center bg-bg p-8 text-center text-ink">
          <div>
            <h1 className="mb-2 text-xl font-semibold">Couldn't load this lesson</h1>
            <p className="text-sm text-muted">{loadError}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!lesson) {
    return (
      <div className="flex min-h-screen flex-col bg-bg text-ink">
        {cinematicNode}
        <div className="flex h-full items-center justify-center bg-bg text-muted">
          Loading lesson…
        </div>
      </div>
    );
  }

  const handleRun = async () => {
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/anon/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: lesson.language,
          files: [{ path: "main.py", content: code }],
        }),
      });
      if (!res.ok) {
        setOutput({
          stdout: "",
          stderr: `Run failed (${res.status})`,
          exitCode: 1,
          errorType: "system",
          durationMs: 0,
          stage: "run",
        });
        return;
      }
      const result = (await res.json()) as RunResult;
      setOutput(result);
      setRunCount((n) => n + 1);
      // Mirror into the shared runStore so useFirstRunChoreography's
      // awaitEdit + celebrateRun observers can read the latest stdout
      // for personalized-name detection. The choreography hook reads
      // useRunStore.getState().result directly when picking copy
      // (see useFirstRunChoreography.ts step="correctEdit" branch);
      // without this mirror it would always see null on /try/.
      useRunStore.getState().setResult(result);
    } catch (err) {
      setOutput({
        stdout: "",
        stderr: (err as Error).message,
        exitCode: 1,
        errorType: "system",
        durationMs: 0,
        stage: "run",
      });
    } finally {
      setRunning(false);
    }
  };
  // Bind the latest handleRun into the ref so choreography auto-clicks
  // pick up the freshest closure (not stale `lesson` / `code`).
  handleRunRef.current = handleRun;

  const handleAskTutor = async () => {
    const question = tutorInput.trim();
    if (!question || tutorAsking) return;
    setTutorAsking(true);
    setTutorErr(null);
    setTutorMessages((prev) => [...prev, { role: "user", content: question }]);
    setTutorInput("");

    // Anon ask body — lessonContext is REQUIRED on the server route.
    const body = {
      model: "gpt-4.1-nano",
      question,
      files: [{ path: "main.py", content: code }],
      activeFile: "main.py",
      lastRun: output ?? undefined,
      history: tutorMessages,
      lessonContext: {
        courseId: lesson.courseId,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        language: lesson.language,
        lessonObjectives: lesson.objectives,
        teachesConceptTags: lesson.teachesConceptTags,
        usesConceptTags: lesson.usesConceptTags,
        priorConcepts: [],
        completionRules: lesson.completionRules,
        studentProgressSummary: "anonymous visitor, first try",
        lessonOrder: lesson.order,
      },
    };

    try {
      const res = await fetch("/api/anon/ai/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 429 ANON_EXHAUSTED is the signal to surface the sign-up wall
        // with the "you're getting it" frame. Any other status is a
        // genuine error path.
        if (res.status === 429) {
          setWall({ open: true, reason: "exhausted" });
          // Pop the user's question out of history; they didn't get a
          // reply, so re-asking after signup shouldn't carry the
          // ghost message.
          setTutorMessages((prev) => prev.slice(0, -1));
        } else {
          // Friendly error mapping — never surface raw server JSON
          // ({"error":"PLATFORM_AI_PAUSED"} etc.) into the tutor UI.
          // The server response is debuggable via the network tab;
          // Maya/Alex see warm copy.
          const friendly =
            res.status === 503
              ? "The tutor's taking a quick break. Try again in a minute?"
              : res.status === 403
                ? "That's not available on the trial path. Sign up to keep going."
                : res.status >= 500
                  ? "Something went wrong on our side. Try again?"
                  : "Couldn't reach the tutor. Try again?";
          setTutorErr(friendly);
          // No assistant placeholder was seeded yet (that happens
          // below, post-headers), so nothing to pop here. The user's
          // question stays in the chat — they can retry or sign up.
        }
        return;
      }
      if (!res.body) {
        setTutorErr("No response body from tutor.");
        return;
      }
      // Minimal SSE parser — same shape as the authed client (we only
      // care about delta + done + error frames). Non-streaming reply
      // accumulator: append deltas into the last assistant message
      // text so the user sees the response stream in.
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      let pendingReply = "";
      // Seed the assistant message; deltas append to its content.
      setTutorMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""));
          const data = dataLines.join("\n");
          if (!data) continue;
          let evt: { delta?: string; done?: boolean; error?: string; sections?: { summary?: string; hint?: string; nextStep?: string } };
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }
          if (evt.error) {
            // Friendly copy — the upstream message ("model invocation
            // failed", "rate limit") is for ops, not for Maya. Pop the
            // empty assistant placeholder we seeded above so the chat
            // doesn't show a phantom `Tutor: ` bubble next to the red
            // error banner.
            setTutorErr("The tutor stumbled mid-thought. Try asking again?");
            setTutorMessages((prev) =>
              prev.length > 0 &&
              prev[prev.length - 1]!.role === "assistant" &&
              prev[prev.length - 1]!.content === ""
                ? prev.slice(0, -1)
                : prev,
            );
            continue;
          }
          if (evt.delta) {
            // Phase 27-v2 Day 3d: do NOT append raw JSON deltas into
            // the visible bubble. The tutor stream emits structured
            // JSON tokens (`{"summary":"..."`); writing them into
            // the bubble surfaces the underlying protocol to Maya
            // for ~2s before `done` arrives with the parsed sections.
            // Instead we accumulate silently in pendingReply (kept
            // for debugging via React DevTools / future telemetry)
            // and let the empty bubble render the "…" thinking
            // indicator (see jsx fallback `m.content || (tutorAsking
            // ? "…" : "")`). The bubble flips to human-readable
            // content the moment `done.sections` lands.
            pendingReply += evt.delta;
          }
          if (evt.done) {
            // Replace the empty assistant placeholder with the
            // human-readable sections — summary/hint/nextStep
            // joined into one paragraph. If the server sent `done`
            // without sections (rare — malformed JSON tokens, or a
            // model that returned text without structure), fall
            // back to a friendly "couldn't parse" line rather than
            // leaving a phantom empty bubble next to the now-idle
            // input.
            const s = evt.sections;
            const human = s
              ? [s.summary, s.hint, s.nextStep]
                  .filter((x): x is string => !!x && x.length > 0)
                  .join("\n\n")
              : "";
            setTutorMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                content: human ||
                  "Couldn't read the tutor's reply — try asking again?",
              };
              return next;
            });
          }
        }
      }
    } catch (err) {
      setTutorErr((err as Error).message);
    } finally {
      setTutorAsking(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      {cinematicNode}

      {/* Top bar — anon badge + sign-up CTA */}
      <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-xs text-muted hover:text-ink">
            ← Home
          </Link>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            Try it — no signup
          </span>
        </div>
        <button
          type="button"
          onClick={() => setWall({ open: true, reason: "save" })}
          className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
        >
          Sign up to save
        </button>
      </header>

      {/* Main split: instructions on left, editor + output + tutor on right.
          Stacks on mobile (most TikTok arrivals). */}
      <div className="flex flex-1 flex-col md:flex-row">
        {/* Instructions */}
        <section className="border-b border-border bg-panel/60 p-5 md:w-[40%] md:max-w-md md:border-b-0 md:border-r">
          <h1 className="mb-1 font-display text-[24px] font-semibold leading-tight text-ink">
            {lesson.title}
          </h1>
          {lesson.description && (
            <p className="text-[13px] leading-relaxed text-muted">
              {lesson.description}
            </p>
          )}
          {/* Mobile-only toggle. Hidden on md:+ where the side column
              has plenty of vertical space for the full markdown. */}
          <button
            type="button"
            onClick={() => setInstructionsOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:text-accent/80 md:hidden"
            aria-expanded={instructionsOpen}
            aria-controls="anon-lesson-instructions"
          >
            {instructionsOpen ? "Hide instructions ↑" : "Show instructions ↓"}
          </button>
          {/* Full markdown — always visible on desktop, gated by the
              mobile toggle on phones. */}
          <div
            id="anon-lesson-instructions"
            className={`mt-3 ${instructionsOpen ? "block" : "hidden"} md:block`}
          >
            <AnonMarkdown text={lesson.content} />
          </div>
        </section>

        {/* Editor + output + tutor */}
        <section className="flex flex-1 flex-col">
          {/* Editor */}
          <div className="flex items-center justify-between border-b border-border bg-panel/60 px-4 py-2">
            <span className="font-mono text-[11px] text-muted">main.py</span>
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="rounded-md bg-success/85 px-3 py-1 text-[12px] font-bold text-bg shadow-[0_2px_0_rgba(0,0,0,0.18)] transition hover:bg-success disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? "Running…" : "▶ Run"}
            </button>
          </div>
          <div className="h-[40vh] md:h-[45vh]">
            <Editor
              height="100%"
              language="python"
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              onMount={onMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Output */}
          <div className="border-t border-border bg-elevated/40 p-3 font-mono text-[12px] leading-relaxed">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
              Output
            </div>
            {!output && (
              <p className="text-faint italic">Click Run to see your output.</p>
            )}
            {output && (
              <>
                {output.stdout && <pre className="text-ink">{output.stdout}</pre>}
                {output.stderr && (
                  <pre className="text-danger">{output.stderr}</pre>
                )}
                {!output.stdout && !output.stderr && (
                  <p className="text-faint italic">(no output)</p>
                )}
              </>
            )}
          </div>

          {/* Tutor */}
          <div className="flex flex-col gap-2 border-t border-border bg-panel/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              Stuck? Ask the tutor
            </div>
            {(scriptedHistory.length > 0 ||
              scriptedPending !== null ||
              tutorMessages.length > 0) && (
              <div className="max-h-[20vh] space-y-2 overflow-y-auto rounded-md border border-border bg-bg/50 p-2">
                {/* Scripted choreography turns — always render first
                    chronologically. Each turn's `summary` carries the
                    rendered text (pushScriptedAssistant fills it). */}
                {scriptedHistory.map((m, i) => {
                  const text =
                    m.role === "user"
                      ? m.content
                      : (m.sections?.summary ?? m.content);
                  return (
                    <div
                      key={`s-${m.id ?? i}`}
                      className={`text-[12px] leading-relaxed ${
                        m.role === "user"
                          ? "text-ink"
                          : "rounded bg-accent/[0.06] px-2 py-1 italic text-accent"
                      }`}
                    >
                      {m.role === "user" ? "You: " : "Tutor: "}
                      <span className="not-italic">{text}</span>
                    </div>
                  );
                })}
                {/* Pending scripted stream — typewriter-cadenced text
                    that hasn't yet been committed to history. */}
                {scriptedPending && (
                  <div className="rounded bg-accent/[0.06] px-2 py-1 text-[12px] italic leading-relaxed text-accent">
                    Tutor:{" "}
                    <span className="not-italic">
                      {scriptedPending.sections?.summary ??
                        scriptedPending.raw ??
                        "…"}
                    </span>
                  </div>
                )}
                {/* User-driven Q&A — only rendered after the scripted
                    choreography has handed back ("done"). During
                    scripted phase, the input below is disabled too. */}
                {tutorMessages.map((m, i) => (
                  <div
                    key={`u-${i}`}
                    className={`text-[12px] leading-relaxed ${
                      m.role === "user"
                        ? "text-ink"
                        : "rounded bg-accent/[0.06] px-2 py-1 italic text-accent"
                    }`}
                  >
                    {m.role === "user" ? "You: " : "Tutor: "}
                    <span className="not-italic">{m.content || (tutorAsking ? "…" : "")}</span>
                  </div>
                ))}
              </div>
            )}
            {tutorErr && (
              <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                {tutorErr}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAskTutor();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={tutorInput}
                onChange={(e) => setTutorInput(e.target.value)}
                placeholder={
                  scriptedActive
                    ? "Tutor's mid-thought — give them a sec…"
                    : "What's confusing you?"
                }
                // Disabled during scripted choreography so a learner
                // can't race ahead of the greet → run → praise arc;
                // the ai-store subscription in useFirstRunChoreography
                // also treats user typing as a skip signal, so this
                // is belt-and-suspenders.
                disabled={tutorAsking || scriptedActive}
                className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={tutorAsking || scriptedActive || !tutorInput.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ask
              </button>
            </form>
          </div>

          {/* Save / Next CTAs — both gated behind the wall. */}
          {/* Bottom CTA row. The shape changes once the lesson is
              complete: pre-completion → Check (gated on validator) +
              Save (signup wall save-frame). Post-completion → the
              celebration block below the editor takes over and the
              Sign-up CTA carries the stash to lesson 2. The Next-
              lesson and Save buttons disappear once Maya has hit
              the win moment so the celebration is the only path
              forward (no competing call-to-action). */}
          <div className="flex items-center justify-end gap-2 border-t border-border bg-bg/60 p-3">
            {!lessonComplete && (
              <>
                <button
                  type="button"
                  onClick={() => setWall({ open: true, reason: "save" })}
                  className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-elevated hover:text-ink"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validation?.passed) {
                      setLessonComplete(true);
                    }
                  }}
                  disabled={!validation?.passed || scriptedActive}
                  className="rounded-md bg-gradient-to-r from-accent to-violet px-4 py-1.5 text-[12px] font-bold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Check my work ✓
                </button>
              </>
            )}
          </div>

          {/* Phase 27-v2 Day 3c — anon lesson-complete celebration.
              Renders BELOW the bottom CTA row (which is empty after
              completion). Confetti-adjacent ring pulse + "Lesson 1
              complete!" header + a personalized praise line + Sign
              Up CTA that carries the stash to lesson 2. The CTA
              click writes sessionStorage with the user's code, name,
              and the orientation flags that already fired (cinematic
              + scripted walkthrough); the wall opens with reason
              "next-lesson" so the copy reads as continuation, not
              save. */}
          {lessonComplete && lesson && (
            <div className="border-t border-border bg-gradient-to-br from-accent/10 via-violet/5 to-transparent p-6 text-center">
              <div className="text-[11px] font-bold uppercase tracking-widest text-accent">
                Lesson 1 complete
              </div>
              <h2 className="mt-1 font-display text-[28px] font-semibold leading-tight text-ink">
                {parsedName
                  ? `You did it, ${parsedName}.`
                  : "You wrote your first program."}
              </h2>
              <p className="mt-2 text-[14px] text-muted">
                Lesson 2 picks up right where you are. Sign up to keep going —
                your code and name come with you.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    writeAnonStash({
                      completedAt: new Date().toISOString(),
                      courseId: ANON_ALLOWED.courseId,
                      lessonId: ANON_ALLOWED.lessonId,
                      code,
                      name: parsedName,
                      // Day 2 + Day 3b actually shipped on anon —
                      // welcome/cinematic + scripted walkthrough.
                      // WorkspaceCoach hasn't shipped on anon yet
                      // (Day 6); record honestly so the handoff
                      // doesn't suppress a feature Maya never saw.
                      flags: {
                        welcomeDone: true,
                        workspaceCoachDone: false,
                      },
                    });
                    setWall({ open: true, reason: "next-lesson" });
                  }}
                  className="rounded-md bg-gradient-to-r from-accent to-violet px-5 py-2 text-[13px] font-bold text-bg shadow-md transition hover:opacity-90"
                >
                  Sign up to keep going →
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <SignupWallDialog
        open={wall.open}
        reason={wall.reason}
        onDismiss={() => setWall({ open: false, reason: wall.reason })}
      />
    </div>
  );
}

// Inline minimal markdown renderer — same vocabulary as
// LessonInstructionsPanel.MarkdownContent (headings, lists, code,
// inline `code`, **bold**). Kept local to this page to avoid coupling
// AnonLessonPage to LessonInstructionsPanel's many other props.
function AnonMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wide text-muted">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="mb-1 mt-4 text-[14px] font-bold text-ink">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("# ")) {
      // Demoted to h2 — the lesson title above is the page's only h1.
      elements.push(
        <h2 key={i} className="mb-2 mt-4 text-[15px] font-bold text-ink">
          {line.slice(2)}
        </h2>
      );
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="my-2 overflow-x-auto rounded-lg bg-elevated p-3 text-[12px]">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [line.slice(2)];
      while (
        i + 1 < lines.length &&
        (lines[i + 1]!.startsWith("- ") || lines[i + 1]!.startsWith("* "))
      ) {
        i++;
        items.push(lines[i]!.slice(2));
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="list-disc text-[13px]">{renderInline(item)}</li>
          ))}
        </ul>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [line.replace(/^\d+\.\s/, "")];
      while (i + 1 < lines.length && /^\d+\.\s/.test(lines[i + 1] ?? "")) {
        i++;
        items.push((lines[i] ?? "").replace(/^\d+\.\s/, ""));
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((item, j) => (
            <li key={j} className="text-[13px]">{renderInline(item)}</li>
          ))}
        </ol>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p key={i} className="text-[13px] leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }
  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-elevated px-1 py-0.5 text-[11px] text-accent">
          {part.slice(1, -1)}
        </code>
      );
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      return bp;
    });
  });
}
