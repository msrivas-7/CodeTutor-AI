import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { HOUSE_EASE } from "../../../components/cinema/easing";

// Phase 22C — MatchCutHero. (Phase 27: Python content, was JS palindrome.)
//
// The opening motion piece on the marketing page. The story arc is
// "stuck → ask" — code types in, holds, the tutor's question fades up
// underneath. Plays once and holds; no loop. The director's note: a
// looping motion piece reads as a GIF on second pass, dilutes the
// magic. One beat, generous pacing, then the still frame holds.
//
//   0.0  – 0.4s    caret blinks twice on a dark glass panel
//   0.4  – 3.4s    responsive Python example types in:
//                      name = "Maya"
//                      points = 100
//                      message = (
//                        name + " earned "
//                        + points + " points!"
//                      )
//                      print(message)
//   3.4  – 5.2s    READ PAUSE (1.8s). Code stays still, no caret.
//                  Viewer scans the body and thinks "looks fine to me."
//   5.2  – 5.8s    iris sweep (subtle horizontal contract — film cut
//                  punctuation between the code-only beat and the
//                  tutor-question beat)
//   5.8  – 7.2s    tutor question fades up below the code:
//                      Why does this fail when points is 100?
//   7.2  – 8.4s    scale-exhale settle (1.0 → 1.005 → 1.0)
//   8.4s+          HOLD forever on the final state — code + tutor
//                  question both visible, viewer absorbs the question
//                  at their own pace
//
// The match-cut grammar: a coding moment cuts to the question that
// turns the moment into learning. The visitor's brain spots the
// str + int TypeError on its own once the tutor frames the question:
// Python's + means "concatenate" for strings and "add" for numbers,
// and it refuses to bridge the two — the canonical week-1 surprise.
//
// The vignettes in §2 ("How it works") complete the story: the Read
// beat introduces the trim concept, the Ask beat shows the tutor
// guiding the learner toward it, the Check beat shows the corrected
// code passing. The marketing page is one coherent narrative arc.
//
// Hero panel embellishments (premium-by-restraint):
//   - 3D parallax tilt: the panel tilts a few degrees toward the
//     cursor, giving it apparent thickness. Framer Motion springs
//     soften the response so it doesn't feel jittery.
//   - Cursor-following key-light: a soft radial glow follows the
//     cursor across the panel, so the panel reads as a lit object
//     in a 3D scene rather than a flat card.
//   - Reduced-motion: tilt + key-light + scheduled beats all skipped.
//     The panel renders the FINAL state statically — closed function
//     + tutor bubble visible — so the meaning survives.

// Beat boundaries in ms from mount. The implicit pauses between beats
// are the point — the viewer's eye needs time to settle after each
// layer arrives.
const BEAT = {
  caret: { start: 0, end: 400 },
  typing: { start: 400, end: 3400 }, // ~3.0s for ~90 chars (4-line code)
  // READ PAUSE 3400 → 5200 (1.8s, code stays still, no caret)
  iris: { start: 5200, end: 5800 },
  bubble: { start: 5800, end: 7200 },
  exhale: { start: 7200, end: 8400 },
  // HOLD 8400 → forever
} as const;

type Phase = "caret" | "typing" | "iris" | "bubble" | "exhale" | "hold";

// Canonical week-1 Python TypeError. Looks clean — name a string, name
// a number, glue them together with `+`, print. Fails because Python's
// `+` operator demands both sides be the same type: it concatenates
// strings or adds numbers, but refuses to bridge str + int. The fix the
// tutor will eventually walk the learner toward is `str(points)` (or
// f-strings later). The expression is split inside parentheses so it stays
// valid Python while remaining readable on a 360px phone.
const CODE_LINES: readonly string[] = [
  'name = "Maya"',
  "points = 100",
  "message = (",
  '  name + " earned "',
  '  + points + " points!"',
  ")",
  "print(message)",
];
const FULL_CODE = CODE_LINES.join("\n");
const TUTOR_QUESTION = "Why does this fail when points is 100?";

// Logarithmic typewriter pacing — same curve as SharePage's
// CodeTypewriter, tuned for ~3s total over ~80 chars. Faster start,
// slow settle. Plays once per loop iteration.
function tickFor(i: number, total: number): number {
  const pct = i / Math.max(1, total);
  if (pct < 0.3) return 18;
  if (pct < 0.7) return 32;
  return 48;
}

/**
 * The match-cut hero panel. Plays once on mount (~8.4s of choreography),
 * then holds the final state. Sized to fit between the hero claim and
 * the CTA in the marketing page composition.
 */
export function MatchCutHero({ staticMotion = false }: { staticMotion?: boolean }) {
  const reduce = useReducedMotion();
  const staticMode = Boolean(reduce || staticMotion);
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(staticMode ? "hold" : "caret");
  // `typed` is the count of characters revealed across the multi-line
  // FULL_CODE string (newlines included). Reduced-motion shows full.
  const [typed, setTyped] = useState(staticMode ? FULL_CODE.length : 0);

  // Beat scheduler. Runs ONCE on mount — the panel plays through the
  // beats and then holds the final state. No loop; per the director's
  // note, looping motion reads as a GIF after the second pass and
  // dilutes the magic. Aborts cleanly on unmount via the cancel flag
  // + clearTimeout sweep.
  //
  // `useReducedMotion` returns null on first render and resolves to
  // boolean asynchronously, which means the useState initializers above
  // can't reliably seed the final state for reduced-motion users. So
  // when `reduce` resolves to true, we explicitly snap state to its
  // final values here (no scheduling needed).
  useEffect(() => {
    if (staticMode) {
      setPhase("hold");
      setTyped(FULL_CODE.length);
      return;
    }
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const schedule = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timeouts.push(t);
    };

    // Reset state at mount.
    setPhase("caret");
    setTyped(0);

    // Start the typewriter at BEAT.typing.start. Types through the
    // full multi-line code with logarithmic pacing.
    schedule(BEAT.typing.start, () => {
      setPhase("typing");
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        i += 1;
        setTyped(i);
        if (i < FULL_CODE.length) {
          const t = setTimeout(tick, tickFor(i, FULL_CODE.length));
          timeouts.push(t);
        }
      };
      const t = setTimeout(tick, tickFor(0, FULL_CODE.length));
      timeouts.push(t);
    });

    schedule(BEAT.iris.start, () => setPhase("iris"));
    schedule(BEAT.bubble.start, () => setPhase("bubble"));
    schedule(BEAT.exhale.start, () => setPhase("exhale"));
    schedule(BEAT.exhale.end, () => setPhase("hold"));

    return () => {
      cancelled = true;
      timeouts.forEach((t) => clearTimeout(t));
    };
  }, [staticMode]);

  // Cursor-tracked tilt + key-light. useMotionValue + spring keeps the
  // motion buttery and reactive without rendering on every mouse event.
  const cursorX = useMotionValue(0.5); // normalized 0..1 over panel
  const cursorY = useMotionValue(0.5);
  const cursorXSpring = useSpring(cursorX, { stiffness: 120, damping: 22 });
  const cursorYSpring = useSpring(cursorY, { stiffness: 120, damping: 22 });
  // Tilt range tuned to "you can see it, you can't name it." Dialed
  // down from 2.5° → 1.5° during the post-audit pass — at 2.5° the
  // panel competed for attention with the magnetic CTA's tilt and
  // the cursor key-light, all running simultaneously. 1.5° preserves
  // the sense of a lit object in 3D without the page feeling busy.
  const rotateY = useTransform(cursorXSpring, [0, 1], [-1.5, 1.5]);
  const rotateX = useTransform(cursorYSpring, [0, 1], [1.2, -1.2]);
  // Key-light layer follows the cursor in the panel's local frame.
  const lightX = useTransform(cursorXSpring, [0, 1], ["10%", "90%"]);
  const lightY = useTransform(cursorYSpring, [0, 1], ["8%", "92%"]);
  // Hoisted: useTransform inside the conditional `{!reduce && ...}` block
  // below would violate rules-of-hooks if the OS reduced-motion preference
  // flips at runtime. Color-channel triplets are inlined (the project does
  // not expose --color-accent / --color-violet as CSS custom properties).
  const keyLightBg = useTransform(
    [lightX, lightY],
    ([x, y]: (string | number)[]) =>
      // Alpha dialed from 0.22 → 0.14 in the post-audit pass — quieter
      // ambient light, lets the code typography stay the focal point.
      `radial-gradient(circle at ${x} ${y}, rgba(56, 189, 248, 0.14), transparent 55%)`,
  );

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (staticMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    cursorX.set(Math.max(0, Math.min(1, nx)));
    cursorY.set(Math.max(0, Math.min(1, ny)));
  }
  function handleMouseLeave() {
    cursorX.set(0.5);
    cursorY.set(0.5);
  }

  // Render the typed prefix across multi-line code. The slice (rendered
  // chars) is split on newlines so each line tokenizes independently
  // and the cursor can ride the most-recently-typed line. Reduced-
  // motion shows everything; non-reduced types in over the typing beat.
  const visiblePrefix = FULL_CODE.slice(0, typed);
  const renderedLines = visiblePrefix.split("\n");
  const showCaret = phase === "caret";
  const showTypingCaret = phase === "typing" && typed < FULL_CODE.length;
  const exhaleScale = phase === "exhale" ? [1, 1.005, 1] : 1;

  return (
    <motion.div
      ref={panelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      // Panel sized for breathing room — max-w-[860px] gives ~700px of
      // usable interior at md:p-10, well above what the longest code
      // line needs (~520px at 16.5px mono). text-left explicitly
      // overrides the hero section's text-center so code reads as
      // real code (left-anchored), not poetry.
      className={`relative isolate w-full max-w-[860px] overflow-hidden rounded-2xl border border-border/70 bg-panel/80 p-5 text-left shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)] sm:p-8 md:p-10 ${staticMode ? "" : "backdrop-blur-xl"}`}
      style={{
        rotateX: staticMode ? undefined : rotateX,
        rotateY: staticMode ? undefined : rotateY,
        transformStyle: staticMode ? "flat" : "preserve-3d",
        transformPerspective: staticMode ? undefined : 1200,
      }}
      // The containing hero already choreographs this panel's arrival.
      // Keep it visible from first paint so the two layers do not compound
      // into a long blank state on slower devices.
      initial={staticMode ? false : { opacity: 1, y: 12 }}
      animate={
        staticMode
          ? undefined
          : {
              opacity: 1,
              y: 0,
              scale: exhaleScale,
            }
      }
      transition={{
        opacity: { duration: 0.6, ease: HOUSE_EASE, delay: 0.1 },
        y: { duration: 0.6, ease: HOUSE_EASE, delay: 0.1 },
        scale: { duration: 1.2, ease: HOUSE_EASE },
      }}
    >
      {/* Cursor-tracked key-light. Sits behind the content but above the
          base panel — gives the panel a sense of being lit from a moving
          source. Accent color, soft falloff, low alpha so it reads as
          ambient, not "a spotlight." */}
      {!staticMode && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0 opacity-70 mix-blend-screen"
          style={{ background: keyLightBg }}
        />
      )}

      {/* Static rim light + grain — even on the static panel, atmosphere
          carries the weight. Same vocabulary as CinematicLighting but
          scoped to the panel instead of the whole stage. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(ellipse at top left, rgba(192, 132, 252, 0.10), transparent 50%)",
        }}
      />

      {/* Code block — JetBrains Mono with token-style coloring per
          line. The longest line is deliberately short enough to remain
          readable at phone size without clipping or micro typography. */}
      <div className="relative font-mono text-[13px] leading-[1.7] sm:text-[15px] md:text-[16.5px]">
        {/* Pre-rendered line slots: as `typed` advances, each slot
            fills with its share of the prefix. Empty slots reserve
            vertical space (min-h) so the layout doesn't jump. */}
        {CODE_LINES.map((_, i) => (
          <div key={i} className="min-h-[1.65em] whitespace-nowrap">
            {renderedLines[i] !== undefined && (
              <CodeLineColored line={renderedLines[i]!} />
            )}
            {/* Caret rides the most-recently-typed line during typing. */}
            {(showTypingCaret && i === renderedLines.length - 1) ||
            (showCaret && i === 0 && renderedLines.length === 0) ? (
              <BlinkingCaret />
            ) : null}
          </div>
        ))}
        {/* Caret on an empty panel during the initial caret beat. */}
        {showCaret && renderedLines.length === 0 && (
          <span className="absolute left-6 top-6">
            <BlinkingCaret />
          </span>
        )}

        {/* Iris wipe — a thin horizontal line that contracts inward
            on the iris beat. Reads as a film-cut transition, not a UI
            element. Auto-clears once the bubble is up. */}
        {!staticMode && phase === "iris" && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent"
            initial={{ scaleX: 1, opacity: 0.9 }}
            animate={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.6, ease: HOUSE_EASE }}
          />
        )}
      </div>

      {/* Tutor question — fades up + 4px translate on the bubble beat.
          The italic + accent tone marks it as a tutor voice (matches
          the lesson page's tutor message styling). The min-h reserves
          the space at mount so the panel doesn't grow when the bubble
          arrives — atmosphere stays composed. */}
      <div className="mt-6 min-h-[60px]">
        {(phase === "bubble" || phase === "exhale" || phase === "hold") && (
          <motion.div
            initial={staticMode ? undefined : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: HOUSE_EASE }}
            className="rounded-xl border border-accent/25 bg-accent/[0.06] px-5 py-3.5 text-[15px] italic text-accent shadow-inner sm:text-[16px]"
            style={{ fontStyle: "italic" }}
          >
            <span className="not-italic select-none pr-2 text-faint">{">"}</span>
            {TUTOR_QUESTION}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents — kept inline so the file reads as a single beat rather
// than a tour through multiple files.
// ---------------------------------------------------------------------------

function CodeLineColored({ line }: { line: string }) {
  // Token-style coloring for one line. Walks the partial-line and
  // tags each segment with a token kind. JetBrains Mono palette:
  //   keyword (def, return, if)   → accent (sky-400)
  //   string ('', "")             → success-green (emerald)
  //   call (foo before "(")       → violet
  //   identifier                  → ink/light
  //   punctuation (parens etc)    → muted
  //   operator (=, ==, etc)       → faint accent
  const segments = tokenizeLine(line);
  return (
    <>
      {segments.map((seg, i) => (
        <span
          key={i}
          style={{
            color: tokenColor(seg.kind),
            whiteSpace: "pre",
          }}
        >
          {seg.text}
        </span>
      ))}
    </>
  );
}

type TokenKind = "kw" | "id" | "fn" | "str" | "punct" | "op";
const KEYWORDS = new Set([
  "def", "return", "if", "else", "elif", "for", "while", "in", "is",
  "not", "and", "or", "import", "from", "as", "class", "True", "False",
  "None", "lambda", "pass",
]);

function tokenizeLine(s: string): Array<{ text: string; kind: TokenKind }> {
  const out: Array<{ text: string; kind: TokenKind }> = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    // String literals (single or double-quoted, no escapes needed for
    // our hand-authored hero code).
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < s.length && s[j] !== quote) j++;
      const closing = j < s.length ? j + 1 : j; // include trailing quote if present
      out.push({ text: s.slice(i, closing), kind: "str" });
      i = closing;
      continue;
    }
    // === / == / != operator runs (color them as ops not punct).
    if (c === "=" || c === "!") {
      let j = i;
      while (j < s.length && (s[j] === "=" || s[j] === "!")) j++;
      out.push({ text: s.slice(i, j), kind: "op" });
      i = j;
      continue;
    }
    // Identifiers / keywords / function calls.
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
      const word = s.slice(i, j);
      if (KEYWORDS.has(word)) {
        out.push({ text: word, kind: "kw" });
      } else if (s[j] === "(") {
        out.push({ text: word, kind: "fn" });
      } else {
        out.push({ text: word, kind: "id" });
      }
      i = j;
      continue;
    }
    // Brackets, dots, commas, semicolons.
    if (/[()\[\]{}.,;]/.test(c)) {
      out.push({ text: c, kind: "punct" });
      i++;
      continue;
    }
    // Whitespace / fallback.
    out.push({ text: c, kind: "id" });
    i++;
  }
  return out;
}

function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case "kw": return "rgb(56 189 248)";          // sky-400
    case "fn": return "rgb(192 132 252)";         // violet
    case "str": return "rgba(52 211 153 / 0.9)";  // emerald
    case "op": return "rgba(56 189 248 / 0.7)";   // accent muted
    case "punct": return "rgba(148 163 184 / 0.85)"; // slate-400
    default: return "rgba(230 236 245 / 0.95)";   // ink
  }
}

function BlinkingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block animate-pulse align-baseline"
      style={{
        width: "0.55em",
        height: "1.05em",
        verticalAlign: "text-bottom",
        backgroundColor: "rgb(56 189 248)",
        opacity: 0.85,
      }}
    />
  );
}
