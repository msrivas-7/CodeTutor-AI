import { useRef } from "react";

// Keyboard resize step (px). Chosen to match the smallest perceptible width
// change in the app — roughly one character column.
const KEY_STEP = 16;
const KEY_STEP_BIG = 64;

// Lightweight drag handle — reports pointer delta to the parent, which owns
// the width/height state. Uses pointer events (+ pointer capture via the
// document-level listener) so drags work across monitors and outside the
// bounds of the handle itself. Keyboard: arrow keys nudge, Home double-clicks
// to reset, Shift+arrow moves in bigger steps.
export function Splitter({
  orientation,
  onDrag,
  onDoubleClick,
  label,
}: {
  // "vertical" = the handle is vertical, user drags horizontally (resizes width)
  // "horizontal" = the handle is horizontal, user drags vertically (resizes height)
  orientation: "vertical" | "horizontal";
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
  label?: string;
}) {
  const last = useRef(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    last.current = orientation === "vertical" ? e.clientX : e.clientY;

    const move = (ev: PointerEvent) => {
      const cur = orientation === "vertical" ? ev.clientX : ev.clientY;
      const delta = cur - last.current;
      last.current = cur;
      if (delta !== 0) onDrag(delta);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    if (orientation === "vertical") {
      if (e.key === "ArrowLeft") { e.preventDefault(); onDrag(-step); }
      else if (e.key === "ArrowRight") { e.preventDefault(); onDrag(step); }
    } else {
      if (e.key === "ArrowUp") { e.preventDefault(); onDrag(-step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); onDrag(step); }
    }
    if ((e.key === "Home" || e.key === "Enter") && onDoubleClick) {
      e.preventDefault();
      onDoubleClick();
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      aria-label={label ?? (orientation === "vertical" ? "Resize panel width" : "Resize panel height")}
      // WAI-ARIA: a focusable separator is a "window splitter" and requires
      // aria-valuenow. We don't track the exact percentage (the parent owns
      // px width), so 50 is a stable placeholder that tells assistive tech
      // "this is a resizer, mid-range by default." Re-thread the real value
      // if we ever expose the numeric panel size via props.
      aria-valuenow={50}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      className={
        orientation === "vertical"
          ? "group relative w-px shrink-0 cursor-col-resize bg-border transition hover:bg-accent/50 focus:outline-none focus-visible:bg-accent/70"
          : "group relative h-px shrink-0 cursor-row-resize bg-border transition hover:bg-accent/50 focus:outline-none focus-visible:bg-accent/70"
      }
    >
      {/* Widen the hit area without bloating the visible line */}
      <span
        className={
          orientation === "vertical"
            ? "absolute inset-y-0 -left-1 -right-1"
            : "absolute inset-x-0 -top-1 -bottom-1"
        }
      />
    </div>
  );
}
