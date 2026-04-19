import { useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";

interface TutorSetupWarningProps {
  onOpenSettings?: () => void;
}

// Inline-first API key setup. Configuring the tutor shouldn't require
// punching out to the Settings modal — the key is the single blocker, so
// we accept and validate it right here. For secondary preferences
// (persona/theme/forget) we still link to Settings.
export function TutorSetupWarning({ onOpenSettings }: TutorSetupWarningProps) {
  const {
    apiKey,
    keyStatus,
    keyError,
    remember,
    setApiKey,
    setKeyStatus,
    setModels,
    setModelsStatus,
    setRemember,
  } = useAIStore();

  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const validating = keyStatus === "validating";

  const handleValidate = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    setKeyStatus("validating");
    try {
      const result = await api.validateOpenAIKey(trimmed);
      if (!result.valid) {
        setKeyStatus("invalid", result.error ?? "invalid key");
        return;
      }
      setKeyStatus("valid");
      setModelsStatus("loading");
      try {
        const { models: fetched } = await api.listOpenAIModels(trimmed);
        setModels(fetched);
        setModelsStatus("loaded");
      } catch (err) {
        setModelsStatus("error", (err as Error).message);
      }
    } catch (err) {
      setKeyStatus("invalid", (err as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleValidate();
    }
  };

  // If the user already has an invalid/valid key saved in the store, prefer
  // that as the starting value so they don't have to re-paste to retry.
  const inputValue = draft || (keyStatus === "invalid" ? apiKey : "");

  return (
    <div className="rounded-md border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
      <div className="mb-1 font-semibold">Let's connect your AI tutor</div>
      <p className="text-warn/90">
        Paste your OpenAI API key to unlock hints, code explanations, and
        lesson-aware guidance.
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <input
          type={reveal ? "text" : "password"}
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="sk-…"
          aria-label="OpenAI API key"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-md border border-warn/30 bg-bg/60 px-2 py-1 font-mono text-[11px] text-ink transition placeholder:text-warn/40 focus:border-warn/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="rounded-md border border-warn/30 bg-bg/40 px-1.5 py-1 text-warn/80 transition hover:bg-bg/70"
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
          onClick={handleValidate}
          disabled={!inputValue.trim() || validating}
          className="rounded-md bg-warn px-2.5 py-1 text-[11px] font-semibold text-bg transition hover:bg-warn/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {validating ? "Checking…" : "Connect"}
        </button>
      </div>

      {keyStatus === "invalid" && keyError && (
        <p className="mt-1.5 text-[11px] text-danger">× {keyError}</p>
      )}

      <label className="mt-2 flex items-center gap-1.5 text-[11px] text-warn/80">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="accent-warn"
        />
        <span>Remember on this device (saved on this computer only)</span>
      </label>

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="mt-2 text-[11px] text-warn/80 underline underline-offset-2 transition hover:text-warn focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"
        >
          More settings →
        </button>
      )}
    </div>
  );
}
