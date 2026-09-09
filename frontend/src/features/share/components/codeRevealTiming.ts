/** Preserve the authored three-speed cadence, compressing only long reveals. */
export const MAX_CODE_REVEAL_MS = 5000;

export function codeRevealTimeline(length: number): number[] {
  let elapsed = 0;
  const deadlines = Array.from({ length }, (_, index) => {
    const progress = index / length;
    elapsed += progress < 0.3 ? 8 : progress < 0.7 ? 14 : 22;
    return elapsed;
  });
  if (elapsed <= MAX_CODE_REVEAL_MS) return deadlines;
  return deadlines.map(time => time / elapsed * MAX_CODE_REVEAL_MS);
}

/** Absolute time prevents slow frames or a hidden tab accumulating timer drift. */
export function revealedCodeLength(deadlines: readonly number[], elapsedMs: number): number {
  let low = 0;
  let high = deadlines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (deadlines[middle] <= elapsedMs) low = middle + 1;
    else high = middle;
  }
  return low;
}
