// Phase A — A3 (anon-share unlock): minimal share dialog for the anon
// `/try/` flow. The cinematic celebration's Share button used to pivot
// straight to the SignupWallDialog (the wall blocked the K-factor at
// peak intent). Now: click → POST /api/anon/shares → render this
// dialog with the public `/s/:token` URL. Dismissal returns to the
// celebration; account creation is a separate, explicit action.
//
// Why a separate component (instead of reusing the authed ShareDialog
// with a `mode="anon"` prop): the authed ShareDialog is ~585 lines
// and threads through revoke, mastery edit, owner-only views, etc. —
// none of which apply to anon. Building a small dialog focused on the
// anon happy path (link + copy + native-share + dismiss) is faster
// AND keeps the authed dialog's regression surface unchanged.

import { useState } from "react";
import { isApiError } from "../../../api/ApiError";
import { Modal } from "../../../components/Modal";
import { publicShareUrl } from "../../share/shareUrl";

export interface AnonShareDialogProps {
  /** Server-returned URL `/s/:token` — relative path; we build the
   *  absolute URL for clipboard / native share via window.location.origin. */
  url: string;
  /** Optional warning surfaced from the server (e.g., when the OG
   *  render is paused via kill switch). Not used for any state in this
   *  component today; reserved for future surface. */
  warn?: string | null;
  /** Caller-provided dismiss callback. Fires on Esc / Done / backdrop. */
  onDismiss: () => void;
  /** Deliberate conversion action; never called as a side effect of dismiss. */
  onSaveProgress: () => void;
}

export function AnonShareDialog({ url, warn, onDismiss, onSaveProgress }: AnonShareDialogProps) {
  const [copied, setCopied] = useState(false);
  const token = url.split("/").filter(Boolean).at(-1) ?? "";
  const absoluteUrl =
    typeof window !== "undefined" && token
      ? publicShareUrl(token, window.location.origin)
      : url;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be denied (insecure context, no perms). The
      // input below is selectAll-able as fallback.
    }
  }

  async function handleNativeShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      // No native share → fall back to copy.
      await handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: "I just wrote my first program",
        text: "Check out my first lesson on CodeTutor.",
        url: absoluteUrl,
      });
    } catch {
      // User cancelled or share unavailable — silent. Copy stays
      // available as a deliberate alternate path.
    }
  }

  return (
    <Modal
      onClose={onDismiss}
      labelledBy="anon-share-title"
      describedBy="anon-share-description"
      position="center"
      zIndex={60}
      panelClassName="mx-4 w-full max-w-md rounded-2xl border border-border bg-panel p-5 shadow-2xl sm:p-6"
    >
        <header className="mb-4">
          <h2 id="anon-share-title" className="font-display text-xl font-semibold text-ink">
            Your first one — share it
          </h2>
          <p id="anon-share-description" className="mt-1 text-sm leading-relaxed text-muted">
            This link works for anyone, no signup. Send it to a friend
            who'd get a kick out of it.
          </p>
        </header>

        {warn ? (
          <p className="mb-3 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            {warn}
          </p>
        ) : null}

        <label className="mb-4 flex flex-col gap-1.5 text-sm font-medium text-muted">
          Public link
          <input
            type="text"
            readOnly
            value={absoluteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-ink outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/70"
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            {copied ? "✓ Copied" : "Copy link"}
          </button>
          {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
            <button
              type="button"
              onClick={handleNativeShare}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-ink transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              Share…
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel sm:ml-auto"
          >
            Done
          </button>
        </div>
        <button
          type="button"
          onClick={onSaveProgress}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          Save this progress with a free account
        </button>
    </Modal>
  );
}

// Helper for callers that catch a thrown ApiError from
// `api.createAnonShare` — pulls the structured `error` code out of
// the JSON body so the dialog opener can decide whether to surface a
// "rate-limited" message or fall back silently to the wall.
export function anonShareErrorCode(err: unknown): string | null {
  if (!isApiError(err)) return null;
  try {
    const parsed = JSON.parse(err.body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}
