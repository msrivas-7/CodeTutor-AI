import { useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import type { Persona } from "../types";
import { useThemePref, type ThemePref } from "../util/theme";

const THEME_LABEL: Record<ThemePref, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const PERSONA_LABEL: Record<Persona, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const PERSONA_BLURB: Record<Persona, string> = {
  beginner: "Assumes little prior knowledge; prefers plain words and concrete examples.",
  intermediate: "Uses standard vocabulary without defining it; explains the why.",
  advanced: "Dense and technical; skips basics, short explanations.",
};

export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const {
    apiKey,
    keyStatus,
    keyError,
    models,
    modelsStatus,
    modelsError,
    selectedModel,
    remember,
    setApiKey,
    setKeyStatus,
    setModels,
    setModelsStatus,
    setSelectedModel,
    setRemember,
    forgetKey,
    persona,
    setPersona,
  } = useAIStore();

  const [reveal, setReveal] = useState(false);
  const [themePref, setThemePref] = useThemePref();
  // Two-step confirm for Remove API key — clears both the key and the tutor
  // chat, so a single click shouldn't wipe an in-progress conversation.
  const [confirmForget, setConfirmForget] = useState(false);

  const handleValidate = async () => {
    if (!apiKey.trim()) return;
    setKeyStatus("validating");
    try {
      const result = await api.validateOpenAIKey(apiKey.trim());
      if (!result.valid) {
        setKeyStatus("invalid", result.error ?? "invalid key");
        return;
      }
      setKeyStatus("valid");
      setModelsStatus("loading");
      try {
        const { models: fetched } = await api.listOpenAIModels(apiKey.trim());
        setModels(fetched);
        setModelsStatus("loaded");
      } catch (err) {
        setModelsStatus("error", (err as Error).message);
      }
    } catch (err) {
      setKeyStatus("invalid", (err as Error).message);
    }
  };

  const statusBlurb = () => {
    switch (keyStatus) {
      case "none":
        return <span className="text-faint">not validated</span>;
      case "validating":
        return (
          <span className="flex items-center gap-1.5 text-warn">
            <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-warn" />
            validating…
          </span>
        );
      case "valid":
        return <span className="text-success">● valid</span>;
      case "invalid":
        return <span className="text-danger">× {keyError}</span>;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Settings
          </span>
        </div>
        {onClose && (
          <button
            className="rounded px-2 py-0.5 text-[11px] text-muted transition hover:bg-elevated hover:text-ink"
            onClick={onClose}
          >
            close
          </button>
        )}
      </div>

      <GeneralSettings />
    </div>
  );

  function GeneralSettings() {
    return <>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted">OpenAI API Key</span>
        <div className="flex items-center gap-2">
          <input
            type={reveal ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            className="flex-1 rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-xs text-ink transition placeholder:text-faint focus:border-accent/60"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="flex items-center justify-center rounded-md border border-border bg-elevated p-1.5 text-muted transition hover:border-accent/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={reveal ? "Hide API key" : "Show API key"}
            aria-label={reveal ? "Hide API key" : "Show API key"}
            aria-pressed={reveal}
          >
            {reveal ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </label>

      <div className="flex items-center gap-2">
        <button
          onClick={handleValidate}
          disabled={!apiKey.trim() || keyStatus === "validating"}
          title={
            !apiKey.trim()
              ? "Enter an API key first"
              : keyStatus === "validating"
                ? "Validating… please wait"
                : "Check this API key with OpenAI"
          }
          aria-label={
            !apiKey.trim()
              ? "Validate API key (enter a key first)"
              : keyStatus === "validating"
                ? "Validating API key"
                : "Validate API key"
          }
          className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          Validate
        </button>
        <div className="text-[11px]">{statusBlurb()}</div>
      </div>

      <label className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 p-2.5">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="mt-0.5 accent-warn"
        />
        <div className="text-[11px] leading-relaxed">
          <div className="font-semibold text-warn">Remember on this device</div>
          <div className="text-warn/70">
            Saved on this computer only — don't enable on a shared machine.
          </div>
        </div>
      </label>

      {keyStatus === "valid" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted">Model</span>
          {modelsStatus === "loading" && (
            <span className="flex items-center gap-1.5 text-[11px] text-warn">
              <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-warn" />
              loading models…
            </span>
          )}
          {modelsStatus === "error" && (
            <span className="text-[11px] text-danger">failed: {modelsError}</span>
          )}
          {modelsStatus === "loaded" && models.length > 0 && (
            <div className="relative">
              <select
                value={selectedModel ?? ""}
                onChange={(e) => setSelectedModel(e.target.value)}
                aria-label="Model"
                className="w-full appearance-none rounded-md border border-border bg-elevated px-2.5 py-1.5 pr-7 text-xs text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                ▾
              </span>
            </div>
          )}
          {modelsStatus === "loaded" && models.length === 0 && (
            <span className="text-[11px] text-muted">
              This key doesn't have access to any chat models — check your OpenAI plan.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span id="persona-label" className="text-[11px] font-medium text-muted">
          Experience level
        </span>
        <div
          role="radiogroup"
          aria-labelledby="persona-label"
          aria-describedby="persona-blurb"
          className="flex overflow-hidden rounded-md border border-border"
        >
          {(Object.keys(PERSONA_LABEL) as Persona[]).map((p, i) => {
            const active = persona === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPersona(p)}
                className={`flex-1 px-2.5 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  active
                    ? "bg-accent text-bg"
                    : "bg-elevated text-muted hover:bg-elevated/80 hover:text-ink"
                } ${i > 0 ? "border-l border-border" : ""}`}
              >
                {PERSONA_LABEL[p]}
              </button>
            );
          })}
        </div>
        <span id="persona-blurb" className="text-[10px] leading-relaxed text-faint">
          {PERSONA_BLURB[persona]}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted">Theme</span>
        <div role="group" aria-label="Theme preference" className="flex overflow-hidden rounded-md border border-border">
          {(Object.keys(THEME_LABEL) as ThemePref[]).map((t, i) => {
            const active = themePref === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setThemePref(t)}
                aria-pressed={active}
                className={`flex-1 px-2.5 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  active
                    ? "bg-accent text-bg"
                    : "bg-elevated text-muted hover:bg-elevated/80 hover:text-ink"
                } ${i > 0 ? "border-l border-border" : ""}`}
              >
                {THEME_LABEL[t]}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] leading-relaxed text-faint">
          {themePref === "system"
            ? "Follows your operating system's appearance setting."
            : themePref === "light"
              ? "Always use the light theme."
              : "Always use the dark theme."}
        </span>
      </div>

      {apiKey && (
        confirmForget ? (
          <div className="flex flex-col gap-1.5 self-start rounded-md border border-danger/40 bg-danger/5 p-2">
            <span className="text-[11px] text-danger">
              This also clears your tutor chat — continue?
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { forgetKey(); setConfirmForget(false); }}
                className="rounded-md bg-danger px-2.5 py-1 text-[11px] font-semibold text-bg transition hover:bg-danger/80"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmForget(false)}
                className="rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] text-muted transition hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmForget(true)}
            className="self-start text-[11px] text-danger transition hover:text-danger/80"
          >
            Remove API key
          </button>
        )
      )}
    </>;
  }
}

