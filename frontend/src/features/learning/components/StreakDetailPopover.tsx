import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { api, type StreakHistoryResponse, type UserStreakResponse } from "../../../api/client";

// Phase 21B (iter-3): expand-on-click streak detail widget. Dynamic-
// island grammar: click the chip → it expands inline (NOT a modal)
// to show the past 14 days as a row of small dots, plus stat lines.
// Click outside or press Esc → collapse back to chip.
//
// Visual language:
//   - Today: ring around the dot (highlight current day)
//   - Active day: filled accent (or success at Day 7+ tier)
//   - Freeze-used day: frosted-sky filled (the grace mark made
//     legible — same metaphor as the chip's frosted second arc)
//   - Missed day: empty outlined dot (low opacity)
//
// Reduced-motion: instant fade-in, no scale; layout identical.

const HOUSE_EASE = [0.22, 1, 0.36, 1] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  streak: UserStreakResponse;
  /** DOM element to anchor the popover to (the chip itself). */
  anchorRect: DOMRect | null;
  /** The control that invoked the popover and must regain focus on close. */
  invokerRef: RefObject<HTMLButtonElement | null>;
}

/** Format YYYY-MM-DD into a "Mon 4" weekday-day string in the user's locale. */
function fmtShort(yyyymmdd: string): string {
  // Construct a Date at UTC midnight, then format with toLocaleDateString
  // using the user's local TZ. This is the same localization pattern
  // FreeTierPill.formatReset uses.
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function StreakDetailPopover({
  open,
  onClose,
  streak,
  anchorRect,
  invokerRef,
}: Props) {
  const [history, setHistory] = useState<StreakHistoryResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const restoreInvokerOnCloseRef = useRef(true);
  const reduceMotion = useReducedMotion();

  // Lazy-load history when first opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    void api
      .getStreakHistory(14)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus management (Batch 2 #8): on open, move keyboard focus to the
  // popover so a keyboard user can interact with it (and screen readers
  // announce it as a new region). On close, return focus to the invoking
  // streak control. This avoids the "tab into background page chrome"
  // failure mode that violates WCAG 2.4.3.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      restoreInvokerOnCloseRef.current = true;
      // Safari does not always move DOM focus to a button activated by mouse,
      // so document.activeElement can be body here. The accessibility contract
      // is to return to the invoking control, not whichever element happened
      // to own focus before the click.
      returnFocusRef.current = invokerRef.current;
      // Defer to next frame so the popover is mounted before we focus.
      const id = window.requestAnimationFrame(() => {
        popoverRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    } else if (returnFocusRef.current) {
      const el = returnFocusRef.current;
      returnFocusRef.current = null;
      const shouldRestoreInvoker = restoreInvokerOnCloseRef.current;
      restoreInvokerOnCloseRef.current = true;
      // Defer so the popover's exit animation can release focus
      // gracefully without flicker. Pointer dismissal gets one frame for the
      // chosen outside control to claim focus; if activation only landed on a
      // non-focusable background (body, the document root, or the exiting
      // popover), restore the invoker instead of dropping keyboard users at
      // the start of the document.
      window.requestAnimationFrame(() => {
        // Verify the prior element is still in the DOM before
        // re-focusing — guards against the chip having unmounted.
        if (!document.contains(el)) return;
        const activeElement = document.activeElement;
        const outsideControlOwnsFocus =
          !shouldRestoreInvoker &&
          activeElement instanceof HTMLElement &&
          activeElement !== document.body &&
          activeElement !== document.documentElement &&
          !popoverRef.current?.contains(activeElement);
        if (!outsideControlOwnsFocus) el.focus();
      });
    }
  }, [invokerRef, open]);

  // Escape closes this transient surface on keydown without canceling the
  // event. WebKit currently dispatches keydown but can omit keyup when Escape
  // exits Safari's native window fullscreen mode (WebKit 279030). Safari owns
  // that browser transition; the product only releases its own overlay.
  // Listens to `pointerdown` (unified mouse/touch/pen) instead of
  // `mousedown` — touch users tap → no `mousedown` event fires, so
  // `mousedown` would have left the popover open on mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      // Click on the anchor (chip) itself shouldn't close — chip's own
      // click handler toggles via `onClose`. We only auto-close on
      // clicks outside both the popover AND the anchor.
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      if (anchorRect) {
        const x = e.clientX;
        const y = e.clientY;
        if (
          x >= anchorRect.left &&
          x <= anchorRect.right &&
          y >= anchorRect.top &&
          y <= anchorRect.bottom
        ) return;
      }
      // Pointer activation may own its own focus destination. In Safari the
      // pointerdown can still leave focus in this popover until the later
      // click focuses the outside control, so let close-time focus management
      // distinguish that control from a non-focusable background.
      restoreInvokerOnCloseRef.current = false;
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose, anchorRect]);

  // Anchor: top edge sits flush against chip's bottom (no gap). The
  // popover grows DOWN from that edge via transform: scale with
  // origin top-center, so visually the chip itself appears to balloon
  // outward.
  //
  // Iter-4 (post-feedback): popover is rendered in a PORTAL into
  // document.body. Without the portal, the popover inherits the chip
  // wrapper's CSS transform context (`-translate-x-1/2` for the
  // toolbar centering), which breaks `position: fixed` — fixed
  // elements get treated as `absolute` relative to a transformed
  // ancestor. That made the popover appear off to the right of the
  // toolbar and get cut off. The portal escapes that context entirely.
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { display: "none" };
    const popoverWidth = 320;
    const left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
    return {
      position: "fixed",
      left: `${clampedLeft}px`,
      top: `${anchorRect.bottom + 4}px`,
      width: `${popoverWidth}px`,
      transformOrigin: "50% 0%",
      // Iter-4: bump above the lesson-complete panel (z-[55]) so the
      // popover is never occluded by a modal celebration. The
      // LessonCompletePanel's chip is rendered with interactive={false}
      // so it can't open the popover anyway, but other surfaces (modals
      // in future) might also stack — z-[60] is a safe ceiling.
      zIndex: 60,
    };
  }, [anchorRect]);

  const activeSet = useMemo(() => new Set(history?.activeDates ?? []), [history]);
  const freezeSet = useMemo(() => new Set(history?.freezeUsedDates ?? []), [history]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && anchorRect && (
        <motion.div
          ref={popoverRef}
          role="dialog"
          aria-label="Streak details"
          aria-modal="false"
          tabIndex={-1}
          style={popoverStyle}
          // Dynamic-island grammar: anchored flush below chip with
          // origin top-center. Pure vertical unfurl (scaleY 0 → 1) +
          // a tiny content fade so the popover reads as "growing
          // straight down out of the chip's bottom edge."
          //
          // Reduced-motion (Batch 2 #10): skip scaleY entirely and use
          // a 1-frame opacity fade. Layout still carries the meaning —
          // the popover is anchored to the chip's bottom edge so its
          // PRESENCE communicates "this came from the chip" without
          // motion vocabulary.
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scaleY: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
          transition={{
            duration: reduceMotion ? 0.12 : 0.28,
            ease: HOUSE_EASE,
          }}
          className="rounded-xl border border-border bg-panel/95 p-4 shadow-2xl backdrop-blur"
        >
          {/* Header: streak summary stats. */}
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[22px] font-semibold leading-none text-ink">
                {streak.current}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-faint">
                day streak
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] text-muted">
                Longest <span className="font-semibold text-ink">{streak.longest}</span>
              </div>
              {streak.freezeActive && (
                <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-sky-200/15 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-sky-200">
                  Grace held
                </div>
              )}
            </div>
          </div>

          {/* Dot grid — last 14 days. */}
          {loadError ? (
            <div className="text-[11px] text-faint">Couldn't load history.</div>
          ) : !history ? (
            <div className="flex h-[42px] items-center justify-center text-[10px] text-faint">
              Loading…
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-end justify-between gap-1">
                {history.windowDates.map((d) => {
                  const isToday = d === history.todayUtc;
                  const isActive = activeSet.has(d);
                  const isFreeze = freezeSet.has(d);
                  // Color resolution:
                  //   freeze > active > missed.
                  const dotColor = isFreeze
                    ? "bg-sky-200/55 border-sky-200/70"
                    : isActive
                      ? "bg-accent/80 border-accent"
                      : "bg-transparent border-border";
                  return (
                    <div
                      key={d}
                      className="flex flex-col items-center gap-1"
                      title={`${fmtShort(d)} · ${
                        isFreeze ? "grace held" : isActive ? "active" : "missed"
                      }`}
                    >
                      <div
                        className={`h-3 w-3 rounded-full border ${dotColor} ${
                          isToday ? "ring-2 ring-accent/40 ring-offset-1 ring-offset-panel" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-faint">
                <span>{history.windowDates[0] ? fmtShort(history.windowDates[0]) : ""}</span>
                <span>Today</span>
              </div>
            </>
          )}

          {/* Footer legend — quietest copy, only shown if there's
              meaningful information to convey (e.g. freeze visible). */}
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-faint">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-accent/80" /> active
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-200/55" /> grace
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-border" /> missed
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
