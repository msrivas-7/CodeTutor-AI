import type { TokenUsage } from "../types";
import { estimateCost, formatCost, formatTokens } from "../util/pricing";

// Standing follow-up prompts that appear below the most recent tutor turn.
// They're a quick way for the learner to deepen an answer without re-typing.
const CHIPS: { label: string; prompt: string }[] = [
  {
    label: "still stuck",
    prompt: "I'm still stuck on this — can you give me a stronger hint?",
  },
  {
    label: "explain more",
    prompt: "Can you explain that in more detail?",
  },
  {
    label: "concrete example",
    prompt: "Can you show me a concrete example of that in my code?",
  },
  {
    label: "why it matters",
    prompt: "Why does this matter for what I'm trying to do?",
  },
];

export function ActionChips({
  onAsk,
  disabled,
}: {
  onAsk: (q: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHIPS.map((c) => (
        <button
          key={c.label}
          onClick={() => onAsk(c.prompt)}
          disabled={disabled}
          className="rounded-full border border-border bg-elevated/60 px-2 py-[2px] text-[10px] text-muted transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-elevated disabled:hover:text-muted"
          title={c.prompt}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function UsageChip({
  usage,
  modelId,
  size = "sm",
}: {
  usage: TokenUsage;
  modelId?: string | null;
  size?: "sm" | "xs";
}) {
  const total = usage.inputTokens + usage.outputTokens;
  const cost = modelId ? estimateCost(modelId, usage) : null;
  const title =
    cost !== null
      ? `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens · approx ${formatCost(cost)}`
      : `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens`;
  const textCls = size === "xs" ? "text-[9px]" : "text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-elevated/70 px-1.5 py-[1px] ${textCls} text-faint`}
      title={title}
    >
      <span className="font-mono">{formatTokens(total)}</span>
      <span className="text-muted">tokens</span>
      {cost !== null && (
        <>
          <span className="text-border">·</span>
          <span className="font-mono text-muted">~{formatCost(cost)}</span>
        </>
      )}
    </span>
  );
}

export function ThinkingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border-l-2 border-accent/30 bg-elevated/40 px-3 py-2">
        <div className="mb-2 h-3 w-24 skeleton" />
        <div className="mb-1 h-2.5 w-full skeleton" />
        <div className="mb-1 h-2.5 w-11/12 skeleton" />
        <div className="h-2.5 w-3/4 skeleton" />
      </div>
      <div className="rounded-md border-l-2 border-success/30 bg-elevated/40 px-3 py-2">
        <div className="mb-2 h-3 w-28 skeleton" />
        <div className="mb-1 h-2.5 w-5/6 skeleton" />
        <div className="h-2.5 w-2/3 skeleton" />
      </div>
    </div>
  );
}

export function AskErrorView({
  message,
  onRetry,
  retryDisabled,
}: {
  message: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const { kind, title, hint } = classifyAskError(message);
  const canRetry = onRetry && kind !== "auth";
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span aria-hidden="true" className="text-danger">!</span>
        <span className="rounded bg-danger/20 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-danger">
          {title}
        </span>
      </div>
      {hint && <div className="mb-1.5 text-ink/90">{hint}</div>}
      <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
        {message}
      </div>
      {canRetry && (
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/15 px-2 py-1 text-[11px] font-semibold text-danger transition hover:bg-danger/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Retry the last question"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Try again
        </button>
      )}
    </div>
  );
}

function classifyAskError(raw: string): { kind: string; title: string; hint?: string } {
  const m = raw.toLowerCase();
  if (m.includes("insufficient_quota") || m.includes("exceeded your current quota") || m.includes("billing")) {
    return { kind: "quota", title: "OpenAI quota exceeded", hint: "Your API key has no remaining credits. Check billing on the OpenAI dashboard, then try again." };
  }
  if (m.includes("rate limit") || m.includes("rate_limit") || m.includes(" 429")) {
    return { kind: "rateLimit", title: "Rate limited", hint: "OpenAI is throttling requests. Wait a few seconds and try again." };
  }
  if (m.includes("incorrect api key") || m.includes("invalid_api_key") || m.includes(" 401")) {
    return { kind: "auth", title: "Key rejected", hint: "The API key is no longer valid. Open Settings and validate a fresh key." };
  }
  return { kind: "generic", title: "Request failed" };
}
