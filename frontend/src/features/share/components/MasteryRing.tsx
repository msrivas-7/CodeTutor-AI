import type { ShareMastery } from "../../../api/client";

// Phase 21C: mastery indicator next to the author line on the share
// artifact. Replaces the prior "gold/silver/bronze coin" idea — coins
// are vanity-trophy semantics; rings are house grammar (Activity-ring
// lineage, matches the streak chip).
//
// One stroked circle, color encodes tier:
//   strong → gilt (the new --color-gilt: 217 178 105)
//   okay   → silver (rgb(176 184 196))
//   shaky  → bronze (rgb(180 132 96))
//
// Size param defaults to 14px (matches the OG artifact); the in-page
// preview uses the same default so the artifact and the page tell the
// same visual story at the same scale.

const TIER_COLOR: Record<ShareMastery, string> = {
  strong: "rgb(217 178 105)", // --color-gilt
  okay: "rgb(176 184 196)",
  shaky: "rgb(180 132 96)",
};

interface MasteryRingProps {
  mastery: ShareMastery;
  size?: number;
  className?: string;
}

export function MasteryRing({
  mastery,
  size = 14,
  className,
}: MasteryRingProps) {
  const stroke = TIER_COLOR[mastery];
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${stroke}`,
        flexShrink: 0,
      }}
    />
  );
}

export function masteryLabel(mastery: ShareMastery): string {
  if (mastery === "strong") return "Completed confidently";
  if (mastery === "okay") return "Lesson completed";
  return "Kept going and finished";
}
