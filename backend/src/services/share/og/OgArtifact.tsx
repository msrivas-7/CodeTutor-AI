import React from "react";

// Phase 21C: 1200x630 OG card layout for Twitter/LinkedIn/iMessage
// unfurl. Authored as JSX so Satori can render it; rendered to PNG
// via @resvg/resvg-js. Visual hierarchy mirrors the cinematic share
// page (the artifact and the page tell the same story):
//
//   - Code block is THE headline (largest, centred, 64–72% width)
//   - Lesson title is a CAPTION above the code
//   - Wordmark + mastery ring + author live in the footer band
//   - Single gradient on the lesson title (the "ONE gradient per page"
//     policy holds)
//
// Satori is not a full CSS engine — it supports a subset of flexbox,
// no grid, no float. Layout uses only flex.

const W = 1200;
const H = 630;

// Brand colors — kept in sync with frontend tailwind.config.js + index.css.
const BRAND = {
  bg: "rgb(11, 16, 32)", // --color-bg
  panel: "rgb(15, 23, 42)", // --color-panel
  ink: "rgb(230, 236, 245)",
  muted: "rgb(148, 163, 184)",
  faint: "rgb(100, 116, 139)",
  border: "rgb(51, 65, 85)",
  accent: "rgb(56, 189, 248)",
  success: "rgb(52, 211, 153)",
  violet: "rgb(192, 132, 252)",
  gilt: "rgb(217, 178, 105)", // mastery gold (rare; new token)
} as const;

// Mastery ring colors — match the on-page ring on /s/:token.
function masteryColor(mastery: "strong" | "okay" | "shaky"): string {
  if (mastery === "strong") return BRAND.gilt;
  if (mastery === "okay") return "rgb(176, 184, 196)"; // silver
  return "rgb(180, 132, 96)"; // bronze
}

function masteryLabel(mastery: "strong" | "okay" | "shaky"): string {
  if (mastery === "strong") return "Completed confidently";
  if (mastery === "okay") return "Lesson completed";
  return "Kept going and finished";
}

function fmtTimeSpent(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return "<1m";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

// Tokenize code for the 4-color rendering: keywords / strings / comments /
// plain. Intentionally simple — Satori has limited rendering capacity, so
// we want the layout to read as code at a glance, not a full IDE.
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
  // Comment line: everything after # is a comment.
  const cmtIdx = line.indexOf("#");
  if (cmtIdx === 0) return [{ text: line, kind: "cmt" }];
  if (cmtIdx > 0) {
    const head = line.slice(0, cmtIdx);
    const tail = line.slice(cmtIdx);
    return [...tokenizeLine(head), { text: tail, kind: "cmt" }];
  }
  // String literals (very basic — single or double quotes, no escape handling).
  const out: Token[] = [];
  let i = 0;
  let buf = "";
  const flushBuf = () => {
    if (!buf) return;
    // Word-by-word check for keywords inside the buffered chunk.
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

function colorForKind(kind: Token["kind"]): string {
  if (kind === "kw") return BRAND.accent;
  if (kind === "str") return "rgba(52, 211, 153, 0.85)"; // success at 85%
  if (kind === "cmt") return BRAND.faint;
  return "rgba(230, 236, 245, 0.92)"; // ink at 92%
}

// ---------------------------------------------------------------------------
// The main artifact
// ---------------------------------------------------------------------------

export interface OgArtifactProps {
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: "strong" | "okay" | "shaky";
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
  shareToken: string;
}

export function OgArtifact(props: OgArtifactProps): React.ReactElement {
  // Truncate + clamp the code to fit nicely in the artifact. The
  // polaroid frame (Phase A — A3) costs ~90px of vertical budget, so
  // the interior clamps at 8 lines instead of the pre-frame 10.
  const allLines = props.codeSnippet.split("\n");
  const MAX_LINES = 8;
  const lines = allLines.slice(0, MAX_LINES);
  const truncated = allLines.length > MAX_LINES;

  const codeLineHeight = 30;
  const codeFontSize = 21;

  // Author line — anonymous when no displayName chosen.
  const author = props.displayName ?? "A learner on CodeTutor";

  // Phase A — A3 (growth-marketing): polaroid-border attribution
  // framing. The artifact travels as a screenshot far more often than
  // as a linked unfurl — a warm paper frame with a "Made on CodeTutor"
  // caption band makes the brand part of the PHOTO, not chrome around
  // it: cropping the attribution out means visibly mutilating the
  // polaroid. Paper color is deliberately warm (photo paper, not UI
  // white) so the dark artifact reads as a developed picture.
  const PAPER = "rgb(244, 241, 234)";
  const PAPER_INK = "rgb(41, 37, 36)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: W,
        height: H,
        backgroundColor: PAPER,
        padding: "18px 18px 0 18px",
        fontFamily: "Inter",
      }}
    >
      {/* The photo — the pre-A3 dark artifact, framed. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          backgroundColor: BRAND.bg,
          color: BRAND.ink,
          padding: "28px 48px",
          borderRadius: 6,
          position: "relative",
          overflow: "hidden",
        }}
      >
      {/* Ambient accent glow top-left */}
      <div
        style={{
          position: "absolute",
          top: -200,
          left: -200,
          width: 600,
          height: 600,
          borderRadius: 600,
          backgroundColor: "rgba(56, 189, 248, 0.08)",
          // Satori's filter support is limited; we rely on the soft
          // shape + low opacity to read as a glow, no actual blur.
        }}
      />

      {/* Header row: wordmark left. The share URL moved to the polaroid
          caption band — one attribution surface, carried by the frame. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Wordmark — plain ink. The ONE gradient is reserved for the
              lesson title below. */}
          <div
            style={{
              fontFamily: "Fraunces",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: BRAND.ink,
            }}
          >
            CodeTutor
          </div>
        </div>
      </div>

      {/* Body — flex-1 column with title (caption) + code (headline) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          marginTop: 20,
          gap: 14,
        }}
      >
        {/* Course context — small eyebrow */}
        <div
          style={{
            display: "flex",
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: 500,
            color: BRAND.muted,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          {`${props.courseTitle} · Lesson ${props.lessonOrder} of ${props.courseTotalLessons}`}
        </div>

        {/* Lesson title — solid success-green Fraunces.
            We tried Satori's gradient-text trick (backgroundImage +
            backgroundClip:"text" + color:"transparent" with a
            success → accent → violet sweep) but Satori 0.26's gradient
            renderer collapses to the first stop in practice. Solid
            success works well visually — it's the brand's "completion"
            color and reads as "this lesson got done." Revisit when
            Satori's gradient-text support stabilizes. */}
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 46,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            color: BRAND.success,
          }}
        >
          {props.lessonTitle}
        </div>

        {/* Code block — THE artifact. Centred, generous padding,
            monospace, line-by-line color-tokenized rendering. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: BRAND.panel,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: "24px 28px",
            marginTop: 8,
            fontFamily: "JetBrainsMono",
            fontSize: codeFontSize,
            lineHeight: 1.45,
          }}
        >
          {lines.map((line, i) => {
            const tokens = tokenizeLine(line);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  height: codeLineHeight,
                }}
              >
                {tokens.length === 0 ? (
                  // Empty line — preserve vertical rhythm.
                  <span style={{ color: BRAND.faint }}>&nbsp;</span>
                ) : (
                  tokens.map((t, j) => (
                    <span
                      key={j}
                      style={{
                        color: colorForKind(t.kind),
                        whiteSpace: "pre",
                      }}
                    >
                      {t.text}
                    </span>
                  ))
                )}
              </div>
            );
          })}
          {truncated && (
            <div
              style={{
                display: "flex",
                color: BRAND.faint,
                marginTop: 4,
                fontSize: codeFontSize * 0.8,
              }}
            >
              …
            </div>
          )}
        </div>
      </div>

      {/* Footer band: mastery ring + author left, time/attempts right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px solid ${BRAND.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Mastery ring — drawn as a circle outline. Color encodes tier.
              Satori doesn't support SVG arc strokes natively for stroke-
              dashoffset animation tricks, but a static circular border
              works fine for the static OG image. */}
          <div
            style={{
              display: "flex",
              width: 22,
              height: 22,
              borderRadius: 22,
              border: `2px solid ${masteryColor(props.mastery)}`,
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontFamily: "Inter",
                fontSize: 18,
                fontWeight: 500,
                color: BRAND.ink,
              }}
            >
              {author}
            </div>
            <div
              style={{
                fontFamily: "Inter",
                fontSize: 13,
                color: BRAND.muted,
                marginTop: 2,
              }}
            >
              {masteryLabel(props.mastery)}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Inter",
            fontSize: 14,
            color: BRAND.faint,
          }}
        >
          {`${fmtTimeSpent(props.timeSpentMs)} · ${props.attemptCount} ${
            props.attemptCount === 1 ? "attempt" : "attempts"
          }`}
        </div>
      </div>
      </div>

      {/* Polaroid caption band — the thick bottom border of a real
          polaroid, carrying the attribution. Fraunces italic reads as
          the handwritten caption; the share URL rides along so the
          artifact is a working pointer even as a bare screenshot. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 58,
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 22,
            fontWeight: 600,
            fontStyle: "italic",
            color: PAPER_INK,
          }}
        >
          Made on CodeTutor
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "JetBrainsMono",
            fontSize: 15,
            color: "rgb(120, 113, 108)",
          }}
        >
          {`codetutor.msrivas.com/s/${props.shareToken}`}
        </div>
      </div>
    </div>
  );
}
