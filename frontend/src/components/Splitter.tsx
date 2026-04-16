import { useRef } from "react";

// Lightweight drag handle — reports pointer delta to the parent, which owns
// the width/height state. Uses pointer events (+ pointer capture via the
// document-level listener) so drags work across monitors and outside the
// bounds of the handle itself.
export function Splitter({
  orientation,
  onDrag,
  onDoubleClick,
}: {
  // "vertical" = the handle is vertical, user drags horizontally (resizes width)
  // "horizontal" = the handle is horizontal, user drags vertically (resizes height)
  orientation: "vertical" | "horizontal";
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
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
    // Keep the resize cursor + disable text selection across the whole page
    // for the duration of the drag so it feels solid.
    document.body.style.cursor =
      orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
      className={
        orientation === "vertical"
          ? "group relative w-px shrink-0 cursor-col-resize bg-border transition hover:bg-accent/50"
          : "group relative h-px shrink-0 cursor-row-resize bg-border transition hover:bg-accent/50"
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
