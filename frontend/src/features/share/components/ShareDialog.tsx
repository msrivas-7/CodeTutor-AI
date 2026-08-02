import { useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "../../../components/Modal";
import { api } from "../../../api/client";
import type {
  CreateShareBody,
  OwnerShare,
  ShareMastery,
} from "../../../api/client";
import { ApiError } from "../../../api/ApiError";
import { publicShareUrl } from "../shareUrl";
import { useAuthStore } from "../../../auth/authStore";
import { resolveFirstName } from "../../firstRun/resolveFirstName";
import { ShareCardPreviewScaled } from "./ShareCardPreview";
import { isNativeShareCancellation } from "../shareTelemetry";

// "5 minutes ago" / "yesterday" / "on Apr 22" — used in the dialog
// header when the user is reopening an existing share. Renders an
// English phrase that fits the prefix "You shared this ___".
function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "earlier";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  // Older than a week: drop the relative form, use a calendar date so
  // the user sees "You shared this on Apr 22" — concrete, not vague.
  return `on ${new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

// Phase 21C: ShareDialog. Triggered from LessonCompletePanel's
// "Share this win" button. Three states:
//
//   - "compose": preview + display-name toggle + Make-public button.
//   - "creating": button is busy; the rest stays so the user sees what
//     they're committing to.
//   - "created": success — show the canonical URL, copy button, and a
//     "View page →" link that opens the cinematic page in a new tab.
//
// Errors surface inline under the primary button (snippet rejected by
// sanitizer, rate-limit, etc.) — not via toast, so the user can see
// what's wrong without losing the modal.

// Two payload shapes:
//   - `wire` is what gets POSTed (matches CreateShareBody exactly,
//     minus displayName which the dialog supplies based on opt-in)
//   - `preview` is what the dialog needs to render the in-browser
//     ShareCardPreview before the share is created. Title / order /
//     etc. are pulled from the FRONTEND lesson catalog (cheap, the
//     client already has it), but only the wire fields go to the
//     server; the canonical title comes back via getShare(token)
//     after creation.
export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onShareChanged?: (shared: boolean) => void;
  payload: {
    /** Fields submitted to POST /api/shares. */
    wire: Omit<CreateShareBody, "displayName">;
    /** Fields used only for the in-browser preview. */
    preview: {
      lessonTitle: string;
      lessonOrder: number;
      courseTitle: string;
      courseTotalLessons: number;
    };
    /** First name from auth — used as the default for the toggle.
     *  null means we have no name to suggest, toggle stays off. */
    suggestedName: string | null;
  };
}

export function ShareDialog({
  open,
  onClose,
  returnFocusRef,
  payload,
  onShareChanged,
}: ShareDialogProps) {
  // Default OFF (privacy by default). The toggle lifts to ON only when
  // the user opts in.
  const [showName, setShowName] = useState(false);
  // Three-state machine: compose → creating → created.
  const [phase, setPhase] = useState<
    "lookup" | "lookup_error" | "compose" | "creating" | "created"
  >(
    "lookup",
  );
  const [error, setError] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const shareUrlInputRef = useRef<HTMLInputElement>(null);
  const replaceLinkButtonRef = useRef<HTMLButtonElement>(null);
  const revokeButtonRef = useRef<HTMLButtonElement>(null);
  // Phase 21C-ext: the 9:16 Story-format image is rendered in a
  // separate fire-and-forget pipeline server-side. Poll for it once
  // the share has been created; surface a "Save for Stories" download
  // button when the URL lands.
  const [storyImageUrl, setStoryImageUrl] = useState<string | null>(null);
  // Track elapsed wait + give up signal so the disabled-button affordance
  // can show real progress instead of a static "~3s" lie. After 30s of
  // polling we surface a graceful fallback message instead of leaving
  // the row in "Preparing…" forever.
  const [storyWaitElapsedMs, setStoryWaitElapsedMs] = useState(0);
  const [storyWaitGaveUp, setStoryWaitGaveUp] = useState(false);
  // When the dialog jumps straight to `created` because an existing
  // share was found, surface the publish date so the user knows this
  // wasn't just-created. Null when the share was minted in this
  // dialog session.
  const [existingCreatedAt, setExistingCreatedAt] = useState<string | null>(
    null,
  );
  const [ownerShare, setOwnerShare] = useState<OwnerShare | null>(null);
  const [managing, setManaging] = useState<
    "name" | "refresh" | "rotate" | "revoke" | null
  >(null);
  const [confirmAction, setConfirmAction] = useState<"rotate" | "revoke" | null>(null);
  // Phase guard latch — once `handleCreate` starts, the lookup
  // callback that may resolve later must NOT overwrite the freshly-
  // created token. Using a ref so the latch is observable inside the
  // async lookup closure without re-triggering the effect.
  const lookupSupersededRef = useRef(false);
  const dismissReportedRef = useRef(false);

  // Reset machine whenever we reopen — the prior creation result
  // shouldn't persist across opens of the same lesson.
  useEffect(() => {
    if (!open) return;
    setShowName(false);
    setPhase("lookup");
    setError(null);
    setShareToken(null);
    setCopyState("idle");
    setStoryImageUrl(null);
    setStoryWaitElapsedMs(0);
    setStoryWaitGaveUp(false);
    setExistingCreatedAt(null);
    setOwnerShare(null);
    setManaging(null);
    setConfirmAction(null);
    lookupSupersededRef.current = false;
    dismissReportedRef.current = false;
  }, [open]);

  // On open, check whether the user already has a share for this
  // lesson. If yes, jump straight to its managed state. Avoids the
  // duplicate-share-on-every-click footgun where a learner who shares,
  // dismisses, then re-opens gets a brand-new token + fresh poll wait
  // for an artifact that already exists.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await api.getMyShareForLesson(
          payload.wire.courseId,
          payload.wire.lessonId,
        );
        if (cancelled) return;
        // Race guard: if the user clicked "Make public" while the
        // lookup was in flight, handleCreate has already produced its
        // own token and flipped phase to `creating`/`created`. The
        // stale lookup must NOT overwrite the freshly-minted token,
        // story image url, or display-name toggle state.
        if (lookupSupersededRef.current) return;
        setShareToken(existing.shareToken);
        setOwnerShare(existing);
        if (existing.ogStoryImageUrl) {
          setStoryImageUrl(existing.ogStoryImageUrl);
        }
        // Match the toggle state to whatever the original share used
        // so the (already-published) preview reads truthfully.
        setShowName(existing.displayName !== null);
        setExistingCreatedAt(existing.createdAt);
        setPhase("created");
      } catch (lookupError) {
        if (cancelled) return;
        if (lookupError instanceof ApiError && lookupError.status === 404) {
          setPhase("compose");
          return;
        }
        setError("We couldn't check your existing public shares. Retry before publishing so an older link isn't forgotten.");
        setPhase("lookup_error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, payload.wire.courseId, payload.wire.lessonId]);

  // Poll for the Story-format image after the share is created. The
  // image lands ~2-3s post-create via a fire-and-forget pipeline on
  // the backend; until it lands, ogStoryImageUrl is null. Bail after
  // 20 attempts (~30s) and surface a graceful fallback so the user
  // doesn't stare at a frozen "Preparing…" forever.
  useEffect(() => {
    if (phase !== "created" || !shareToken) return;
    if (storyImageUrl) return;
    let cancelled = false;
    let attempts = 0;
    const startedAt = Date.now();
    // Tick once per second so the elapsed counter advances visibly
    // even while waiting between polls. The actual /api/shares poll
    // happens every 1500ms (every other tick).
    const elapsedTimer = setInterval(() => {
      if (cancelled) return;
      setStoryWaitElapsedMs(Date.now() - startedAt);
    }, 250);
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await api.getShare(shareToken);
        if (cancelled) return;
        if (res.ogStoryImageUrl) {
          setStoryImageUrl(res.ogStoryImageUrl);
          return;
        }
      } catch {
        /* network blip — keep polling unless we're past budget */
      }
      if (attempts >= 20) {
        if (!cancelled) setStoryWaitGaveUp(true);
        return;
      }
      setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      cancelled = true;
      clearInterval(elapsedTimer);
    };
  }, [phase, shareToken, storyImageUrl]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // The compose button is removed when publishing succeeds. Without an
  // explicit destination, browsers fall back to BODY and the learner gets
  // no keyboard announcement that the public URL is ready. Move focus to
  // the concrete artifact they can copy, both after creation and when an
  // existing share is restored by the owner lookup.
  useEffect(() => {
    if (!open || phase !== "created") return;
    const frame = requestAnimationFrame(() => {
      shareUrlInputRef.current?.focus({ preventScroll: true });
      shareUrlInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, phase]);

  if (!open) return null;

  const previewName =
    phase === "created"
      ? ownerShare?.displayName ?? null
      : showName
        ? payload.suggestedName
        : null;

  const handleCreate = async () => {
    if (phase !== "compose") return;
    // Tell any in-flight lookup-on-open callback to stop short of
    // setting state — its result is now stale relative to the fresh
    // share we're about to create.
    lookupSupersededRef.current = true;
    setExistingCreatedAt(null);
    setPhase("creating");
    setError(null);
    try {
      // Wire-only fields go to the server; preview / suggestedName are
      // UI state. The backend uses zod.strict() and rejects unknown
      // keys with 400 — keeping the wire object tight defends that.
      const res = await api.createShare({
        ...payload.wire,
        displayName: showName ? payload.suggestedName : null,
      });
      setShareToken(res.shareToken);
      onShareChanged?.(true);
      try {
        const managed = await api.getMyShareForLesson(
          payload.wire.courseId,
          payload.wire.lessonId,
        );
        setOwnerShare(managed);
        setExistingCreatedAt(managed.createdAt);
      } catch {
        // The public link is already valid; management can retry on reopen.
      }
      setPhase("created");
    } catch (err) {
      // Keep the user in compose so they can retry / change opt-in.
      let msg = "Couldn't create share. Please try again.";
      if (err instanceof ApiError) {
        // The backend returns { error: "..." } — ApiError exposes the
        // raw body string. Try to parse it for a clean message.
        try {
          const body = JSON.parse(err.body) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* body wasn't JSON; keep the friendly default */
        }
      }
      setError(msg);
      setPhase("compose");
    }
  };

  const retryLookup = () => {
    setError(null);
    setPhase("lookup");
    // Reopening the effect through a short close/open state transition would
    // disturb focus. A direct lookup keeps this dialog and its focus stable.
    void api
      .getMyShareForLesson(payload.wire.courseId, payload.wire.lessonId)
      .then((existing) => {
        setOwnerShare(existing);
        setShareToken(existing.shareToken);
        setStoryImageUrl(existing.ogStoryImageUrl);
        setShowName(existing.displayName !== null);
        setExistingCreatedAt(existing.createdAt);
        setPhase("created");
      })
      .catch((lookupError) => {
        if (lookupError instanceof ApiError && lookupError.status === 404) {
          setPhase("compose");
          return;
        }
        setError("We still couldn't check your public shares. Your existing links have not been changed.");
        setPhase("lookup_error");
      });
  };

  const updateManagedShare = async (
    kind: "name" | "refresh",
    body: { displayName?: string | null; refreshSnapshot?: boolean },
  ) => {
    if (!shareToken || managing) return;
    setManaging(kind);
    setError(null);
    try {
      const updated = await api.updateShare(shareToken, body);
      setOwnerShare(updated);
      setShowName(updated.displayName !== null);
      setStoryImageUrl(updated.ogStoryImageUrl);
      setStoryWaitGaveUp(false);
      setStoryWaitElapsedMs(0);
      onShareChanged?.(true);
    } catch (manageError) {
      setError((manageError as Error).message);
    } finally {
      setManaging(null);
    }
  };

  const rotateManagedShare = async () => {
    if (!shareToken || managing) return;
    setManaging("rotate");
    setError(null);
    try {
      const rotated = await api.rotateShare(shareToken);
      setOwnerShare(rotated);
      setShareToken(rotated.shareToken);
      setStoryImageUrl(null);
      setStoryWaitGaveUp(false);
      setStoryWaitElapsedMs(0);
      setCopyState("idle");
      setConfirmAction(null);
      onShareChanged?.(true);
      requestAnimationFrame(() => {
        shareUrlInputRef.current?.focus({ preventScroll: true });
        shareUrlInputRef.current?.select();
      });
    } catch (manageError) {
      setError((manageError as Error).message);
    } finally {
      setManaging(null);
    }
  };

  const revokeManagedShare = async () => {
    if (!shareToken || managing) return;
    setManaging("revoke");
    setError(null);
    try {
      await api.revokeShare(shareToken);
      onShareChanged?.(false);
      setConfirmAction(null);
      onClose();
    } catch (manageError) {
      setError((manageError as Error).message);
      setManaging(null);
    }
  };

  const shareUrl = shareToken
    ? publicShareUrl(shareToken, window.location.origin)
    : null;

  const closeConfirmAction = () => {
    if (managing) return;
    const action = confirmAction;
    setConfirmAction(null);
    requestAnimationFrame(() => {
      const destination =
        action === "rotate" ? replaceLinkButtonRef.current : revokeButtonRef.current;
      destination?.focus({ preventScroll: true });
    });
  };

  const handleDismiss = () => {
    if (!dismissReportedRef.current) {
      dismissReportedRef.current = true;
      api.postShareOutcome("dismissed", "authenticated");
    }
    onClose();
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      api.postShareOutcome("copied", "authenticated");
      setCopyState("copied");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      /* clipboard blocked — let the input remain visible for select */
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    if (typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: `${payload.preview.lessonTitle} — ${payload.preview.courseTitle}`,
        text: `Just finished ${payload.preview.lessonTitle} on CodeTutor AI.`,
        url: shareUrl,
      });
      api.postShareOutcome("share_completed", "authenticated");
    } catch (error) {
      if (isNativeShareCancellation(error)) {
        api.postShareOutcome("cancelled", "authenticated");
      }
      /* cancellation/platform refusal stays silent in the product */
    }
  };

  return (
    <Modal
      onClose={handleDismiss}
      returnFocusRef={returnFocusRef}
      role="dialog"
      labelledBy="share-dialog-title"
      describedBy="share-dialog-desc"
      position="center"
      panelClassName="mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-panel p-4 shadow-2xl sm:p-6"
      // The dialog opens from the LessonCompletePanel's "Share this
      // win" button, and that panel is a fullscreen takeover at
      // z-[55]. Default Modal z-50 was placing the backdrop BEHIND
      // the panel, hiding the dialog from the user. z-[60] lifts it
      // above.
      zIndex={60}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2
            id="share-dialog-title"
            className="font-display text-lg font-semibold tracking-tight text-ink"
          >
            Share this win
          </h2>
          <p
            id="share-dialog-desc"
            className="mt-1 text-base leading-relaxed text-muted sm:text-body"
          >
            {phase === "created"
              ? existingCreatedAt
                ? `You shared this ${formatRelativeDate(existingCreatedAt)}. Here's the link.`
                : "Public link ready. The page plays a short cinematic — your code, typed out."
              : "Anyone with the link can see this. The OG image preview below is what unfurls on Twitter, LinkedIn, and iMessage."}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Close share dialog"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Preview — locked to 480px wide; the underlying card is
          1200×630 scaled to fit so the dialog stays portable. */}
      <div className="mb-4 flex justify-center">
        <ShareCardPreviewScaled
          width={480}
          lessonTitle={ownerShare?.lessonTitle ?? payload.preview.lessonTitle}
          lessonOrder={payload.preview.lessonOrder}
          courseTitle={ownerShare?.courseTitle ?? payload.preview.courseTitle}
          courseTotalLessons={payload.preview.courseTotalLessons}
          mastery={ownerShare?.mastery ?? payload.wire.mastery}
          timeSpentMs={ownerShare?.timeSpentMs ?? payload.wire.timeSpentMs}
          attemptCount={ownerShare?.attemptCount ?? payload.wire.attemptCount}
          codeSnippet={ownerShare?.codeSnippet ?? payload.wire.codeSnippet}
          displayName={previewName}
          shareToken={shareToken ?? "preview"}
        />
      </div>

      {phase === "lookup" ? (
        <div
          role="status"
          className="rounded-lg border border-border bg-elevated/40 px-4 py-5 text-center text-sm text-muted"
        >
          Checking whether this lesson is already public…
        </div>
      ) : phase === "lookup_error" ? (
        <div className="space-y-3">
          <div
            role="alert"
            className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-3 text-sm leading-relaxed text-warn"
          >
            {error}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={retryLookup}
              className="min-h-11 rounded-lg bg-accent/20 px-4 py-2 text-sm font-semibold text-accent ring-1 ring-accent/40 transition hover:bg-accent/30"
            >
              Retry check
            </button>
          </div>
        </div>
      ) : phase !== "created" ? (
        <>
          {/* Display-name opt-in. Off by default (privacy by default).
              Disabled when no name is available. */}
          <label
            className={`mb-4 flex min-h-11 items-start gap-3 rounded-lg border border-border bg-elevated/40 p-3 ${
              payload.suggestedName ? "cursor-pointer" : "opacity-60"
            }`}
          >
            <input
              type="checkbox"
              checked={showName}
              disabled={!payload.suggestedName}
              onChange={(e) => setShowName(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-accent"
            />
            <span className="flex-1 text-base leading-relaxed text-ink/85 sm:text-body">
              {payload.suggestedName ? (
                <>
                  Show my name as{" "}
                  <span className="font-semibold text-ink">
                    {payload.suggestedName}
                  </span>
                  .
                  <span className="mt-1 block text-meta text-faint">
                    Otherwise this publishes anonymously.
                  </span>
                </>
              ) : (
                <>
                  No name on file — share will publish anonymously.
                  <span className="mt-1 block text-meta text-faint">
                    Add your name in Settings to attribute future shares.
                  </span>
                </>
              )}
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-base leading-relaxed text-warn/90 sm:text-body"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              onClick={handleDismiss}
              className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={phase === "creating"}
              className="min-h-11 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-2 text-sm font-bold text-bg shadow-glow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "creating" ? "Creating link…" : "Make public & share"}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Created state — copy URL + native share + view page */}
          <div className="mb-4 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-elevated/40 p-2">
            <input
              ref={shareUrlInputRef}
              readOnly
              value={shareUrl ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent px-2 text-base text-ink outline-none sm:text-body"
              aria-label="Share URL"
            />
            <button
              onClick={handleCopy}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                copyState === "copied"
                  ? "bg-success/20 text-success"
                  : "bg-accent/15 text-accent hover:bg-accent/25"
              }`}
              aria-live="polite"
            >
              {copyState === "copied" ? "Copied ✓" : "Copy"}
            </button>
          </div>

          <section
            aria-labelledby="manage-share-title"
            className="mb-4 rounded-xl border border-border bg-elevated/30 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="manage-share-title" className="text-sm font-semibold text-ink">
                  Manage public share
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  Public to anyone with the link
                  {ownerShare?.updatedAt
                    ? ` · Updated ${formatRelativeDate(ownerShare.updatedAt)}`
                    : ""}
                </p>
              </div>
              <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                Live
              </span>
            </div>

            <label className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-border bg-panel/60 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={ownerShare?.displayName !== null && ownerShare?.displayName !== undefined}
                disabled={managing !== null || (!ownerShare?.displayName && !payload.suggestedName)}
                onChange={(event) =>
                  void updateManagedShare("name", {
                    displayName: event.target.checked ? payload.suggestedName : null,
                  })
                }
                className="h-5 w-5 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">Show my name</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {ownerShare?.displayName
                    ? `Currently shown as ${ownerShare.displayName}.`
                    : "Currently anonymous."}
                </span>
              </span>
              {managing === "name" && <span className="text-xs text-muted">Saving…</span>}
            </label>

            {error && (
              <div role="alert" className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                {error}
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={managing !== null}
                onClick={() =>
                  void updateManagedShare("refresh", { refreshSnapshot: true })
                }
                className="min-h-11 rounded-lg border border-border bg-panel px-3 py-2 text-xs font-semibold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                {managing === "refresh" ? "Updating code…" : "Update shared code"}
              </button>
              <button
                ref={replaceLinkButtonRef}
                type="button"
                disabled={managing !== null}
                onClick={() => setConfirmAction("rotate")}
                className="min-h-11 rounded-lg border border-border bg-panel px-3 py-2 text-xs font-semibold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                Replace public link
              </button>
              <button
                ref={revokeButtonRef}
                type="button"
                disabled={managing !== null}
                onClick={() => setConfirmAction("revoke")}
                className="min-h-11 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60 sm:col-span-2"
              >
                Stop sharing publicly
              </button>
            </div>
          </section>

          {/* Save for Stories — pulls down the 9:16 PNG with a stable
              filename so the user can drop it directly into IG Stories,
              TikTok, or Snapchat without a screenshot+crop dance.
              Three states:
                • storyImageUrl ready → primary affordance, downloads PNG
                • polling → animated dot triad + live elapsed counter
                • gave up after ~30s → graceful fallback message */}
          {storyWaitGaveUp && !storyImageUrl ? (
            <div className="mb-3 rounded-lg border border-border bg-elevated/40 p-3 text-base text-muted sm:text-body">
              <span className="block font-medium text-ink">
                Couldn't generate Stories image
              </span>
              <span className="mt-1 block text-meta text-faint">
                Use the link above instead — your share page is live.
              </span>
            </div>
          ) : (
            <a
              href={storyImageUrl ?? undefined}
              // download attribute hints "save this file" rather than
              // "navigate to it". Filename mirrors the OG token for
              // easy re-finding in Downloads.
              download={
                storyImageUrl && shareToken
                  ? `codetutor-${shareToken}-story.png`
                  : undefined
              }
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!storyImageUrl}
              className={`mb-3 flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 text-base transition sm:text-body ${
                storyImageUrl
                  ? "border-accent/30 bg-accent/5 text-ink hover:border-accent/50 hover:bg-accent/10"
                  : "pointer-events-none border-border bg-elevated/40 text-muted"
              }`}
            >
              <span className="flex items-center gap-2">
                {/* 9:16 stack icon */}
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
                  <rect x="6" y="3" width="12" height="18" rx="2" />
                  <line x1="9" y1="8" x2="15" y2="8" />
                  <line x1="9" y1="12" x2="15" y2="12" />
                </svg>
                <span className="flex items-center gap-1 font-medium">
                  {storyImageUrl ? (
                    "Save for Stories"
                  ) : (
                    <>
                      Preparing Stories image
                      {/* Animated dot triad — proper "in flight" cue */}
                      <span className="inline-flex items-center" aria-hidden="true">
                        <span className="animate-pulse">.</span>
                        <span className="animate-pulse [animation-delay:200ms]">.</span>
                        <span className="animate-pulse [animation-delay:400ms]">.</span>
                      </span>
                    </>
                  )}
                </span>
              </span>
              <span className="text-meta text-faint">
                {storyImageUrl
                  ? "1080×1920 PNG"
                  // First 800ms — render the dot triad alone (no
                  // counter), so the brain reads "starting…" instead
                  // of jumping to "1s already?". After that, surface
                  // the live counter.
                  : storyWaitElapsedMs < 800
                    ? ""
                    : `${Math.floor(storyWaitElapsedMs / 1000)}s`}
              </span>
            </a>
          )}

          {/* Action row. Native share is the primary CTA on touch
              devices (it IS the conversion event there); on desktop
              "View page →" is primary because there's no native share
              sheet to invoke. */}
          {typeof navigator !== "undefined" &&
          typeof navigator.share === "function" ? (
            <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              <a
                href={shareUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                View page →
              </a>
              <button
                onClick={handleNativeShare}
                className="min-h-11 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-2 text-sm font-bold text-bg shadow-glow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Share…
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-stretch sm:justify-end">
              <a
                href={shareUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-2 text-sm font-bold text-bg shadow-glow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-auto"
              >
                View page →
              </a>
            </div>
          )}
        </>
      )}
      {confirmAction && (
        <Modal
          onClose={closeConfirmAction}
          role="alertdialog"
          labelledBy="share-change-confirm-title"
          position="center"
          zIndex={70}
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-danger/30 bg-panel p-5 shadow-2xl"
        >
          <h3 id="share-change-confirm-title" className="text-lg font-bold text-ink">
            {confirmAction === "revoke"
              ? "Stop sharing this lesson?"
              : "Replace the public link?"}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {confirmAction === "revoke"
              ? "The public page will stop working immediately. Previously cached image copies may remain temporarily. You can publish a fresh share later."
              : "The current link will stop working immediately. Copy the replacement before sending it to anyone."}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={managing !== null}
              onClick={closeConfirmAction}
              className="min-h-11 flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={managing !== null}
              onClick={() =>
                void (confirmAction === "revoke"
                  ? revokeManagedShare()
                  : rotateManagedShare())
              }
              className="min-h-11 flex-1 rounded-lg bg-danger/20 px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30 disabled:opacity-60"
            >
              {managing
                ? "Working…"
                : confirmAction === "revoke"
                  ? "Stop sharing"
                  : "Replace link"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Small helper for callers — convert a MasteryLevel value to the
 *  ShareMastery union (they're the same string set today, but typing
 *  the cast in one place avoids surprises if they diverge later). */
export function masteryToShareMastery(
  m: "strong" | "okay" | "shaky",
): ShareMastery {
  return m;
}

/** Small helper to read the current learner's first name from the
 *  auth store (where ShareDialog's caller usually sits). Returns null
 *  when the metadata is missing or "there" — we don't want "there" to
 *  surface as the public name. */
export function currentDisplayName(): string | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  const name = resolveFirstName(user);
  if (!name || name === "there") return null;
  return name;
}
