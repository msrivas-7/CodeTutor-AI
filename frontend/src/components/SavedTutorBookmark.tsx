import { useState } from "react";

// Phase 21A: bookmark/save toggle on assistant tutor messages.
//
// Iteration 2 (post-feedback): the icon was originally hidden until the
// message-row was hovered, which made it undiscoverable. Apple-school
// restraint pushed too far. New behavior:
//   - Always visible at low opacity (~0.4) so users see it exists.
//   - Hover ramps to 0.95.
//   - Saved (filled, accent) = opacity-1 always.
// Position is now inline at the message's bottom-right chrome row (the
// parent renders this in a flex row alongside any usage chip), not
// absolute on top of the response text.
//
// Click feedback: bottom-up clip-path fill (80ms HOUSE_EASE) + 1-frame
// scale 1.0 → 1.06 → 1.0 (160ms). NO RingPulse — saving is a librarian
// act, not a celebration.
//
// Reduced-motion: instant fill swap, no scale; meaning preserved by
// the fill alone.

interface SavedTutorBookmarkProps {
  saved: boolean;
  onToggle: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}

const HOUSE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function SavedTutorBookmark({
  saved,
  onToggle,
  ariaLabel,
  disabled,
}: SavedTutorBookmarkProps) {
  const [pressing, setPressing] = useState(false);
  const [hover, setHover] = useState(false);

  const colorClass = saved ? "text-accent" : "text-muted";
  const restingOpacity = saved ? 1 : hover ? 0.95 : 0.4;
  const fillInset = saved ? "inset(0 0 0 0)" : "inset(100% 0 0 0)";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        setPressing(true);
        window.setTimeout(() => setPressing(false), 170);
        onToggle();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      disabled={disabled}
      aria-label={ariaLabel ?? (saved ? "Remove from saved" : "Save tutor message")}
      title={saved ? "Saved · click to remove" : "Save this message"}
      aria-pressed={saved}
      className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-opacity ${colorClass} ${disabled ? "cursor-not-allowed" : "cursor-pointer"} focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none`}
      style={{
        opacity: restingOpacity,
        transitionDuration: "140ms",
        transitionTimingFunction: HOUSE_EASE,
        transform: pressing ? "scale(1.06)" : "scale(1)",
        transitionProperty: "opacity, transform",
      }}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="overflow-visible"
      >
        <path d="M3.5 2h9a.5.5 0 0 1 .5.5v11.4a.3.3 0 0 1-.48.24L8 10.5l-4.52 3.64A.3.3 0 0 1 3 13.9V2.5a.5.5 0 0 1 .5-.5z" />
        <path
          d="M3.5 2h9a.5.5 0 0 1 .5.5v11.4a.3.3 0 0 1-.48.24L8 10.5l-4.52 3.64A.3.3 0 0 1 3 13.9V2.5a.5.5 0 0 1 .5-.5z"
          fill="currentColor"
          stroke="none"
          style={{
            clipPath: fillInset,
            WebkitClipPath: fillInset,
            transition: `clip-path 80ms ${HOUSE_EASE}, -webkit-clip-path 80ms ${HOUSE_EASE}`,
          }}
        />
      </svg>
    </button>
  );
}
