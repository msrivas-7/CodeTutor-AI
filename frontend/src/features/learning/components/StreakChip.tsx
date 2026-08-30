import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStreak } from "../../../state/useStreak";
import { useDisableStreaks } from "../../../state/preferencesStore";
import { StreakDetailPopover } from "./StreakDetailPopover";

// Phase 21B: streak chip — single component, parameterized escalation.
//
// Design (per /Users/mehul/.claude/plans/hazy-wishing-wren.md "Experience-grade
// design notes — the visual metaphor"):
//
//   - Forming arc / week-ring (NOT a flame). Activity-Ring lineage.
//     One segment closes per consecutive day, capped at 7. The ring
//     "closes" at Day 7 and the integer keeps climbing.
//   - Single chip transforms by parameter (border, ink, glow, stroke
//     width); never variant-swaps.
//   - Day 0 = render nothing. Don't lecture.
//   - Day 1 = muted ember, "Day 1." (period, Fraunces). It's a name
//     tag, not a trophy.
//   - Day 3+ = accent treatment + soft glow.
//   - Day 7 (ring closes) = success treatment + brighter glow.
//   - Day 30+ = arc segments fill (no shape change).
//   - Day 100+ = inner arc inherits violet token.
//   - Day 365+ = gold hairline seam between outer success and inner violet.
//   - Freeze active = persistent frosted second concentric arc behind
//     the streak ring. Visible until the rolling 7-day window closes.
//   - At-risk = ring breathes (opacity 0.7 ↔ 1.0 sinusoid, MATERIAL_EASE,
//     2400ms loop). NO color change. Companion, not gas-station amber.
//   - Reduced-motion = static at opacity-0.85 inner shadow instead of
//     the breath; everything else identical.

const ARC_SIZE = 18; // SVG viewBox 18×18, ~16px chip glyph
const ARC_RADIUS = 7;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS; // ~43.98
const SEGMENTS = 7;

interface ChipProps {
  /** Optional override for tests / Storybook-style rendering. Real callers
   * use the streak from the hook. */
  override?: {
    current: number;
    longest: number;
    isAtRisk: boolean;
    freezeActive: boolean;
  };
  /** Compact mode for crowded surfaces (lesson/editor header peer to
   * FreeTierPill). Default = full size for the dashboard. */
  compact?: boolean;
  /** When false, the chip is a passive display — no click-to-expand
   * popover, no hover state. Used inside contexts like
   * LessonCompletePanel where the chip is part of a celebration
   * moment, not a stats-lookup affordance. Default = true. */
  interactive?: boolean;
  /** When true, render the chip larger and more decorative for
   * high-affect surfaces (lesson-complete celebration). Brighter
   * glow, larger arc + text. Default = false (toolbar treatment). */
  prominent?: boolean;
}

interface ResolvedTier {
  border: string;
  ink: string;
  glowStyle: string;
  arcStroke: number;
  arcColor: string;
  arcFill: boolean;
  innerArcColor: string | null; // Day 100+ violet inner
  hairline: boolean; // Day 365+ gold seam
  filledRing: boolean; // Day 30+ — arc segments fill
}

function resolveTier(current: number): ResolvedTier {
  if (current >= 365) {
    return {
      border: "border-success/40",
      ink: "text-ink",
      glowStyle: "0 0 18px -6px rgba(52, 211, 153, 0.32)",
      arcStroke: 1.5,
      arcColor: "rgb(52 211 153)",
      arcFill: true,
      innerArcColor: "rgb(192 132 252)",
      hairline: true,
      filledRing: true,
    };
  }
  if (current >= 100) {
    return {
      border: "border-success/35",
      ink: "text-ink",
      glowStyle: "0 0 16px -6px rgba(52, 211, 153, 0.30)",
      arcStroke: 1.5,
      arcColor: "rgb(52 211 153)",
      arcFill: true,
      innerArcColor: "rgb(192 132 252)",
      hairline: false,
      filledRing: true,
    };
  }
  if (current >= 30) {
    return {
      border: "border-success/35",
      ink: "text-ink",
      glowStyle: "0 0 16px -6px rgba(52, 211, 153, 0.30)",
      arcStroke: 1.5,
      arcColor: "rgb(52 211 153)",
      arcFill: true,
      innerArcColor: null,
      hairline: false,
      filledRing: true,
    };
  }
  if (current >= 7) {
    return {
      border: "border-success/35",
      ink: "text-ink",
      glowStyle: "0 0 16px -6px rgba(52, 211, 153, 0.30)",
      arcStroke: 1.5,
      arcColor: "rgb(52 211 153)",
      arcFill: false,
      innerArcColor: null,
      hairline: false,
      filledRing: false,
    };
  }
  if (current >= 3) {
    return {
      border: "border-accent/30",
      ink: "text-ink",
      glowStyle: "0 0 12px -6px rgba(56, 189, 248, 0.25)",
      arcStroke: 1,
      arcColor: "rgb(56 189 248)",
      arcFill: false,
      innerArcColor: null,
      hairline: false,
      filledRing: false,
    };
  }
  // Day 1–2: visible but not loud. "Day 1." with period, soft accent
  // ring + light glow so first-time users actually NOTICE the chip
  // instead of dismissing it as inactive chrome. The escalation tiers
  // above turn it up further; this is the discoverable baseline.
  return {
    border: "border-accent/30",
    ink: "text-ink",
    glowStyle: "0 0 10px -6px rgba(56, 189, 248, 0.22)",
    arcStroke: 1,
    arcColor: "rgb(56 189 248)",
    arcFill: false,
    innerArcColor: null,
    hairline: false,
    filledRing: false,
  };
}

/** Compute the SVG arc dasharray for `closedSegments / SEGMENTS` of the ring. */
function arcDashArray(closedSegments: number): string {
  const filled = (ARC_CIRCUMFERENCE * Math.min(closedSegments, SEGMENTS)) / SEGMENTS;
  const empty = ARC_CIRCUMFERENCE - filled;
  return `${filled} ${empty}`;
}

interface ArcProps {
  segmentsClosed: number;
  tier: ResolvedTier;
  freezeActive: boolean;
  isAtRisk: boolean;
}

function StreakArc({ segmentsClosed, tier, freezeActive, isAtRisk }: ArcProps) {
  return (
    <svg
      width={ARC_SIZE}
      height={ARC_SIZE}
      viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}
      aria-hidden="true"
      className={`shrink-0 ${isAtRisk ? "animate-streakBreath motion-reduce:animate-none motion-reduce:opacity-[0.85]" : ""}`}
      style={{ overflow: "visible" }}
    >
      {/* Track — faint full circle so the partial arc reads as progress
          rather than a stray crescent. */}
      <circle
        cx={ARC_SIZE / 2}
        cy={ARC_SIZE / 2}
        r={ARC_RADIUS}
        fill="none"
        stroke="rgb(148 163 184 / 0.18)"
        strokeWidth={tier.arcStroke}
      />
      {/* Freeze: persistent frosted second arc behind the streak ring. */}
      {freezeActive && (
        <circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          r={ARC_RADIUS - 2}
          fill="none"
          stroke="rgb(186 230 253 / 0.5)"
          strokeWidth={1}
        />
      )}
      {/* Filled segments — start from 12 o'clock, sweep clockwise. */}
      <circle
        cx={ARC_SIZE / 2}
        cy={ARC_SIZE / 2}
        r={ARC_RADIUS}
        fill={tier.arcFill ? tier.arcColor : "none"}
        fillOpacity={tier.arcFill ? 0.18 : 0}
        stroke={tier.arcColor}
        strokeWidth={tier.arcStroke}
        strokeDasharray={arcDashArray(segmentsClosed)}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(-90 ${ARC_SIZE / 2} ${ARC_SIZE / 2})`}
      />
      {/* Day 100+: violet inner arc. */}
      {tier.innerArcColor && (
        <circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          r={ARC_RADIUS - 3}
          fill="none"
          stroke={tier.innerArcColor}
          strokeWidth={1}
          strokeOpacity={0.7}
        />
      )}
      {/* Day 365: gold hairline seam between outer success + inner violet. */}
      {tier.hairline && (
        <circle
          cx={ARC_SIZE / 2}
          cy={ARC_SIZE / 2}
          r={ARC_RADIUS - 1.5}
          fill="none"
          stroke="rgb(217 178 105)"
          strokeWidth={0.6}
          strokeOpacity={0.85}
        />
      )}
    </svg>
  );
}

export function StreakChip({ override, compact, interactive = true, prominent = false }: ChipProps) {
  const { streak } = useStreak();
  // Phase 27: per-user opt-out for the streak system. When the
  // preference flag is on we render nothing — same shape as the day-0
  // fallback below. `override` (used by cinematic frame snapshots and
  // tests) bypasses the flag so e2e fixtures stay deterministic.
  const disableStreaks = useDisableStreaks();
  const data = override
    ? { current: override.current, longest: override.longest, isAtRisk: override.isAtRisk, freezeActive: override.freezeActive }
    : streak
      ? { current: streak.current, longest: streak.longest, isAtRisk: streak.isAtRisk, freezeActive: streak.freezeActive }
      : null;
  // This gate must be available to the always-declared measurement effect;
  // hooks cannot move below the day-zero early return.
  const isInteractive = !override && !!streak && interactive;

  // Iter-3 (post-feedback): chip is click-to-expand into a dynamic-island
  // detail popover. Click toggles open; click outside / Esc closes from
  // inside the popover. Anchored to the chip's bounding rect so the
  // popover lands directly beneath, regardless of which toolbar the chip
  // is rendered in. `override` is for tests / cinematic frame snapshots
  // and never opens the popover.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // Keep anchorRect fresh while the popover is open. Without this, a
  // window resize, sidebar collapse, or tablet rotation would leave
  // the popover anchored to where the chip USED to be — visually
  // detached from where it actually is now. ResizeObserver tracks the
  // chip's bounding box; window resize events catch the case where
  // the chip didn't change size but its position shifted.
  //
  // IMPORTANT: this useEffect MUST be declared above any conditional
  // early-return so React's hook count is stable across renders. The
  // effect's body short-circuits internally when not open or not
  // mounted, so the no-op cost is trivial.
  useLayoutEffect(() => {
    if (!isInteractive || !anchorRef.current) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) {
        // The painted pill lives in a document.body portal, so a responsive
        // `display: none` ancestor cannot hide it for us. Treat the in-flow
        // anchor as the visibility authority: no rendered anchor means no
        // portaled surface and no open dialog stranded outside its layout.
        setAnchorRect(null);
        setOpen(false);
        return;
      }
      const nextRect = anchor.getBoundingClientRect();
      if (nextRect.width <= 0 || nextRect.height <= 0) {
        setAnchorRect(null);
        setOpen(false);
        return;
      }
      setAnchorRect(nextRect);
    };
    update();
    const closeForViewportChange = () => {
      setOpen(false);
      window.requestAnimationFrame(update);
    };
    const closeForWindowBlur = () => setOpen(false);
    const closeForVisibilityLoss = () => {
      if (document.visibilityState !== "visible") setOpen(false);
    };
    const anchorObserver = new ResizeObserver(update);
    anchorObserver.observe(anchorRef.current);
    window.addEventListener("resize", closeForViewportChange);
    // Safari's native application fullscreen is outside the Fullscreen API,
    // so viewport and focus signals are recovery paths when browser chrome
    // consumes the transition. DOM fullscreenchange covers webpage fullscreen.
    window.visualViewport?.addEventListener("resize", closeForViewportChange);
    window.addEventListener("blur", closeForWindowBlur);
    document.addEventListener("visibilitychange", closeForVisibilityLoss);
    window.addEventListener("scroll", update, true);
    document.addEventListener("fullscreenchange", closeForViewportChange);
    document.addEventListener("webkitfullscreenchange", closeForViewportChange);
    return () => {
      anchorObserver.disconnect();
      window.removeEventListener("resize", closeForViewportChange);
      window.visualViewport?.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("blur", closeForWindowBlur);
      document.removeEventListener("visibilitychange", closeForVisibilityLoss);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("fullscreenchange", closeForViewportChange);
      document.removeEventListener("webkitfullscreenchange", closeForViewportChange);
    };
  }, [isInteractive]);

  // Day 0 — render nothing. Don't lecture.
  if (!data || data.current === 0) return null;
  // Phase 27 opt-out — streak system fully hidden for this user.
  // `override` bypasses (e2e + cinematic snapshots) by virtue of
  // its data path skipping useStreak entirely above; we still
  // gate here so a non-override caller respects the user choice.
  if (!override && disableStreaks) return null;

  const tier = resolveTier(data.current);
  const segmentsClosed = Math.min(data.current, SEGMENTS);
  // Iter-2 (post-feedback): always "{N}-day streak". The earlier "Day 1."
  // / "Day 2" minimal forms read as cryptic to first-time learners — the
  // chip in the toolbar needs to explain itself at a glance, no tooltip
  // hover required.
  const label = `${data.current}-day streak`;

  // Iter-4 (post-feedback): `prominent` mode for high-affect surfaces
  // like the LessonCompletePanel — bigger glyph, bigger text, more
  // generous padding. Defaults to the toolbar treatment.
  const padding = prominent
    ? "px-3 py-1"
    : compact ? "px-1.5 py-[1px]" : "px-2 py-[1px]";
  const fontSize = prominent
    ? "text-[13px]"
    : compact ? "text-[10px]" : "text-[11px]";
  const collapsedInset = prominent ? 12 : compact ? 6 : 8;

  // Tooltip layers:
  //   - Freeze active: "Grace · yesterday held."
  //   - At-risk: "Today's lesson keeps your week going."
  //   - Default: "{N}-day streak · longest {longest}".
  const tooltip = data.freezeActive
    ? `Grace · yesterday held. Streak: ${data.current} days.`
    : data.isAtRisk
      ? `Today's lesson keeps your ${data.current}-day streak going.`
      : `${data.current}-day streak · longest ${data.longest}`;

  const identity = (
    <>
      <StreakArc
        segmentsClosed={segmentsClosed}
        tier={tier}
        freezeActive={data.freezeActive}
        isAtRisk={data.isAtRisk}
      />
      <span>{label}</span>
    </>
  );

  const surfaceClasses = `relative inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-elevated/40 ${padding} ${fontSize} font-medium tabular-nums ${tier.border} ${tier.ink} transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isInteractive ? "cursor-pointer hover:bg-elevated/60" : "cursor-default"}`;

  return (
    <>
      {isInteractive ? (
        <span ref={anchorRef} className="relative inline-flex shrink-0 align-middle">
          <span aria-hidden="true" className={`${surfaceClasses} invisible`}>
            {identity}
          </span>
        </span>
      ) : (
        <button
            ref={buttonRef}
            type="button"
            // Implicit role="button" from <button> tag is correct — earlier
            // iter set role="status" (which is a live-region role for
            // passive announcements) which overrode the button semantics
            // and confused screen readers. aria-expanded is correct only
            // for interactive variants; passive renders set it undefined
            // so AT doesn't announce a stale collapsed/expanded state.
            aria-label={tooltip}
            aria-expanded={isInteractive ? open : undefined}
            aria-haspopup={isInteractive ? "dialog" : undefined}
            title={tooltip}
            disabled
            // Touch target a11y (Batch 1 #5): the visible chip is intentionally
            // compact (~22-26px tall) so it doesn't crowd the toolbar, but
            // WCAG / Apple HIG want ≥44x44 for tap targets. We extend the
            // hit area with a `::before` pseudo that sits ~10px around the
            // chip — invisible, but a child of the button so clicks on it
            // count as clicks on the button. `prominent` mode is already
            // ~44px tall so it skips the expansion.
            className={surfaceClasses}
            style={{ boxShadow: tier.glowStyle, letterSpacing: "0.01em" }}
          >
            {identity}
          </button>
      )}
      {isInteractive && streak && (
        <StreakDetailPopover
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          streak={streak}
          anchorRect={anchorRect}
          invokerRef={buttonRef}
          identity={identity}
          tooltip={tooltip}
          glowStyle={tier.glowStyle}
          identityClassName={fontSize}
          collapsedInset={collapsedInset}
          borderClassName={tier.border}
        />
      )}
      <style>{`
        @keyframes streakBreath {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1; }
        }
        .animate-streakBreath { animation: streakBreath 2400ms cubic-bezier(0.4, 0, 0.2, 1) infinite; }
      `}</style>
    </>
  );
}
