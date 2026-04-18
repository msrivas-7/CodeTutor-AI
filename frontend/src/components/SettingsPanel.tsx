import { useState } from "react";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import type { Persona } from "../types";
import { useThemePref, type ThemePref } from "../util/theme";

// Dev-only Developer tab. Both imports are guarded by import.meta.env.DEV
// so Vite tree-shakes the whole __dev__ folder in prod.
const DeveloperSection = import.meta.env.DEV
  ? (await import("../__dev__/DeveloperSection")).DeveloperSection
  : () => null;
const useDevModeEnabled = import.meta.env.DEV
  ? (await import("../__dev__/devModeStore")).useDevModeEnabled
  : () => false;

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
  const devEnabled = useDevModeEnabled();
  const [tab, setTab] = useState<"general" | "developer">("general");
  const activeTab = devEnabled ? tab : "general";

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

      {devEnabled && (
        <div role="tablist" aria-label="Settings sections" className="flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "general"}
            onClick={() => setTab("general")}
            className={`flex-1 px-2.5 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              activeTab === "general"
                ? "bg-accent text-bg"
                : "bg-elevated text-muted hover:bg-elevated/80 hover:text-ink"
            }`}
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "developer"}
            onClick={() => setTab("developer")}
            className={`flex-1 border-l border-border px-2.5 py-1.5 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet ${
              activeTab === "developer"
                ? "bg-violet text-bg"
                : "bg-elevated text-muted hover:bg-elevated/80 hover:text-violet"
            }`}
          >
            Developer
          </button>
        </div>
      )}

      {activeTab === "developer" ? (
        <DeveloperSection />
      ) : (
        <GeneralSettings />
      )}
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
                : "Check this API key with Anthropic"
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
            Stores the key in this browser's localStorage in plaintext. Fine for a personal machine; don't enable on a shared computer.
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
          {modelsStatus === "loaded" && (
            <select
              value={selectedModel ?? ""}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition hover:border-accent/60"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {modelsStatus === "loaded" && models.length === 0 && (
            <span className="text-[11px] text-muted">
              no chat-capable models available for this key
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted">Experience level</span>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(Object.keys(PERSONA_LABEL) as Persona[]).map((p, i) => {
            const active = persona === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPersona(p)}
                className={`flex-1 px-2.5 py-1.5 text-[11px] font-semibold transition ${
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
        <span className="text-[10px] leading-relaxed text-faint">
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
        <button
          onClick={forgetKey}
          className="self-start text-[11px] text-danger transition hover:text-danger/80"
        >
          forget key + clear conversation
        </button>
      )}
    </>;
  }
}
