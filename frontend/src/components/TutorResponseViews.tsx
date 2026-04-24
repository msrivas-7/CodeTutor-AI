import { useProjectStore } from "../state/projectStore";
import { linkifyRefs } from "../util/linkifyRefs";
import type {
  Stuckness,
  TutorCitation,
  TutorIntent,
  TutorSections,
  TutorWalkStep,
} from "../types";

// Typewriter caret. Rendered at the end of the currently-streaming
// section's text so the learner sees "the tutor is still typing" without
// us faking the stream rate. Earlier iteration (per-word fade-in) failed
// because real stream speed puts dozens of words inside one animation
// window — everything fades in simultaneously and the rhythm is lost.
// A single blinking caret matches the mental model users already have
// for "AI is typing" and doesn't lie about cadence.
function StreamingCaret() {
  return (
    <span
      className="ml-[1px] inline-block h-[1em] w-[2px] -translate-y-[2px] animate-blink bg-accent align-middle"
      aria-hidden="true"
    />
  );
}

export type Tone =
  | "think"
  | "check"
  | "hint"
  | "step"
  | "stronger"
  | "explain"
  | "example"
  | "pitfall";

const TONE: Record<
  Tone,
  { border: string; accent: string; pill: string; icon: string }
> = {
  think: {
    border: "border-accent/50",
    accent: "text-accent",
    pill: "bg-accent/10 text-accent",
    icon: "◆",
  },
  check: {
    border: "border-success/50",
    accent: "text-success",
    pill: "bg-success/10 text-success",
    icon: "?",
  },
  hint: {
    border: "border-warn/50",
    accent: "text-warnInk",
    pill: "bg-warn/10 text-warnInk",
    icon: "✦",
  },
  step: {
    border: "border-violet/50",
    accent: "text-violet",
    pill: "bg-violet/10 text-violet",
    icon: "→",
  },
  stronger: {
    border: "border-danger/50",
    accent: "text-danger",
    pill: "bg-danger/10 text-danger",
    icon: "!",
  },
  explain: {
    border: "border-violet/50",
    accent: "text-violet",
    pill: "bg-violet/10 text-violet",
    icon: "◈",
  },
  example: {
    border: "border-accent/50",
    accent: "text-accent",
    pill: "bg-accent/10 text-accent",
    icon: "‹›",
  },
  pitfall: {
    border: "border-warn/50",
    accent: "text-warnInk",
    pill: "bg-warn/10 text-warnInk",
    icon: "⚠",
  },
};

const INTENT_LABEL: Record<TutorIntent, string> = {
  debug: "Debug",
  concept: "Concept",
  howto: "How-to",
  walkthrough: "Walkthrough",
  checkin: "Check-in",
};

export function SectionView({
  label,
  text,
  tone,
  isStreamingTail,
}: {
  label: string;
  text: string;
  tone: Tone;
  // True only for the section currently receiving stream deltas (the last
  // populated section in render order while streaming is in flight).
  // When true, a blinking caret renders after the text to signal "still
  // typing." All other sections — committed or pre-stream — render plain.
  isStreamingTail?: boolean;
}) {
  const t = TONE[tone];
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  return (
    <div
      className={`rounded-md border-l-2 ${t.border} bg-elevated/60 px-3 py-2 shadow-soft`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={`text-[10px] ${t.accent}`}>{t.icon}</span>
        <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${t.pill}`}>
          {label}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink/90">
        {linkifyRefs(text, order, revealAt)}
        {isStreamingTail && <StreamingCaret />}
      </div>
    </div>
  );
}

export function IntentBadge({ intent }: { intent?: TutorIntent | null }) {
  if (!intent) return null;
  return (
    <span className="rounded-full border border-border bg-elevated px-2 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-muted">
      {INTENT_LABEL[intent]}
    </span>
  );
}

const STUCKNESS_STYLE: Record<Stuckness, { label: string; cls: string }> = {
  low: {
    label: "Making progress",
    cls: "border-success/40 bg-success/10 text-success",
  },
  medium: {
    label: "Spinning",
    cls: "border-warn/40 bg-warn/10 text-warn",
  },
  high: {
    label: "Stuck — escalating",
    cls: "border-danger/40 bg-danger/10 text-danger",
  },
};

export function StucknessBadge({ level }: { level?: Stuckness | null }) {
  if (!level) return null;
  const s = STUCKNESS_STYLE[level];
  return (
    <span
      className={`rounded-full border px-2 py-[1px] text-[9px] font-semibold uppercase tracking-wider ${s.cls}`}
      title="The tutor's read on how stuck you are"
    >
      {s.label}
    </span>
  );
}

export function WalkthroughView({ steps }: { steps: TutorWalkStep[] }) {
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  return (
    <div className="rounded-md border-l-2 border-violet/50 bg-elevated/60 px-3 py-2 shadow-soft">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-violet">→</span>
        <span className="rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider bg-violet/10 text-violet">
          Walkthrough
        </span>
      </div>
      <ol className="space-y-1.5 text-xs leading-relaxed text-ink/90">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] shrink-0 font-mono text-[10px] text-faint">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <span className="whitespace-pre-wrap">
                {linkifyRefs(s.body, order, revealAt)}
              </span>
              {s.path && s.line != null && order.includes(s.path) && (
                <button
                  onClick={() => revealAt(s.path!, s.line!)}
                  className="ml-1.5 rounded bg-violet/10 px-1 py-0 font-mono text-[10px] text-violet transition hover:bg-violet/20"
                  title={`Jump to ${s.path}:${s.line}`}
                >
                  {s.path}:{s.line}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CheckQuestionsView({
  questions,
  onAsk,
  disabled,
}: {
  questions: string[];
  onAsk?: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border-l-2 border-success/50 bg-elevated/60 px-3 py-2 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-success">?</span>
        <span className="rounded bg-success/10 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-success">
          Check these
        </span>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-ink/90">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] shrink-0 text-success">•</span>
            {onAsk ? (
              <button
                onClick={() => onAsk(q)}
                disabled={disabled}
                className="flex-1 cursor-pointer rounded px-1 py-0 text-left transition hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-inherit"
                title="Ask this directly"
              >
                {q}
              </button>
            ) : (
              <span>{q}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComprehensionCheckView({
  text,
  onAsk,
  disabled,
}: {
  text: string;
  onAsk?: (q: string) => void;
  disabled?: boolean;
}) {
  const body = (
    <div className="text-xs leading-relaxed text-ink/90">{text}</div>
  );
  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-accent">↻</span>
        <span className="rounded bg-accent/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-accent">
          Your turn
        </span>
      </div>
      {onAsk ? (
        <button
          onClick={() => onAsk(`Answering your check: ${text}`)}
          disabled={disabled}
          className="w-full cursor-pointer rounded text-left transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          title="Answer this now — the tutor will guide you"
        >
          {body}
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-accent/80">
            tap to take a swing →
          </div>
        </button>
      ) : (
        body
      )}
    </div>
  );
}

export function CitationsStrip({ citations }: { citations: TutorCitation[] }) {
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  const valid = citations.filter((c) => order.includes(c.path));
  if (valid.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">
        Refs
      </span>
      {valid.map((c, i) => (
        <button
          key={i}
          onClick={() => revealAt(c.path, c.line, c.column ?? undefined)}
          className="rounded-full border border-border bg-elevated px-2 py-[1px] font-mono text-[10px] text-accent transition hover:border-accent/60 hover:bg-accent/10"
          title={c.reason}
        >
          {c.path}:{c.line}
          {c.column ? `:${c.column}` : ""}
        </button>
      ))}
    </div>
  );
}

export function hasTutorContent(s: TutorSections): boolean {
  return Boolean(
    s.summary ||
      s.diagnose ||
      s.explain ||
      s.example ||
      (s.walkthrough && s.walkthrough.length > 0) ||
      (s.checkQuestions && s.checkQuestions.length > 0) ||
      s.hint ||
      s.nextStep ||
      s.strongerHint ||
      s.pitfalls ||
      s.comprehensionCheck ||
      (s.citations && s.citations.length > 0),
  );
}

export function TutorResponseView({
  sections,
  onAsk,
  disabled,
  streaming,
  scripted,
}: {
  sections: TutorSections;
  onAsk?: (q: string) => void;
  disabled?: boolean;
  // When true, a blinking caret renders at the end of whichever prose
  // section is currently last-populated in render order (i.e. the one
  // OpenAI is actively streaming text into). Callers pass this for the
  // in-flight `pending` message only; committed messages render plain.
  streaming?: boolean;
  // First-run scripted turns (from useFirstRunChoreography) should
  // feel like a continuation of the /welcome cinematic's voice —
  // Fraunces, larger, more deliberate — not small italic summary
  // chrome. When true, the summary line is rendered as a hero
  // statement and the other sections are hidden (scripted turns
  // only populate `summary`). Blinking cursor trails while streaming.
  scripted?: boolean;
}) {
  if (!hasTutorContent(sections)) {
    return <div className="text-xs italic text-faint">(empty response)</div>;
  }

  // Scripted branch: dedicated hero rendering. We sidestep the
  // intent-badge / sections layout entirely — scripted messages only
  // fill `summary`, so there's nothing else to show. The cursor is
  // only added during `streaming` (pending state); committed history
  // messages just render the final prose in the same voice.
  if (scripted && sections.summary) {
    return (
      <div className="py-1">
        <p className="whitespace-pre-wrap font-display text-[15px] font-[500] leading-[1.4] tracking-[-0.015em] text-ink">
          {sections.summary}
          {streaming && (
            <span
              aria-hidden="true"
              className="ml-[2px] inline-block h-[0.9em] w-[2px] -translate-y-[1px] bg-accent align-middle animate-blink"
            />
          )}
        </p>
      </div>
    );
  }

  // Determine which section (if any) should host the caret — reverse of
  // the render order so later sections win. JSON streams top-to-bottom
  // so the latest-mounted section is the tail.
  const tailKey: string | null = streaming
    ? sections.pitfalls
      ? "pitfalls"
      : sections.strongerHint
        ? "strongerHint"
        : sections.nextStep
          ? "nextStep"
          : sections.hint
            ? "hint"
            : sections.example
              ? "example"
              : sections.explain
                ? "explain"
                : sections.diagnose
                  ? "diagnose"
                  : null
    : null;

  return (
    <div className="flex flex-col gap-2">
      {(sections.intent || sections.summary || sections.stuckness) && (
        <div className="flex flex-wrap items-start gap-2">
          <IntentBadge intent={sections.intent} />
          <StucknessBadge level={sections.stuckness} />
          {sections.summary && (
            <span className="flex-1 text-xs italic text-ink/80">{sections.summary}</span>
          )}
        </div>
      )}
      {sections.diagnose && (
        <SectionView
          label="What I think"
          text={sections.diagnose}
          tone="think"
          isStreamingTail={tailKey === "diagnose"}
        />
      )}
      {sections.explain && (
        <SectionView
          label="Explanation"
          text={sections.explain}
          tone="explain"
          isStreamingTail={tailKey === "explain"}
        />
      )}
      {sections.example && (
        <SectionView
          label="Example"
          text={sections.example}
          tone="example"
          isStreamingTail={tailKey === "example"}
        />
      )}
      {sections.walkthrough && sections.walkthrough.length > 0 && (
        <WalkthroughView steps={sections.walkthrough} />
      )}
      {sections.checkQuestions && sections.checkQuestions.length > 0 && (
        <CheckQuestionsView
          questions={sections.checkQuestions}
          onAsk={onAsk}
          disabled={disabled}
        />
      )}
      {sections.hint && (
        <SectionView
          label="Hint"
          text={sections.hint}
          tone="hint"
          isStreamingTail={tailKey === "hint"}
        />
      )}
      {sections.nextStep && (
        <SectionView
          label="Next step"
          text={sections.nextStep}
          tone="step"
          isStreamingTail={tailKey === "nextStep"}
        />
      )}
      {sections.strongerHint && (
        <SectionView
          label="Stronger hint"
          text={sections.strongerHint}
          tone="stronger"
          isStreamingTail={tailKey === "strongerHint"}
        />
      )}
      {sections.pitfalls && (
        <SectionView
          label="Pitfalls"
          text={sections.pitfalls}
          tone="pitfall"
          isStreamingTail={tailKey === "pitfalls"}
        />
      )}
      {sections.comprehensionCheck && (
        <ComprehensionCheckView
          text={sections.comprehensionCheck}
          onAsk={onAsk}
          disabled={disabled}
        />
      )}
      {sections.citations && sections.citations.length > 0 && (
        <CitationsStrip citations={sections.citations} />
      )}
    </div>
  );
}

// Re-export chrome widgets (chips, usage chip, skeleton, error view) so the
// existing `from "./TutorResponseViews"` import path stays intact. Actual
// implementations live in ./TutorResponseChrome for readability — this file
// used to be ~520 lines, and the chrome pieces are orthogonal to the
// section-rendering machinery above.
export { ActionChips, UsageChip, ThinkingSkeleton, AskErrorView } from "./TutorResponseChrome";
