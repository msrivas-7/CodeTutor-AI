import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface LessonActionsMenuProps {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onClose: () => void;
  onResetLesson: () => void;
}

interface MenuPosition {
  left: number;
  top: number;
}

const MENU_WIDTH = 192;
const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 6;

/**
 * Lesson actions cross several independently clipped workspace panes. Keep
 * their menu in the document overlay layer so Instructions, Tutor, Output,
 * and resized editor regions can never paint over or crop it.
 */
export function LessonActionsMenu({
  open,
  anchorRef,
  disabled,
  onClose,
  onResetLesson,
}: LessonActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const placeMenu = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 54;
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(
        anchorRect.right - MENU_WIDTH,
        window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER,
      ),
    );
    const preferredTop = anchorRect.top - menuHeight - ANCHOR_GAP;
    const top = preferredTop >= VIEWPORT_GUTTER
      ? preferredTop
      : Math.min(
          anchorRect.bottom + ANCHOR_GAP,
          window.innerHeight - menuHeight - VIEWPORT_GUTTER,
        );
    setPosition({ left, top: Math.max(VIEWPORT_GUTTER, top) });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    placeMenu();
    const frame = window.requestAnimationFrame(placeMenu);
    return () => window.cancelAnimationFrame(frame);
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => placeMenu();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef, onClose]);

  useEffect(() => {
    if (!open || !position) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });
  }, [open, position]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      id="lesson-actions-menu"
      role="menu"
      aria-labelledby="lesson-actions-trigger"
      style={{
        position: "fixed",
        left: position?.left ?? -10_000,
        top: position?.top ?? -10_000,
        width: MENU_WIDTH,
        zIndex: 60,
      }}
      className="overflow-hidden rounded-lg border border-border bg-panel/95 p-1 shadow-xl backdrop-blur"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onResetLesson();
        }}
        disabled={disabled}
        className="block min-h-11 w-full rounded-md px-3 py-2 text-left text-xs font-medium text-danger/80 transition hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-40"
        title="Reset all lesson progress (attempts, runs, hints, code) — destructive"
      >
        Reset Lesson
      </button>
    </div>,
    document.body,
  );
}
