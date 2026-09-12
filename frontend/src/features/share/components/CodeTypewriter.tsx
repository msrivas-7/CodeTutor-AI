import { useEffect, useRef, useState } from "react";
import { codeRevealTimeline, revealedCodeLength } from "./codeRevealTiming";

// Phase 21C: 4-color tokenizer + typewriter for the SharePage. Mirrors
// backend/src/services/share/og/OgArtifact.tsx so the page reads as the
// same artifact the OG card promised — same syntax roles, line breaks and
// truncation. Browser comments consume the readable public faint role rather
// than the fixed image palette; export artwork keeps its separate owner.
//
// Pacing — logarithmic deceleration, not uniform. Uniform 18ms/char
// drags. Real film typesetting decelerates: the eye scans the first
// line fast, then *reads* the punchline.
//   First 30% of chars: 8ms/char
//   Middle 40%:        14ms/char
//   Final 30%:         22ms/char
// Long snippets compress this same cadence to at most five seconds.

const KEYWORDS = new Set([
  "def", "return", "if", "else", "elif", "for", "while", "in", "and", "or", "not",
  "class", "import", "from", "as", "True", "False", "None", "lambda", "with",
  "try", "except", "finally", "raise", "pass", "break", "continue", "yield",
  "global", "nonlocal", "is", "del", "assert", "async", "await",
]);

interface Token {
  text: string;
  kind: "kw" | "str" | "cmt" | "plain";
}

function tokenizeLine(line: string): Token[] {
  const cmtIdx = line.indexOf("#");
  if (cmtIdx === 0) return [{ text: line, kind: "cmt" }];
  if (cmtIdx > 0) {
    const head = line.slice(0, cmtIdx);
    const tail = line.slice(cmtIdx);
    return [...tokenizeLine(head), { text: tail, kind: "cmt" }];
  }
  const out: Token[] = [];
  let i = 0;
  let buf = "";
  const flushBuf = () => {
    if (!buf) return;
    const parts = buf.split(/(\b)/);
    for (const p of parts) {
      if (KEYWORDS.has(p)) out.push({ text: p, kind: "kw" });
      else if (p) out.push({ text: p, kind: "plain" });
    }
    buf = "";
  };
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      flushBuf();
      const quote = c;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j++;
      out.push({ text: line.slice(i, j + 1), kind: "str" });
      i = j + 1;
      continue;
    }
    buf += c;
    i++;
  }
  flushBuf();
  return out;
}

function tokenColor(kind: Token["kind"]): string {
  if (kind === "kw") return "rgb(56 189 248)";
  if (kind === "str") return "rgba(52 211 153 / 0.85)";
  if (kind === "cmt") return "rgb(var(--color-faint))";
  return "rgba(230 236 245 / 0.92)";
}

interface CodeTypewriterProps {
  code: string;
  /** Owned by the share reveal so resuming motion never rewinds visible code. */
  reduceMotion: boolean;
  /** Delay before typing starts (ms from mount). */
  startDelayMs?: number;
  /** Max number of source lines kept; the rest is replaced by a single
   *  "…" line. Matches the OG artifact's MAX_LINES = 10. */
  maxLines?: number;
  /** Called once when the typewriter finishes (lands on the final
   *  rendered length). Reduced-motion users see the call fire on the
   *  next animation frame after mount. */
  onDone?: () => void;
}

export function CodeTypewriter({
  code,
  reduceMotion: reduce,
  startDelayMs = 0,
  maxLines = 10,
  onDone,
}: CodeTypewriterProps) {
  // Truncate first — the typewriter only ever types the visible slice.
  const allLines = code.split("\n");
  const lines = allLines.slice(0, maxLines);
  const truncated = allLines.length > maxLines;
  const visible = lines.join("\n");

  const [revealed, setRevealed] = useState(reduce ? visible.length : 0);

  // onDone is captured in a ref so the typewriter effect doesn't
  // restart every time the parent re-renders (which it does — the
  // SharePage's phase machine triggers re-renders during the reveal,
  // and a fresh onDone reference on each render would wipe `revealed`
  // back to 0 mid-typing).
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    // Reset the visible count when the source code changes — without
    // this, navigating between adjacent shares (or any code-prop swap
    // mid-typing) leaves `revealed` at the previous count and renders
    // `visible.slice(0, oldCount)` on the new string, causing a one-
    // frame flash of the wrong code prefix.
    setRevealed(reduce ? visible.length : 0);
    if (reduce) {
      // Reduced-motion: instant render, fire onDone next frame so
      // downstream timeline beats keep their ordering.
      const id = requestAnimationFrame(() => onDoneRef.current?.());
      return () => cancelAnimationFrame(id);
    }
    if (visible.length === 0) {
      onDoneRef.current?.();
      return;
    }
    const deadlines = codeRevealTimeline(visible.length);
    const startsAt = performance.now() + startDelayMs;
    let frame: number;
    const tick = (now: number) => {
      const count = revealedCodeLength(deadlines, now - startsAt);
      setRevealed(count);
      if (count === visible.length) {
        onDoneRef.current?.();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, startDelayMs, reduce]);

  // Render: walk the visible string char-by-char, but maintain
  // line/token structure so colors stay correct as the cursor moves.
  // Strategy: compute token list per line (full), then for each render
  // pass include only the prefix of (line+separators) up to `revealed`.
  const slice = reduce ? visible : visible.slice(0, revealed);
  const renderedLines = slice.split("\n");
  const showCursor = !reduce && revealed < visible.length;

  return (
    // Phase 22E: tightened mobile font from 15px → 13.5px and slightly
    // tighter leading. At iPhone 13 width (390px) inside the share
    // panel's p-4 padding, ~38 chars of 13.5px mono fit without
    // horizontal scroll on most lessons. The parent wraps in
    // overflow-x-auto so the very rare 50+ char line still renders
    // intact and the user can swipe to read.
    <div className="font-mono text-[13.5px] leading-[1.5] sm:text-[17px] sm:leading-[1.55] md:text-[19px]">
      {/* Mount all line boxes immediately: typing must not push the CTA down. */}
      {lines.map((fullLine, lineIdx) => {
        // Full line — drives the color tokens. Then we trim each token
        // text to fit the rendered prefix.
        const tokens = tokenizeLine(fullLine);
        let remaining = renderedLines[lineIdx]?.length ?? 0;
        return (
          <div key={lineIdx} className="min-h-[1.55em] whitespace-nowrap">
            {tokens.length === 0 && remaining === 0 ? (
              <span>&nbsp;</span>
            ) : (
              tokens.map((t, j) => {
                if (remaining <= 0) return null;
                const text =
                  t.text.length <= remaining ? t.text : t.text.slice(0, remaining);
                remaining -= text.length;
                return (
                  <span
                    key={j}
                    style={{
                      color: tokenColor(t.kind),
                      whiteSpace: "pre",
                      fontStyle: t.kind === "cmt" ? "italic" : "normal",
                    }}
                  >
                    {text}
                  </span>
                );
              })
            )}
            {/* Cursor — render only on the last currently-typed line
                while the typewriter is active. */}
            {showCursor && lineIdx === renderedLines.length - 1 && (
              <span
                aria-hidden="true"
                className="ml-px inline-block animate-pulse"
                style={{
                  width: "0.55em",
                  height: "1em",
                  verticalAlign: "text-bottom",
                  backgroundColor: "rgb(56 189 248)",
                  opacity: 0.8,
                }}
              />
            )}
          </div>
        );
      })}
      {truncated && (
        <div
          className="mt-1 text-[13px] text-faint sm:text-[15px]"
          style={{ visibility: reduce || revealed >= visible.length ? "visible" : "hidden" }}
        >…</div>
      )}
    </div>
  );
}
