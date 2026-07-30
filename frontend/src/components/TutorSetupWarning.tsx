import { useState } from "react";
import { api, type AIStatusNoneReason } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { PaidAccessInterestButton } from "./PaidAccessInterestButton";

interface TutorSetupWarningProps {
  onOpenSettings?: () => void;
  onDismiss?: () => void;
  // Phase 20-P4: when the server has told us why there's no tutor (free tier
  // paused, account denylisted, provider key dead), branch the headline copy.
  // Default behavior (no reason passed) renders the original "Connect your
  // AI tutor" flow — unchanged from the BYOK-only days.
  reason?: AIStatusNoneReason;
}

// One generic copy for every server-side "paused" reason — we intentionally
// don't leak which specific cap or flag fired, so callers can't probe our
// thresholds. Denylist gets its own copy because the remedy is the same
// (BYOK) but the subject differs.
function copyForReason(reason?: AIStatusNoneReason): {
  title: string;
  body: string;
} {
  switch (reason) {
    case "free_disabled":
    case "usd_cap_hit":
    case "provider_auth_failed":
    case "daily_usd_per_user_hit":
    case "lifetime_usd_per_user_hit":
      return {
        title: "Want to keep going?",
        body: "Add your own OpenAI key below. We encrypt it at rest and never store it in plaintext. OpenAI bills usage directly.",
      };
    case "denylisted":
      return {
        title: "Bring your own key to continue",
        body: "Add your OpenAI key below. We encrypt it at rest and never store it in plaintext. OpenAI bills you directly.",
      };
    case "free_exhausted":
    case "no_key":
    default:
      return {
        title: "Connect your tutor",
        body: "Your tutor reads your code and the current lesson. Bring your own OpenAI key — we encrypt it at rest, never store it in plaintext, and let you remove it any time.",
      };
  }
}

// Inline-first API key setup. Configuring the tutor shouldn't require
// punching out to the Settings modal — the key is the single blocker, so
// we accept, validate, and save it right here. For secondary preferences
// (persona/theme/forget) we still link to Settings.
//
// Phase 18e: the draft only ever lives in local component state. On Connect
// we validate with OpenAI, then PUT it to /api/user/openai-key where it is
// encrypted at rest. The plaintext never lands in a global store.
type ConnectStatus =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "invalid"; error: string };

export function TutorSetupWarning({ onOpenSettings, onDismiss, reason }: TutorSetupWarningProps) {
  const saveOpenaiKey = usePreferencesStore((s) => s.saveOpenaiKey);
  const { setModels, setModelsStatus } = useAIStore();

  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });
  const validating = status.kind === "validating";

  const { title, body } = copyForReason(reason);
  // Round 6: denylisted users see the paid-interest CTA again. A banned
  // account willing to pay is actually a strong lead; backend now flags the
  // row with `denylisted_at_click=true` so the operator can filter at review
  // time. Only `no_key` / undefined reason stays hidden — that's the first-
  // run onboarding path and a paid-plan ask would crowd out the "paste your
  // key" primary action.
  const showPaidInterest = reason !== undefined && reason !== "no_key";

  const handleConnect = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setStatus({ kind: "validating" });
    try {
      const result = await api.validateOpenAIKey(trimmed);
      if (!result.valid) {
        setStatus({ kind: "invalid", error: result.error ?? "invalid key" });
        return;
      }
      await saveOpenaiKey(trimmed);
      setDraft("");
      setStatus({ kind: "idle" });
      setModelsStatus("loading");
      try {
        const { models: fetched } = await api.listOpenAIModels();
        setModels(fetched);
        setModelsStatus("loaded");
      } catch (err) {
        setModelsStatus("error", (err as Error).message);
      }
    } catch (err) {
      setStatus({ kind: "invalid", error: (err as Error).message });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConnect();
    }
  };

  return (
    <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-base leading-relaxed text-warn sm:text-body">
      <div className="mb-1 font-semibold">{title}</div>
      <p className="text-warn/90">{body}</p>
      <p className="mt-2 text-sm text-warn/80">
        You'll need an API key from{" "}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition hover:text-warn"
        >
          platform.openai.com/api-keys
        </a>
        . OpenAI bills you directly — typical tutor usage is fractions of a
        cent per question.
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <input
          type={reveal ? "text" : "password"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
          onKeyDown={handleKeyDown}
          placeholder="sk-…"
          aria-label="OpenAI API key"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-warn/30 bg-bg/60 px-3 py-2 font-mono text-base text-ink transition placeholder:text-warn/40 focus:border-warn/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-warn/30 bg-bg/40 text-warn/80 transition hover:bg-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
          aria-label={reveal ? "Hide API key" : "Show API key"}
          aria-pressed={reveal}
          title={reveal ? "Hide" : "Show"}
        >
          {reveal ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        <button
          onClick={handleConnect}
          disabled={!draft.trim() || validating}
          className="min-h-11 shrink-0 rounded-lg bg-warn px-3 py-2 text-sm font-semibold text-bg transition hover:bg-warn/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn disabled:cursor-not-allowed disabled:opacity-50"
        >
          {validating ? "Checking…" : "Connect"}
        </button>
      </div>

      {status.kind === "invalid" && (
        <p className="mt-2 text-sm text-danger">× {status.error}</p>
      )}

      {showPaidInterest && (
        <div className="mt-2.5 border-t border-warn/20 pt-2">
          <PaidAccessInterestButton
            tone="warn"
            leadIn="Not ready to bring your own key? Let us know you'd use a paid plan — one click, no form."
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="min-h-11 rounded-lg px-3 py-2 text-sm text-warn/80 underline underline-offset-2 transition hover:bg-warn/10 hover:text-warn focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"
          >
            More settings →
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-auto min-h-11 rounded-lg px-3 py-2 text-sm text-warn/70 underline underline-offset-2 transition hover:bg-warn/10 hover:text-warn focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"
          >
            Explore without tutor
          </button>
        )}
      </div>
    </div>
  );
}
