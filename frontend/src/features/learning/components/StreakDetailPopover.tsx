import {
  type ReactNode,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { api, type StreakHistoryResponse, type UserStreakResponse } from "../../../api/client";

// The shell uses one continuously mounted DOM node in both states. This is
// intentionally not a shared-element handoff: the painted surface, streak
// identity, and focus boundary stay alive while their geometry changes.
// A wider, quicker stretch followed by a softer vertical bloom gives the shell
// the deliberate elasticity of a pill redistributing its visual mass. The
// slight difference is perceptible without turning the control into a bounce.
const LIQUID_WIDTH_SPRING = { type: "spring", stiffness: 300, damping: 28, mass: 0.9 } as const;
const LIQUID_HEIGHT_SPRING = { type: "spring", stiffness: 230, damping: 24, mass: 0.92 } as const;
const LIQUID_IDENTITY_SPRING = { type: "spring", stiffness: 270, damping: 26, mass: 0.9 } as const;
const CONTENT_EASE = [0.22, 1, 0.36, 1] as const;
const EXPANDED_HEIGHT = 188;

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  streak: UserStreakResponse;
  anchorRect: DOMRect | null;
  invokerRef: MutableRefObject<HTMLButtonElement | null>;
  identity: ReactNode;
  tooltip: string;
  glowStyle: string;
  identityClassName: string;
  collapsedInset: number;
  borderClassName: string;
}

function fmtShort(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function StreakDetailPopover({
  open,
  onOpen,
  onClose,
  streak,
  anchorRect,
  invokerRef,
  identity,
  tooltip,
  glowStyle,
  identityClassName,
  collapsedInset,
  borderClassName,
}: Props) {
  const [history, setHistory] = useState<StreakHistoryResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const restoreInvokerOnCloseRef = useRef(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    void api
      .getStreakHistory(14)
      .then((response) => {
        if (!cancelled) setHistory(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "load failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      restoreInvokerOnCloseRef.current = true;
      const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    // Let React mount the collapsed semantic button before resolving focus.
    const frame = window.requestAnimationFrame(() => {
      const invoker = invokerRef.current;
      if (!invoker || !document.contains(invoker)) return;
      const active = document.activeElement;
      const outsideControlOwnsFocus =
        !restoreInvokerOnCloseRef.current &&
        active instanceof HTMLElement &&
        active !== document.body &&
        active !== document.documentElement &&
        !shellRef.current?.contains(active);
      restoreInvokerOnCloseRef.current = true;
      if (!outsideControlOwnsFocus) invoker.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [invokerRef, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (shellRef.current?.contains(event.target as Node)) return;
      restoreInvokerOnCloseRef.current = false;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, open]);

  const geometry = useMemo(() => {
    if (!anchorRect || typeof window === "undefined") return null;
    const expandedWidth = Math.min(320, Math.max(0, window.innerWidth - 16));
    const expandedLeft = Math.max(
      8,
      Math.min(
        anchorRect.left + anchorRect.width / 2 - expandedWidth / 2,
        window.innerWidth - expandedWidth - 8,
      ),
    );
    const expandedTop = Math.max(
      8,
      Math.min(anchorRect.top, window.innerHeight - EXPANDED_HEIGHT - 8),
    );
    return open
      ? { left: expandedLeft, top: expandedTop, width: expandedWidth, height: EXPANDED_HEIGHT }
      : {
          left: anchorRect.left,
          top: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height,
        };
  }, [anchorRect, open]);

  const activeSet = useMemo(() => new Set(history?.activeDates ?? []), [history]);
  const freezeSet = useMemo(() => new Set(history?.freezeUsedDates ?? []), [history]);

  if (typeof document === "undefined" || !geometry) return null;

  return createPortal(
    <motion.div
      ref={shellRef}
      data-testid="streak-morph-surface"
      data-state={open ? "expanded" : "collapsed"}
      initial={false}
      animate={{
        ...geometry,
        borderRadius: open ? 18 : 999,
        boxShadow: open ? "0 22px 54px -24px rgb(0 0 0 / 0.7)" : glowStyle,
      }}
      transition={reduceMotion
        ? { duration: 0 }
        : {
            left: LIQUID_WIDTH_SPRING,
            width: LIQUID_WIDTH_SPRING,
            top: LIQUID_HEIGHT_SPRING,
            height: LIQUID_HEIGHT_SPRING,
            borderRadius: LIQUID_HEIGHT_SPRING,
            boxShadow: { duration: 0.28, ease: CONTENT_EASE },
          }}
      whileTap={reduceMotion || open ? undefined : { scale: 0.97 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      // The persistent shell lives in a portal even while collapsed. Keep it
      // at ordinary header depth until it expands, otherwise it can pierce a
      // modal backdrop that correctly sits above the page chrome.
      style={{ position: "fixed", zIndex: open ? 60 : 20, transformOrigin: "50% 0%" }}
      className={`overflow-hidden border ${borderClassName} text-ink backdrop-blur transition-colors focus-within:ring-2 focus-within:ring-accent/40 motion-reduce:transition-none ${
        open ? "bg-panel/95" : hovered ? "bg-elevated/60" : "bg-elevated/40"
      }`}
    >
      {/* The ring and label never unmount. They visibly travel from the pill's
          center into the expanded header, preserving object identity. */}
      <motion.div
        data-testid="streak-morph-identity"
        initial={false}
        animate={{
          left: open ? 16 : collapsedInset,
          top: open ? 17 : "50%",
          y: open ? 0 : "-50%",
        }}
        transition={reduceMotion ? { duration: 0 } : LIQUID_IDENTITY_SPRING}
        className={`pointer-events-none absolute z-10 inline-flex items-center gap-1.5 whitespace-nowrap font-medium tabular-nums ${identityClassName}`}
      >
        {identity}
      </motion.div>

      {!open ? (
          <motion.button
            key="collapsed-control"
            ref={(node) => {
              invokerRef.current = node;
            }}
            type="button"
            aria-label={tooltip}
            aria-expanded="false"
            aria-haspopup="dialog"
            title={tooltip}
            onClick={onOpen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.08 }}
            className="absolute inset-0 z-20 cursor-pointer rounded-full focus:outline-none"
          />
        ) : (
          <motion.div
            key="expanded-content"
            ref={dialogRef}
            role="dialog"
            aria-label="Streak details"
            aria-modal="false"
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.18,
              delay: reduceMotion ? 0 : 0.16,
              ease: CONTENT_EASE,
            }}
            className="absolute inset-0 focus:outline-none"
          >
            <div className="flex h-full flex-col px-4 pb-3 pt-3">
              <div className="flex h-10 items-start justify-end gap-3 pl-28">
                <div className="ml-auto pt-1 text-right text-[12px] text-muted">
                  Longest <span className="font-semibold text-ink">{streak.longest}</span>
                  {streak.freezeActive && (
                    <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-sky-200">
                      Grace held
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Collapse streak details"
                  onClick={() => {
                    restoreInvokerOnCloseRef.current = true;
                    onClose();
                  }}
                  className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                  </svg>
                </button>
              </div>

              <div className="mt-2 min-h-[42px]">
                {loadError ? (
                  <div className="text-[11px] text-faint">Couldn't load history.</div>
                ) : !history ? (
                  <div className="flex h-[42px] items-center justify-center text-[10px] text-faint">Loading…</div>
                ) : (
                  <>
                    <div className="mb-1 flex items-end justify-between gap-1">
                      {history.windowDates.map((date) => {
                        const isToday = date === history.todayUtc;
                        const isActive = activeSet.has(date);
                        const isFreeze = freezeSet.has(date);
                        const dotColor = isFreeze
                          ? "bg-sky-200/55 border-sky-200/70"
                          : isActive
                            ? "bg-accent/80 border-accent"
                            : "bg-transparent border-border";
                        return (
                          <div
                            key={date}
                            className="flex flex-col items-center gap-1"
                            title={`${fmtShort(date)} · ${isFreeze ? "grace held" : isActive ? "active" : "missed"}`}
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
              </div>

              <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-faint">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent/80" /> active</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-200/55" /> grace</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-border" /> missed</span>
              </div>
            </div>
          </motion.div>
        )}
    </motion.div>,
    document.body,
  );
}
