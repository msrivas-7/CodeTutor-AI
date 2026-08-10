import { Children, Fragment, type ReactNode } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { useProjectStore } from "../state/projectStore";
import { linkifyRefs } from "../util/linkifyRefs";
import { HOUSE_EASE } from "./cinema/easing";
import type {
  Stuckness,
  TutorCitation,
  TutorAction,
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

const STREAMING_MARKER = "\uE000";

function StructuredTutorText({
  text,
  isStreamingTail,
  inline = false,
}: {
  text: string;
  isStreamingTail?: boolean;
  inline?: boolean;
}) {
  const order = useProjectStore((s) => s.order);
  const revealAt = useProjectStore((s) => s.revealAt);
  const source = isStreamingTail ? `${text}${STREAMING_MARKER}` : text;
  const renderChildren = (children: ReactNode) => Children.map(children, (child, index) => {
    if (typeof child !== "string") return child;
    const parts = child.split(STREAMING_MARKER);
    return parts.map((part, partIndex) => (
      <Fragment key={`${index}-${partIndex}`}>
        {linkifyRefs(part, order, revealAt)}
        {partIndex < parts.length - 1 && <StreamingCaret />}
      </Fragment>
    ));
  });
  const markdown = (
    <ReactMarkdown
      skipHtml
      unwrapDisallowed
      allowedElements={inline
        ? ["p", "strong", "em", "code", "br"]
        : ["p", "ul", "ol", "li", "strong", "em", "code", "br"]}
      components={{
        p: ({ children }) => inline
          ? <span>{renderChildren(children)}</span>
          : <p className="whitespace-pre-wrap break-words">{renderChildren(children)}</p>,
        ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
        li: ({ children }) => <li className="break-words">{renderChildren(children)}</li>,
        strong: ({ children }) => <strong className="font-semibold text-ink">{renderChildren(children)}</strong>,
        em: ({ children }) => <em className="italic text-ink/90">{renderChildren(children)}</em>,
        code: ({ children }) => (
          <code className="break-words rounded bg-bg/70 px-1 py-0.5 font-mono text-[0.92em] text-accent">
            {children}
          </code>
        ),
        br: () => <br />,
      }}
    >
      {source}
    </ReactMarkdown>
  );

  return inline
    ? <span className="text-xs leading-relaxed text-ink/90">{markdown}</span>
    : <div className="space-y-2 text-xs leading-relaxed text-ink/90">{markdown}</div>;
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
  socratic: "Try first",
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
  // Cinema Kit Continuity Pass — section arrival. Each section
  // (intent / explain / example / etc.) fades in from a 6 px lift
  // as it lands so the response feels assembled in real time, not
  // dumped. 180 ms with HOUSE_EASE matches the rest of the kit.
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: HOUSE_EASE }}
      className={`rounded-md border-l-2 ${t.border} bg-elevated/60 px-3 py-2 shadow-soft`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={`text-[10px] ${t.accent}`}>{t.icon}</span>
        <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${t.pill}`}>
          {label}
        </span>
      </div>
      <StructuredTutorText text={text} isStreamingTail={isStreamingTail} />
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: HOUSE_EASE }}
      className="rounded-md border-l-2 border-violet/50 bg-elevated/60 px-3 py-2 shadow-soft"
    >
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
              <StructuredTutorText text={s.body} inline />
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
    </motion.div>
  );
}

export function CheckQuestionsView({
  questions,
  onAsk,
  disabled,
  socratic,
}: {
  questions: string[];
  onAsk?: (q: string, action?: TutorAction) => void;
  disabled?: boolean;
  socratic?: boolean;
}) {
  const palette = socratic
    ? {
        border: "border-accent/50",
        surface: "bg-accent/5",
        text: "text-accent",
        pill: "bg-accent/10",
      }
    : {
        border: "border-success/50",
        surface: "bg-elevated/60",
        text: "text-success",
        pill: "bg-success/10",
      };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: HOUSE_EASE }}
      className={`rounded-md border-l-2 ${palette.border} ${palette.surface} px-3 py-2 shadow-soft`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`text-[10px] ${palette.text}`}>?</span>
        <span className={`rounded ${palette.pill} px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${palette.text}`}>
          {socratic ? "Your turn" : "Check these"}
        </span>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-ink/90">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2">
            <span className={`mt-[1px] shrink-0 ${palette.text}`}>•</span>
            {onAsk ? (
              <button
                onClick={() => onAsk(q)}
                disabled={disabled}
                className="flex-1 cursor-pointer rounded px-1 py-0 text-left transition hover:bg-success/10 hover:text-success disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-inherit"
                title="Ask this directly"
              >
                <StructuredTutorText text={q} inline />
              </button>
            ) : (
              <StructuredTutorText text={q} inline />
            )}
          </li>
        ))}
      </ul>
      {socratic && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          Answer in your own words below, and I’ll help you work out an approach.
        </p>
      )}
    </motion.div>
  );
}

export function ComprehensionCheckView({
  text,
  onCompose,
  disabled,
}: {
  text: string;
  onCompose?: (q: string) => void;
  disabled?: boolean;
}) {
  const body = <StructuredTutorText text={text} inline />;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: HOUSE_EASE }}
      className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 shadow-soft"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-accent">↻</span>
        <span className="rounded bg-accent/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-accent">
          Your turn
        </span>
      </div>
      {onCompose ? (
        <button
          onClick={() => onCompose("My answer: ")}
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
    </motion.div>
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
    s.conversationReply ||
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
  onCompose,
  disabled,
  streaming,
  scripted,
}: {
  sections: TutorSections;
  onAsk?: (q: string, action?: TutorAction) => void;
  onCompose?: (draft: string) => void;
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

  const conversationOnly =
    sections.conversationMove === "greeting" ||
    sections.conversationMove === "redirect" ||
    (
      sections.conversationMove === "soft-boundary" &&
      !sections.summary &&
      !sections.diagnose &&
      !sections.explain &&
      !sections.example &&
      !sections.walkthrough?.length &&
      !sections.checkQuestions?.length &&
      !sections.hint &&
      !sections.nextStep &&
      !sections.strongerHint &&
      !sections.pitfalls &&
      !sections.citations?.length &&
      !sections.comprehensionCheck
    );
  if (conversationOnly && sections.conversationReply) {
    return (
      <div className="py-1 text-[13px] leading-relaxed text-ink">
        <StructuredTutorText text={sections.conversationReply} />
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
      {sections.conversationReply && (
        <div className="text-[13px] leading-relaxed text-ink">
          <StructuredTutorText text={sections.conversationReply} />
        </div>
      )}
      {(sections.intent || sections.summary || sections.stuckness) && (
        <div className="flex flex-wrap items-start gap-2">
          <IntentBadge intent={sections.intent} />
          <StucknessBadge level={sections.stuckness} />
          {sections.summary && (
            <span className="flex-1 italic text-ink/80">
              <StructuredTutorText text={sections.summary} inline />
            </span>
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
          // A Socratic question is something the learner should answer in the
          // composer. Making it a clickable "ask this" chip would send the
          // tutor's own question back verbatim and create a confusing loop.
          onAsk={sections.intent === "socratic" ? undefined : onAsk}
          disabled={disabled}
          socratic={sections.intent === "socratic"}
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
          onCompose={onCompose}
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
