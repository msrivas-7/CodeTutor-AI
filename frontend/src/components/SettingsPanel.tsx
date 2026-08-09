import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { HOUSE_EASE } from "./cinema/easing";
import { api, type OwnerShare } from "../api/client";
import { useAIStore } from "../state/aiStore";
import {
  setDisableStreaks,
  setEmailOptIn,
  useDisableStreaks,
  useEmailOptIn,
  usePreferencesStore,
} from "../state/preferencesStore";
import { useAuthStore } from "../auth/authStore";
import type { Persona } from "../types";
import { useThemePref, type ThemePref } from "../util/theme";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { useAIStatus } from "../state/useAIStatus";
import { locationReturnTarget } from "../auth/returnTarget";

// Phase 24A: tab structure simplified to three user-facing surfaces.
// "AI" → "Tutor" (the word a beginner uses when they think about this
// feature). "Appearance" + "Data" folded back into Profile and Account
// — single-control tabs were tab-budget waste.
//
// Phase 25: admin moved out of Settings entirely. Admin operators get a
// dedicated /admin route via the user-menu link. Settings now serves
// only end-user concerns.
type Tab = "profile" | "tutor" | "account";

const TAB_LABEL: Record<Tab, string> = {
  profile: "Profile",
  tutor: "Tutor",
  account: "Account",
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

// Persona blurbs in the tutor's first-person voice (matches scriptedTurns.ts).
const PERSONA_BLURB: Record<Persona, string> = {
  beginner:
    "I'll explain things from the ground up. No jargon without context, plain words, concrete examples.",
  intermediate:
    "I'll use the standard vocabulary as we go and focus on the why behind it, not the basics.",
  advanced:
    "Short and dense. I'll skip the foundations and go straight to the interesting part.",
};

export function SettingsPanel({
  onClose,
  onShareChanged,
}: {
  onClose?: () => void;
  onShareChanged?: (change: {
    courseId: string;
    lessonId: string;
    shared: boolean;
  }) => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const visibleTabs = Object.keys(TAB_LABEL) as Tab[];

  return (
    <div data-settings-surface className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Settings
        </span>
        {onClose && (
          <button
            className="rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-elevated hover:text-ink"
            onClick={onClose}
          >
            close
          </button>
        )}
      </div>

      <PaidInterestBanner onDismissed={() => activeTabRef.current?.focus()} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex w-full shrink-0 gap-0.5 sm:w-28 sm:flex-col"
        >
          {visibleTabs.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                ref={active ? activeTabRef : undefined}
                type="button"
                onClick={() => setTab(t)}
                aria-current={active ? "page" : undefined}
                className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none sm:text-left ${
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
          {/* Settings tab crossfade — 180 ms (HOUSE_EASE). `mode="wait"`
              ensures the previous tab fully exits before the next begins,
              avoiding overlap glitches. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: HOUSE_EASE }}
              className="flex min-w-0 flex-col gap-4"
            >
              {tab === "profile" && <ProfileTab onClose={onClose} />}
              {tab === "tutor" && <TutorTab />}
              {tab === "account" && (
                <AccountTab
                  onClose={onClose}
                  onShareChanged={onShareChanged}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// Phase 24A: paid-plan banner — single surface for both acquisition and
// recovery. Pre-click: "Interested?" CTA + dismiss × that hides the banner
// for the current signed-in browser session. Post-click: "Interest
// recorded. Clicked by mistake?" + Remove link.
//
// "For now" means this browser session, not one modal mount. Keying the
// sessionStorage entry by the authenticated user prevents one account's
// choice from suppressing the banner for a different account in the same
// tab. Storage failures stay non-fatal (private-mode Safari can reject it).
const PAID_INTEREST_DISMISS_KEY = "codetutor.paid-interest-dismissed";

function paidInterestDismissKey(userId: string): string {
  return `${PAID_INTEREST_DISMISS_KEY}:${userId}`;
}

function readPaidInterestDismissal(userId: string | null): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(paidInterestDismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

function writePaidInterestDismissal(userId: string | null, dismissed: boolean): void {
  if (!userId || typeof window === "undefined") return;
  try {
    const key = paidInterestDismissKey(userId);
    if (dismissed) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory state still respects dismissal for this mount.
  }
}

function PaidInterestBanner({ onDismissed }: { onDismissed?: () => void }) {
  const { status, refetch } = useAIStatus();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    readPaidInterestDismissal(userId),
  );

  useEffect(() => {
    setDismissed(readPaidInterestDismissal(userId));
  }, [userId]);

  const hasShown = status?.hasShownPaidInterest === true;
  if (!hasShown && dismissed) return null;

  const handleInterested = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitPaidAccessInterest();
      refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    setError(null);
    try {
      await api.withdrawPaidAccessInterest();
      refetch();
      // Reset dismissal so a user who removed by mistake immediately sees
      // the acquisition CTA again, no modal-reopen required.
      setDismissed(false);
      writePaidInterestDismissal(userId, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Paid plan interest"
      className={`flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:gap-3 ${
        hasShown ? "border-success/40 bg-success/10" : "border-accent/40 bg-accent/10"
      }`}
    >
      {hasShown ? (
        <>
          <span className="text-[11px] text-ink" role="status" aria-live="polite">
            <span className="text-success">●</span> Interest recorded. Clicked by mistake?
          </span>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="text-[11px] text-muted underline underline-offset-2 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {withdrawing ? "Removing…" : "Remove my interest"}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-[11px] text-ink">
            Interested in a managed paid plan? One click — no form.
          </span>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              onClick={handleInterested}
              disabled={submitting}
              className="min-h-11 flex-1 rounded-md border border-accent/60 bg-accent/20 px-2.5 py-2 text-[11px] font-semibold text-ink transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            >
              {submitting ? "Sending…" : "Register interest in a paid plan"}
            </button>
            <button
              type="button"
              onClick={() => {
                // Move focus to a stable control before this focused button is
                // removed. Deferring by one frame can race React's commit and
                // leave focus on the document body in slower browsers.
                onDismissed?.();
                setDismissed(true);
                writePaidInterestDismissal(userId, true);
              }}
              aria-label="Dismiss for now"
              className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ×
            </button>
          </div>
        </>
      )}
      {error && (
        <span role="alert" className="text-[11px] text-danger">
          × {error}
        </span>
      )}
    </div>
  );
}

function ProfileTab({ onClose }: { onClose?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);
  const signOut = useAuthStore((s) => s.signOut);
  const nav = useNavigate();

  // Phase 22B: lastName is dropped from signup but editable here.
  const meta = (user?.user_metadata ?? {}) as {
    first_name?: string;
    last_name?: string;
  };
  const [firstName, setFirstName] = useState(meta.first_name ?? "");
  const [lastName, setLastName] = useState(meta.last_name ?? "");
  // Re-sync local inputs when auth pushes a fresh user object (USER_UPDATED
  // after save, or a token refresh carrying newer metadata).
  useEffect(() => {
    setFirstName(meta.first_name ?? "");
    setLastName(meta.last_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.first_name, meta.last_name]);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutErr, setSignOutErr] = useState<string | null>(null);

  // Auto-dismiss the save status after ~2.5s. Using a timer (not CSS) so the
  // message can also be cleared early on next save.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!saveMsg) return;
    // Success is a lightweight confirmation; errors need to remain visible
    // long enough to read and act on, especially on slower connections.
    if (saveMsg.kind === "error") return;
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
  // firstName is required (length>0). lastName is optional.
  const canSave =
    !saving &&
    dirty &&
    firstTrim.length > 0 &&
    firstTrim.length <= 50 &&
    lastTrim.length <= 50;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateDisplayName(firstTrim, lastTrim.length > 0 ? lastTrim : undefined);
      setSaveMsg({ kind: "saved", text: "Changes saved" });
    } catch (e) {
      setSaveMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
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
            <span className="text-[11px] font-medium text-muted">
              Last name <span className="text-faint">(optional)</span>
            </span>
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

      <ThemeSection />

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
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
          className="self-start rounded-md px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </>
  );
}

function ThemeSection() {
  const [themePref, setThemePref] = useThemePref();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Theme</h3>
      <div
        role="group"
        aria-label="Theme preference"
        className="flex overflow-hidden rounded-md border border-border"
      >
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

function TutorTab() {
  return (
    <>
      <BYOKStatusCard />
      <hr className="border-border" />
      <PersonaSection />
    </>
  );
}

// Phase 24A: BYOK promoted from a bare input to a status card. The first
// thing a brand-new user sees on this tab answers their actual question:
// "is the tutor going to work for me?" Empty state surfaces a clear
// "Get a key from OpenAI →" CTA and the cost reassurance line — connected
// state collapses the input behind a "Replace key" disclosure so the
// connected user is not invited to fiddle.
function BYOKStatusCard() {
  const {
    models,
    modelsStatus,
    modelsError,
    selectedModel,
    setModels,
    setModelsStatus,
    setSelectedModel,
    clearConversation,
  } = useAIStore();
  const hasKey = usePreferencesStore((s) => s.hasOpenaiKey);
  const saveOpenaiKey = usePreferencesStore((s) => s.saveOpenaiKey);
  const forgetOpenaiKey = usePreferencesStore((s) => s.forgetOpenaiKey);

  type SaveStatus =
    | { kind: "idle" }
    | { kind: "validating" }
    | { kind: "saved" }
    | { kind: "invalid"; error: string };
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [showReplace, setShowReplace] = useState(false);

  // Auto-clear the transient "saved" indicator after 5s. Long enough for
  // a glance + screenshot timing in tests; short enough to not feel stuck.
  // Validating and invalid states stay until the user types again
  // (handled by the input's onChange below).
  useEffect(() => {
    if (status.kind !== "saved") return;
    const t = window.setTimeout(() => setStatus({ kind: "idle" }), 5000);
    return () => window.clearTimeout(t);
  }, [status.kind]);

  // Load the available models when a key is on file. `listOpenAIModels`
  // pulls the key from the DB server-side; the client only needs auth.
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
      setShowReplace(false);
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

  // Status badge — separate from the validating/error transient states so
  // the header always reflects "is there a saved key" not "is there a draft
  // mid-validation". Connected → green; not yet → amber.
  const statusBadge = hasKey ? (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      Connected
    </span>
  ) : (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-semibold text-warn"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-warn" />
      Not set up yet
    </span>
  );

  const showInputForm = !hasKey || showReplace;

  return (
    <section
      aria-label="Tutor connection"
      className="flex flex-col gap-3 rounded-md border border-border bg-elevated/40 p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-ink">Tutor connection</h3>
        <div className="flex items-center gap-2">
          {status.kind === "saved" && (
            <span
              role="status"
              aria-live="polite"
              className="text-[10px] font-semibold text-success"
            >
              ● saved
            </span>
          )}
          {statusBadge}
        </div>
      </div>

      {!hasKey && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] leading-relaxed text-ink/80">
            CodeTutor includes a limited number of tutor questions. Adding
            your own OpenAI key is optional and lets you keep asking after
            the included allowance is used.
          </p>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-[11px] font-medium text-accent transition hover:text-accentMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Get a key from OpenAI →
          </a>
        </div>
      )}

      {showInputForm && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted">API key</span>
            <div className="flex items-center gap-2">
              <input
                type={reveal ? "text" : "password"}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (status.kind !== "idle") setStatus({ kind: "idle" });
                }}
                placeholder={hasKey ? "enter a new key to replace" : "sk-…"}
                className="flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-ink transition placeholder:text-faint focus:border-accent/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="flex items-center justify-center rounded-md border border-border bg-bg p-1.5 text-muted transition hover:border-accent/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title={reveal ? "Hide API key" : "Show API key"}
                aria-label={reveal ? "Hide API key" : "Show API key"}
                aria-pressed={reveal}
              >
                {reveal ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
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
            <div className="text-[11px]">
              {status.kind === "validating" && (
                <span className="flex items-center gap-1.5 text-warn">
                  <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-warn" />
                  validating…
                </span>
              )}
              {status.kind === "invalid" && (
                <span className="text-danger">× {status.error}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {hasKey && !showReplace && (
        <button
          type="button"
          onClick={() => setShowReplace(true)}
          className="self-start text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-ink"
        >
          Replace key
        </button>
      )}

      {hasKey && showReplace && (
        <button
          type="button"
          onClick={() => {
            setShowReplace(false);
            setDraft("");
            setStatus({ kind: "idle" });
          }}
          className="self-start text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-ink"
        >
          Cancel
        </button>
      )}

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
                className="w-full appearance-none rounded-md border border-border bg-bg px-2.5 py-1.5 pr-7 text-xs text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.qualityStatus === "evaluated" ? "evaluated" : "not evaluated"}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                ▾
              </span>
            </div>
          )}
          {modelsStatus === "loaded" && selectedModel && (() => {
            const selected = models.find((model) => model.id === selectedModel);
            if (!selected) return null;
            return (
              <p
                className={`text-[10px] leading-relaxed ${
                  selected.qualityStatus === "evaluated" ? "text-success" : "text-warnInk"
                }`}
              >
                {selected.qualityLabel}. Unevaluated models can still be used in the
                general editor tutor, but contextual lesson guidance is disabled.
              </p>
            );
          })()}
          {modelsStatus === "loaded" && models.length === 0 && (
            <span className="text-[11px] text-muted">
              This key doesn't have access to any chat models — check your OpenAI plan.
            </span>
          )}
        </div>
      )}

      {/* Trust + cost copy. Two short lines, plain language, anchored to
          the card so a beginner reads them in the same glance as the input. */}
      <div className="flex flex-col gap-1 text-[10px] leading-relaxed text-faint">
        <p>
          When this key is connected, tutor requests use your OpenAI account
          instead of CodeTutor's included allowance.
        </p>
        <p>Stored encrypted; only decrypted in-flight.</p>
        <p>Typical cost: a few cents per hour of tutoring.</p>
      </div>

      {hasKey &&
        (confirmForget ? (
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
        ))}
    </section>
  );
}

function PersonaSection() {
  const persona = useAIStore((s) => s.persona);
  const setPersona = useAIStore((s) => s.setPersona);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">
        How should the tutor talk to you?
      </h3>
      <div className="flex flex-col gap-1.5">
        <div
          role="radiogroup"
          aria-label="How should the tutor talk to you?"
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
  );
}

function AccountTab({
  onClose,
  onShareChanged,
}: {
  onClose?: () => void;
  onShareChanged?: (change: {
    courseId: string;
    lessonId: string;
    shared: boolean;
  }) => void;
}) {
  const nav = useNavigate();
  const location = useLocation();

  const [showDelete, setShowDelete] = useState(false);
  const [replaying, setReplaying] = useState(false);

  const handleReplayIntro = () => {
    // Replay is presentation-only. Resetting welcome/coach preferences here
    // made an innocent "watch again" action enter the destructive first-run
    // lesson path and overwrite real work. The explicit replay route returns
    // to the current internal page without changing any learner state.
    setReplaying(true);
    onClose?.();
    const params = new URLSearchParams({
      replay: "1",
      returnTo: locationReturnTarget(location),
    });
    nav(`/welcome?${params.toString()}`);
  };

  return (
    <>
      <NotificationsSection />

      <hr className="border-border" />

      <StreakDisplaySection />

      <hr className="border-border" />

      <PublicSharesSection onShareChanged={onShareChanged} />

      <hr className="border-border" />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink">Replay the intro</h3>
        <button
          type="button"
          onClick={handleReplayIntro}
          disabled={replaying}
          aria-busy={replaying}
          className="self-start rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {replaying ? "Opening…" : "Watch the moment again"}
        </button>
        <p className="text-[10px] leading-relaxed text-faint">
          Replay the cinematic opening without changing your lessons or progress.
        </p>
      </section>

      <hr className="border-border" />

      <DataExportSection />

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

      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} />}
    </>
  );
}

function PublicSharesSection({
  onShareChanged,
}: {
  onShareChanged?: (change: {
    courseId: string;
    lessonId: string;
    shared: boolean;
  }) => void;
}) {
  const [shares, setShares] = useState<OwnerShare[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await api.listMyShares();
      setShares(response.shares);
      setStatus("loaded");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your shares.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!confirming) return;
    const frame = requestAnimationFrame(() => {
      confirmButtonRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [confirming]);

  const revoke = async (share: OwnerShare) => {
    setRevoking(share.shareToken);
    setError(null);
    try {
      await api.revokeShare(share.shareToken);
      setShares((current) =>
        current.filter((item) => item.shareToken !== share.shareToken),
      );
      onShareChanged?.({
        courseId: share.courseId,
        lessonId: share.lessonId,
        shared: false,
      });
      setConfirming(null);
      requestAnimationFrame(() => {
        sectionHeadingRef.current?.focus({ preventScroll: true });
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop sharing.");
    } finally {
      setRevoking(null);
    }
  };

  const cancelConfirmation = () => {
    const shareToken = confirming;
    setConfirming(null);
    requestAnimationFrame(() => {
      if (shareToken) {
        stopButtonRefs.current.get(shareToken)?.focus({ preventScroll: true });
      }
    });
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="public-shares-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            ref={sectionHeadingRef}
            id="public-shares-heading"
            tabIndex={-1}
            className="text-xs font-semibold text-ink outline-none"
          >
            My public shares
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            See every lesson page that is currently public and stop sharing it at
            any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={status === "loading"}
          className="shrink-0 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger"
        >
          {error}{" "}
          {status === "error" && (
            <button
              type="button"
              onClick={() => void load()}
              className="font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {status === "loaded" && shares.length === 0 && (
        <div className="rounded-md border border-border bg-elevated/30 px-3 py-3 text-xs text-muted">
          You have no public lesson pages.
        </div>
      )}

      {shares.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Public lesson shares">
          {shares.map((share) => {
            const confirmingThis = confirming === share.shareToken;
            return (
              <li
                key={share.shareToken}
                className="rounded-md border border-border bg-elevated/30 p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-ink">
                      {share.lessonTitle}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-faint">
                      {share.courseTitle} · updated {new Date(share.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <a
                    href={share.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-semibold text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    View
                  </a>
                  {!confirmingThis && (
                    <button
                      ref={(node) => {
                        if (node) stopButtonRefs.current.set(share.shareToken, node);
                        else stopButtonRefs.current.delete(share.shareToken);
                      }}
                      type="button"
                      onClick={() => setConfirming(share.shareToken)}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold text-danger transition hover:bg-danger/10 hover:text-danger/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                    >
                      Stop sharing
                    </button>
                  )}
                </div>

                {confirmingThis && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/5 p-2">
                    <span className="mr-auto text-xs leading-relaxed text-danger">
                      The current public link will stop working.
                    </span>
                    <button
                      ref={confirmButtonRef}
                      type="button"
                      onClick={() => void revoke(share)}
                      disabled={revoking === share.shareToken}
                      className="inline-flex min-h-11 items-center rounded-md bg-danger px-2.5 py-1.5 text-xs font-semibold text-bg disabled:opacity-60"
                    >
                      {revoking === share.shareToken ? "Stopping…" : "Stop sharing"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelConfirmation}
                      disabled={revoking === share.shareToken}
                      className="inline-flex min-h-11 items-center rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-muted disabled:opacity-60"
                    >
                      Keep public
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Phase 22D: streak-nudge email opt-in. Defaults TRUE on a new account
// (industry norm for retention email sent to people who created an
// account); the toggle here + the email's own one-click unsubscribe link
// are the two off-ramps. Optimistic patch — UI flips instantly, rolls
// back on PATCH failure.
function NotificationsSection() {
  const optIn = useEmailOptIn();
  const streaksHidden = useDisableStreaks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async () => {
    setError(null);
    setBusy(true);
    try {
      await setEmailOptIn(!optIn);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Email notifications</h3>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-[12px] font-medium text-ink">Streak nudges</div>
          <p
            id="streak-nudge-description"
            className="mt-0.5 text-[10px] leading-relaxed text-faint"
          >
            {streaksHidden
              ? "Off while streaks are hidden. Show streaks again to choose whether you want email nudges."
              : "One short email when you skip a day, so your streak doesn't quietly slip away. We'll never send more than one per day."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          aria-label="Toggle streak nudge emails"
          aria-describedby="streak-nudge-description"
          aria-busy={busy}
          disabled={busy || streaksHidden}
          onClick={onToggle}
          className="relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-5 w-9 items-center rounded-full border transition ${
              optIn ? "border-accent/60 bg-accent/80" : "border-border bg-elevated"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-bg shadow transition ${
                optIn ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </span>
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          {error}
        </div>
      )}
    </section>
  );
}

// Phase 27: opt-out for the streak system. Some learners (career-changers
// burned by streak-pressure on prior apps) genuinely learn worse with the
// chip ticking in the corner. Defaults OFF (streaks visible — the modal
// audience benefits from the signal). Toggle ON suppresses every streak
// surface (toolbar chip, lesson-complete celebration, share-page count)
// AND the daily streak nudge email. Streak data on the server is
// preserved — toggling back resumes display from where it was.
function StreakDisplaySection() {
  const disabled = useDisableStreaks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async () => {
    setError(null);
    setBusy(true);
    try {
      await setDisableStreaks(!disabled);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Streaks</h3>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-[12px] font-medium text-ink">Hide streaks</div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
            Some people learn better without streaks. Turn this on to hide the
            streak chip, lesson-complete streak celebration, and the daily
            streak email. We'll keep tracking yours quietly so you can flip
            this back on whenever.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={disabled}
          aria-label="Toggle hide streaks"
          aria-busy={busy}
          disabled={busy}
          onClick={onToggle}
          className="relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-5 w-9 items-center rounded-full border transition ${
              disabled ? "border-accent/60 bg-accent/80" : "border-border bg-elevated"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-bg shadow transition ${
                disabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </span>
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          {error}
        </div>
      )}
    </section>
  );
}

function DataExportSection() {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const restoreDownloadFocusRef = useRef(false);

  useEffect(() => {
    if (exporting || !restoreDownloadFocusRef.current) return;
    restoreDownloadFocusRef.current = false;
    downloadButtonRef.current?.focus({ preventScroll: true });
  }, [exporting]);

  const handleDownloadData = async () => {
    setExportErr(null);
    setExportSuccess(null);
    setExporting(true);
    try {
      await api.downloadUserExport();
      const stamp = new Date().toISOString().slice(0, 10);
      setExportSuccess(`Downloaded codetutor-export-${stamp}.json`);
    } catch (e) {
      setExportErr((e as Error).message);
    } finally {
      restoreDownloadFocusRef.current = true;
      setExporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-ink">Your data</h3>
      {exportErr && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          {exportErr}
        </div>
      )}
      {exportSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          {exportSuccess}
        </div>
      )}
      <button
        ref={downloadButtonRef}
        type="button"
        onClick={handleDownloadData}
        disabled={exporting}
        aria-busy={exporting}
        className="min-h-11 self-start rounded-lg border border-border bg-elevated px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {exporting ? "Preparing…" : "Download my data"}
      </button>
      <p className="text-[10px] leading-relaxed text-faint">
        A JSON file with your preferences, progress, saved projects, AI usage
        history, and feedback. Your encrypted OpenAI key is not included.
      </p>
    </section>
  );
}
