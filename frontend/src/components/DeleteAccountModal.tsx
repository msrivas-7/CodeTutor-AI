import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "../api/client";
import { ApiError } from "../api/ApiError";
import { useAuthStore } from "../auth/authStore";

// Phase 20-P0 #9: destructive confirm dialog for self-service account
// deletion. The user has to re-type their email before the Delete button
// enables — blunts accidental clicks from a shared laptop and also acts as
// a second line of defense against a leaked session (the server re-checks
// the email against the JWT claim, but the UX guardrail matters for the
// common "oh no" case). On success we sign out (which triggers
// RequireAuth → /login) and show a one-shot toast by passing a search
// param through the redirect.
//
// Phase 23 P0 #1: server requires the JWT to have been issued in the last
// 5 minutes (closes the "stolen laptop with stale localStorage JWT" gap).
// The gate applies UNIFORMLY — password sessions, Google sessions, GitHub
// sessions, and any future provider all hit the same 428. When the server
// returns 428 REAUTH_REQUIRED, this modal pivots to a "sign out and back
// in" prompt. The user signs out, signs back in via whatever method they
// normally use (any provider gives a fresh JWT), then re-opens this modal
// from Settings → Account → Delete to retry. We chose this over an inline
// password reauth because:
//   - same UX for every auth method, no provider branching
//   - the explicit "click Delete a second time" is genuine user signal
//   - simpler code: no popups, no provider redirects, no email round-trip
interface DeleteAccountModalProps {
  onClose: () => void;
}

type Mode = "confirm" | "reauth";

export function DeleteAccountModal({ onClose }: DeleteAccountModalProps) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const email = (user?.email ?? "").trim();

  const [mode, setMode] = useState<Mode>("confirm");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches =
    email.length > 0 && draft.trim().toLowerCase() === email.toLowerCase();

  // Phase 23 P0 #1: REAUTH_REQUIRED detection. The server returns 428 with
  // a JSON body `{error: "REAUTH_REQUIRED", reason: "stale_jwt" | "missing_iat"}`.
  // ApiError exposes the raw body, so we parse it here rather than at the
  // api/client.ts layer (only this site cares about the specific code).
  const isReauthRequired = (e: unknown): boolean => {
    if (!(e instanceof ApiError) || e.status !== 428) return false;
    try {
      const parsed = JSON.parse(e.body) as { error?: string };
      return parsed.error === "REAUTH_REQUIRED";
    } catch {
      return false;
    }
  };

  const handleDelete = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteAccount(draft.trim());
      // Success path: clear the local Supabase session and redirect to
      // /signup with a one-shot toast param.
      await signOut().catch(() => {});
      window.location.replace("/signup?deleted=1");
    } catch (e) {
      if (isReauthRequired(e)) {
        // Pivot to "sign out and back in" mode. No password prompt — the
        // user signs out via a button click, lands on /login, signs in
        // via whatever method they normally use, then comes back to
        // Settings → Account and clicks Delete again with a fresh JWT.
        setMode("reauth");
        setBusy(false);
        return;
      }
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // Phase 23 P0 #1: reauth pivot click. Sign out and redirect to /login
  // (RequireAuth on /start/etc. already redirects unauthenticated users
  // to /login, so a plain signOut + window.location is enough). After
  // signing in again, the user re-opens this modal manually.
  const handleSignOutForReauth = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await signOut();
    } catch (e) {
      // Even if signOut throws, force-navigate — cleaner than leaving
      // them stuck on a half-state modal.
      console.warn("[delete-account] signOut threw", e);
    }
    window.location.replace("/login");
  };

  if (!user) return null;

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      role="alertdialog"
      labelledBy="delete-account-title"
      position="center"
      panelClassName="w-full max-w-md rounded-xl border border-danger/40 bg-panel p-5 shadow-xl"
    >
      {mode === "confirm" ? (
        <div className="flex flex-col gap-3">
          <h2
            id="delete-account-title"
            className="text-sm font-semibold text-danger"
          >
            Delete account
          </h2>
          <p className="text-[12px] leading-relaxed text-ink/90">
            This permanently removes your account, lesson progress, saved editor
            projects, preferences, and your encrypted OpenAI key from our
            servers. <span className="font-semibold">This cannot be undone.</span>
          </p>
          <p className="text-[12px] leading-relaxed text-ink/80">
            Type your email <span className="font-mono text-ink">{email}</span>{" "}
            to confirm.
          </p>
          <input
            type="email"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (err) setErr(null);
            }}
            placeholder={email}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-xs text-ink transition placeholder:text-faint focus:border-danger/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Confirm email"
          />
          {err && (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
            >
              {err}
            </div>
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!matches || busy}
              aria-busy={busy}
              className="rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      ) : (
        // Phase 23 P0 #1: reauth mode. Same UX for every auth method
        // (password / Google / GitHub / future) — sign out, sign back in,
        // come back to Settings → Account → Delete and try once more.
        // Mechanism is uniform; the second click is the explicit "yes, I
        // really mean it" signal.
        <div className="flex flex-col gap-3">
          <h2
            id="delete-account-title"
            className="text-sm font-semibold text-danger"
          >
            Sign in again to confirm
          </h2>
          <p className="text-[12px] leading-relaxed text-ink/90">
            For your safety, deleting an account requires a recent sign-in.
            We&rsquo;ll sign you out — please sign back in the same way you
            usually do, then return to{" "}
            <span className="font-semibold text-ink">Settings &rarr; Account</span>{" "}
            and click <span className="font-semibold text-ink">Delete account</span>{" "}
            once more.
          </p>
          {err && (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger"
            >
              {err}
            </div>
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSignOutForReauth}
              disabled={busy}
              aria-busy={busy}
              className="rounded-md bg-danger px-3 py-1 text-[11px] font-semibold text-bg transition hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Signing out…" : "Sign out and continue"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
