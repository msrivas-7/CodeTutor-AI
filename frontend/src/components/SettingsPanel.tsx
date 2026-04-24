import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAIStore } from "../state/aiStore";
import { usePreferencesStore } from "../state/preferencesStore";
import { useAuthStore } from "../auth/authStore";
import type { Persona } from "../types";
import { useThemePref, type ThemePref } from "../util/theme";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { PaidAccessInterestButton } from "./PaidAccessInterestButton";
import { useAIStatus } from "../state/useAIStatus";

type Tab = "account" | "ai" | "appearance" | "data";

const TAB_LABEL: Record<Tab, string> = {
  account: "Account",
  ai: "AI",
  appearance: "Appearance",
  data: "Data",
};

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
  const [tab, setTab] = useState<Tab>("account");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Settings
        </span>
        {onClose && (
          <button
            className="rounded px-2 py-0.5 text-[11px] text-muted transition hover:bg-elevated hover:text-ink"
            onClick={onClose}
          >
            close
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <nav
          aria-label="Settings sections"
          className="flex w-28 shrink-0 flex-col gap-0.5"
        >
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-current={active ? "page" : undefined}
                className={`rounded px-2 py-1.5 text-left text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active
                    ? "bg-elevated text-ink"
                    : "text-muted hover:bg-elevated/60 hover:text-ink"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {tab === "account" && <AccountTab onClose={onClose} />}
          {tab === "ai" && <AITab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "data" && <DataTab />}
        </div>
      </div>
    </div>
  );
}

function AccountTab({ onClose }: { onClose?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);
  const signOut = useAuthStore((s) => s.signOut);
  const patchPreferences = usePreferencesStore((s) => s.patch);
  const nav = useNavigate();

  const meta = (user?.user_metadata ?? {}) as {
    first_name?: string;
    last_name?: string;
  };
  const [firstName, setFirstName] = useState(meta.first_name ?? "");
  const [lastName, setLastName] = useState(meta.last_name ?? "");
  // Re-sync local inputs when auth pushes a fresh user object (USER_UPDATED
  // after save, or a token refresh carrying newer metadata). The effect is
  // idempotent for same-value updates so it won't stomp mid-edit state.
  useEffect(() => {
    setFirstName(meta.first_name ?? "");
    setLastName(meta.last_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.first_name, meta.last_name]);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayErr, setReplayErr] = useState<string | null>(null);

  // Auto-dismiss the save status after ~2.5s. Using a timer (not CSS) so the
  // message can also be cleared early on next save. The effect's cleanup
  // covers unmount + re-run ordering so only the latest timer fires.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!saveMsg) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSaveMsg(null), 2500);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [saveMsg]);

  const firstTrim = firstName.trim();
  const lastTrim = lastName.trim();
  const dirty =
    firstTrim !== (meta.first_name ?? "").trim() ||
    lastTrim !== (meta.last_name ?? "").trim();
  const canSave =
    !saving &&
    dirty &&
    firstTrim.length > 0 &&
    firstTrim.length <= 50 &&
    lastTrim.length > 0 &&
    lastTrim.length <= 50;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateDisplayName(firstTrim, lastTrim);
      setSaveMsg({ kind: "saved", text: "Changes saved" });
    } catch (e) {
      setSaveMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleReplayIntro = async () => {
    // Ordering matters here. StartPage now contains a synchronous
    // `<Navigate to="/welcome">` that fires the instant welcomeDone
    // flips to false (optimistic update from patchPreferences). If
    // we awaited the patch first while on StartPage, that Navigate
    // would unmount StartPage — and the SettingsModal mounted
    // inside it — mid-handler, leaving framer-motion + this handler
    // in an inconsistent state (user saw the page freeze until
    // reload). Fix: close the modal and nav to /welcome FIRST,
    // THEN await the patch. Once we're on /welcome the rogue
    // Navigate can't fire (StartPage is unmounted) and we can
    // safely await server confirmation — which the e2e spec needs
    // so a reload after "Show intro again" finds welcomeDone=false
    // persisted server-side.
    setReplayErr(null);
    setReplaying(true);
    onClose?.();
    nav("/welcome");
    try {
      await patchPreferences({
        welcomeDone: false,
        workspaceCoachDone: false,
        editorCoachDone: false,
      });
    } catch (e) {
      // Can't surface the error — we already navigated. Log and
      // move on; the cinematic still plays from the already-
      // mounted /welcome route.
      console.error(
        "[settings] replay-intro patch failed:",
        (e as Error).message,
      );
    } finally {
      // setState on an unmounted component is a no-op in React 18,
      // but keep the reset for embedded-outside-modal callers.
      setReplaying(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutErr(null);
    setSigningOut(true);
    try {
      await signOut();
      onClose?.();
      nav("/login", { replace: true });
    } catch (e) {
      setSignOutErr((e as Error).message);
      setSigningOut(false);
    }
  };

  if (!user) return null;
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Profile</h3>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted">Email</span>
          <span className="break-all rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink/80">
            {user.email ?? user.id}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted">First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Ada"
              autoComplete="given-name"
              maxLength={50}
              disabled={saving}
              className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted">Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Lovelace"
              autoComplete="family-name"
              maxLength={50}
              disabled={saving}
              className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-ink transition placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            aria-busy={saving}
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && (
            <span
              role={saveMsg.kind === "error" ? "alert" : "status"}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                saveMsg.kind === "saved"
                  ? "bg-success/15 text-success"
                  : "bg-danger/15 text-danger"
              }`}
            >
              {saveMsg.kind === "saved" ? `✓ ${saveMsg.text}` : saveMsg.text}
            </span>
          )}
        </div>
      </section>

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Session</h3>
        {signOutErr && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
          >
            {signOutErr}
          </div>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-busy={signingOut}
          className="self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Guided tour</h3>
        {replayErr && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
          >
            {replayErr}
          </div>
        )}
        <button
          type="button"
          onClick={handleReplayIntro}
          disabled={replaying}
          aria-busy={replaying}
          className="self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {replaying ? "Resetting…" : "Show intro again"}
        </button>
        <p className="text-[10px] leading-relaxed text-faint">
          Replay the welcome message and the workspace and editor tips.
        </p>
      </section>

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Danger zone</h3>
        <button
          type="button"
          onClick={() => setShowDelete(true)}
          className="self-start rounded-md border border-danger/40 bg-elevated px-3 py-1 text-[11px] font-semibold text-danger transition hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Delete account
        </button>
        <p className="text-[10px] leading-relaxed text-faint">
          Permanently removes your account, progress, saved projects, and
          encrypted OpenAI key. This cannot be undone.
        </p>
      </section>
      {showDelete && (
        <DeleteAccountModal onClose={() => setShowDelete(false)} />
      )}
    </>
  );
}

function DataTab() {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const handleDownloadData = async () => {
    setExportErr(null);
    setExporting(true);
    try {
      await api.downloadUserExport();
    } catch (e) {
      setExportErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Export</h3>
      {exportErr && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          {exportErr}
        </div>
      )}
      <button
        type="button"
        onClick={handleDownloadData}
        disabled={exporting}
        aria-busy={exporting}
        className="self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {exporting ? "Preparing…" : "Download my data"}
      </button>
      <p className="text-[10px] leading-relaxed text-faint">
        A JSON file with your preferences, progress, saved projects, AI
        usage history, and feedback. Your encrypted OpenAI key is not
        included.
      </p>
    </section>
  );
}

function AITab() {
  const {
    models,
    modelsStatus,
    modelsError,
    selectedModel,
    setModels,
    setModelsStatus,
    setSelectedModel,
    persona,
    setPersona,
    clearConversation,
  } = useAIStore();
  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const saveOpenaiKey = usePreferencesStore((s) => s.saveOpenaiKey);
  const forgetOpenaiKey = usePreferencesStore((s) => s.forgetOpenaiKey);

  // Phase 18e: the key lives on the server. The input here is a local draft
  // used only for the current "enter + validate + save" round-trip — it is
  // never persisted anywhere, and clears as soon as the save succeeds.
  type SaveStatus =
    | { kind: "idle" }
    | { kind: "validating" }
    | { kind: "saved" }
    | { kind: "invalid"; error: string };
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  // Load the available models as soon as we know the user has a key on file
  // (or has just saved one). `listOpenAIModels` pulls the key from the DB
  // server-side, so the client only needs the userId the auth header carries.
  useEffect(() => {
    if (!hasKey) return;
    if (modelsStatus !== "idle") return;
    setModelsStatus("loading");
    api
      .listOpenAIModels()
      .then(({ models: fetched }) => {
        setModels(fetched);
        setModelsStatus("loaded");
      })
      .catch((err) => setModelsStatus("error", (err as Error).message));
  }, [hasKey, modelsStatus, setModels, setModelsStatus]);

  const handleSave = async () => {
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
      setStatus({ kind: "saved" });
      // Force a fresh model listing with the new key.
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

  const handleForget = async () => {
    try {
      await forgetOpenaiKey();
    } catch {
      /* rollback handled in store */
    }
    clearConversation();
    setConfirmForget(false);
    setStatus({ kind: "idle" });
    setModels([]);
    setModelsStatus("idle");
    setSelectedModel(null);
  };

  const statusBlurb = () => {
    if (status.kind === "validating") {
      return (
        <span className="flex items-center gap-1.5 text-warn">
          <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-warn" />
          validating…
        </span>
      );
    }
    if (status.kind === "saved") return <span className="text-success">● saved</span>;
    if (status.kind === "invalid") return <span className="text-danger">× {status.error}</span>;
    if (hasKey) return <span className="text-success">● key saved</span>;
    return <span className="text-faint">no key saved</span>;
  };

  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">OpenAI key</h3>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted">API Key</span>
          <div className="flex items-center gap-2">
            <input
              type={reveal ? "text" : "password"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (status.kind !== "idle") setStatus({ kind: "idle" });
              }}
              placeholder={hasKey ? "enter a new key to replace" : "sk-…"}
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
            onClick={handleSave}
            disabled={!draft.trim() || status.kind === "validating"}
            title={
              !draft.trim()
                ? "Enter an API key first"
                : status.kind === "validating"
                  ? "Validating… please wait"
                  : "Validate this key with OpenAI and save it"
            }
            aria-label={
              !draft.trim()
                ? "Save API key (enter a key first)"
                : status.kind === "validating"
                  ? "Validating API key"
                  : "Validate and save API key"
            }
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
          >
            Save
          </button>
          <div className="text-[11px]">{statusBlurb()}</div>
        </div>

        <p className="text-[10px] leading-relaxed text-faint">
          Stored encrypted on our server and decrypted only when forwarding
          requests to OpenAI.
        </p>

        {hasKey && (
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

        {hasKey && (
          confirmForget ? (
            <div className="flex flex-col gap-1.5 self-start rounded-md border border-danger/40 bg-danger/5 p-2">
              <span className="text-[11px] text-danger">
                This also clears your tutor chat — continue?
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleForget}
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
      </section>

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Tutor style</h3>
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
      </section>

      <hr className="border-border" />

      <PaidInterestSection />
    </>
  );
}

// Round 5: Settings is the one surface that always shows the paid-interest
// state, regardless of hasShownPaidInterest. Before click → the CTA.
// After click → "Interest recorded" + a Remove link that deletes the row
// and re-opens the door on every other surface. Contextual surfaces
// (ExhaustionCard, TutorSetupWarning) still hide-after-click; this is the
// user's recovery path.
function PaidInterestSection() {
  const { status, refetch } = useAIStatus();
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const hasShown = status?.hasShownPaidInterest === true;
  // Round 6: denylisted users can click — backend accepts the upsert and
  // flags the row with `denylisted_at_click=true` so the operator sees the
  // context when reviewing. A past abuser willing to pay is still a lead.

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await api.withdrawPaidAccessInterest();
      refetch();
    } catch (err) {
      setWithdrawError((err as Error).message ?? "try again");
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Paid plan interest</h3>
      {hasShown ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-muted" role="status" aria-live="polite">
            <span className="text-success">●</span> Interest recorded. Clicked
            by mistake?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="self-start text-[11px] text-muted underline underline-offset-2 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {withdrawing ? "Removing…" : "Remove my interest"}
            </button>
            {withdrawError && (
              <span className="text-[11px] text-danger">× {withdrawError}</span>
            )}
          </div>
        </div>
      ) : (
        <PaidAccessInterestButton
          tone="neutral"
          leadIn="Interested in a managed paid plan? One click, no form — we'll log your interest."
        />
      )}
    </section>
  );
}

function AppearanceTab() {
  const [themePref, setThemePref] = useThemePref();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Theme</h3>
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
    </section>
  );
}
