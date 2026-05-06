import { motion, useReducedMotion } from "framer-motion";
import { HOUSE_EASE } from "../../../components/cinema/easing";

// Phase 22C — Beat ① "Read." vignette.
//
// 3-second motion: a four-line lesson paragraph fades in line by line,
// then a code snippet types in below it. The visual evokes a real
// lesson page without using one — the visitor recognizes the surface
// when they later sign up.
//
// `whileInView` triggers the animation only once when the panel scrolls
// into view, so the beat doesn't replay on every scroll back.

const LESSON_LINES: readonly string[] = [
  "Python's `+` does two jobs at once.",
  "It joins strings and it adds numbers.",
  "Mix the two and Python refuses to bridge — TypeError.",
  "The fix is small: turn the number into a string.",
];

const CODE_LINES: readonly string[] = [
  'name = "Maya"',
  "points = 100",
  'message = name + " earned " + str(points) + " points!"',
  "print(message)",
];

export function ReadVignette() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-4">
      {/* Paragraph block — Inter, body weight, 4 lines stacked with
          slight bottom-margin so the reveal cadence is felt. */}
      <div className="space-y-1.5">
        {LESSON_LINES.map((line, i) => (
          <motion.p
            key={i}
            initial={reduce ? undefined : { opacity: 0, y: 6 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -8% 0px" }}
            transition={{
              duration: 0.5,
              ease: HOUSE_EASE,
              delay: 0.05 + i * 0.15,
            }}
            className="text-[14px] leading-relaxed text-ink/85 sm:text-[15px]"
          >
            {line}
          </motion.p>
        ))}
      </div>

      {/* Code block — JetBrains Mono on a darker inset, mirroring the
          actual lesson page's code-snippet styling. Stages in after
          the paragraph completes. */}
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 8 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-25% 0px -25% 0px" }}
        transition={{
          duration: 0.6,
          ease: HOUSE_EASE,
          delay: 0.05 + LESSON_LINES.length * 0.15 + 0.1,
        }}
        className="rounded-lg border border-border-soft/70 bg-bg/60 p-4 font-mono text-[12.5px] leading-[1.65] text-ink/90 sm:text-[13.5px]"
      >
        {CODE_LINES.map((line, i) => (
          <div key={i} className="whitespace-pre">
            {tokenize(line).map((seg, j) => (
              <span key={j} style={{ color: colorFor(seg.kind), whiteSpace: "pre" }}>
                {seg.text}
              </span>
            ))}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

interface Seg {
  text: string;
  kind: "kw" | "id" | "str" | "punct" | "fn";
}

const KEYWORDS = new Set([
  "def", "return", "if", "else", "elif", "for", "while", "in", "is",
  "not", "and", "or", "import", "from", "as", "class", "True", "False",
  "None", "lambda", "pass",
]);

function tokenize(line: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j++;
      out.push({ text: line.slice(i, j + 1), kind: "str" });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j]!)) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) out.push({ text: word, kind: "kw" });
      else if (line[j] === "(") out.push({ text: word, kind: "fn" });
      else out.push({ text: word, kind: "id" });
      i = j;
      continue;
    }
    if (/[(){}.,;[\]=+\-*/<>!]/.test(c)) {
      out.push({ text: c, kind: "punct" });
      i++;
      continue;
    }
    out.push({ text: c, kind: "id" });
    i++;
  }
  return out;
}

function colorFor(kind: Seg["kind"]): string {
  if (kind === "kw") return "rgb(56 189 248)";
  if (kind === "fn") return "rgb(192 132 252)";
  if (kind === "str") return "rgba(52 211 153 / 0.9)";
  if (kind === "punct") return "rgba(148 163 184 / 0.85)";
  return "rgba(230 236 245 / 0.92)";
}
