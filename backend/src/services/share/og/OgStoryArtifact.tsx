import React from "react";

// Phase 21C-ext: 1080×1920 (9:16) Story-format variant of the share
// artifact. Shares the same content + brand vocabulary as OgArtifact.tsx
// but vertically restacked so it reads natively in Instagram Stories,
// TikTok, and Snapchat without letterboxing.
//
// Vertical hierarchy (top → bottom):
//   1. Wordmark + share URL (eyebrow)
//   2. Course context (small caps)
//   3. Lesson title (Fraunces 84px, the dominant headline)
//   4. Code block (centered, generous padding — THE artifact)
//   5. Footer band: mastery ring + author + meta + CTA hint
//
// Same Satori subset rules as OgArtifact: only flexbox, no grid, no
// float, every multi-child div needs explicit display: flex.

const W = 1080;
const H = 1920;

const BRAND = {
  bg: "rgb(11, 16, 32)",
  panel: "rgb(15, 23, 42)",
  ink: "rgb(230, 236, 245)",
  muted: "rgb(148, 163, 184)",
  faint: "rgb(100, 116, 139)",
  border: "rgb(51, 65, 85)",
  accent: "rgb(56, 189, 248)",
  success: "rgb(52, 211, 153)",
  violet: "rgb(192, 132, 252)",
  gilt: "rgb(217, 178, 105)",
} as const;

function masteryColor(mastery: "strong" | "okay" | "shaky"): string {
  if (mastery === "strong") return BRAND.gilt;
  if (mastery === "okay") return "rgb(176, 184, 196)";
  return "rgb(180, 132, 96)";
}

function masteryLabel(mastery: "strong" | "okay" | "shaky"): string {
  if (mastery === "strong") return "Completed confidently";
  if (mastery === "okay") return "Lesson completed";
  return "Kept going and finished";
}

function fmtTimeSpent(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 60_000) return "<1m";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

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

function colorForKind(kind: Token["kind"]): string {
  if (kind === "kw") return BRAND.accent;
  if (kind === "str") return "rgba(52, 211, 153, 0.85)";
  if (kind === "cmt") return BRAND.faint;
  return "rgba(230, 236, 245, 0.92)";
}

export interface OgStoryArtifactProps {
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

export function OgStoryArtifact(
  props: OgStoryArtifactProps,
): React.ReactElement {
  // 9:16 has more vertical real estate — bump the code budget to 12
  // lines and the font to 30px so the punchline is legible at the
  // smallest in-feed render (≈360px wide).
  const allLines = props.codeSnippet.split("\n");
  const MAX_LINES = 12;
  const lines = allLines.slice(0, MAX_LINES);
  const truncated = allLines.length > MAX_LINES;

  const codeFontSize = 30;
  const codeLineHeight = 44;

  const author = props.displayName ?? "A learner on CodeTutor AI";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // justify-content:space-between distributes the three sections
        // (header, body, footer) along the long axis without leaving a
        // dead zone in the middle. Vertical Story formats look broken
        // when content stacks at the top with a half-screen of void
        // below; this keeps the eye flowing top-to-bottom on a phone.
        justifyContent: "space-between",
        width: W,
        height: H,
        backgroundColor: BRAND.bg,
        color: BRAND.ink,
        fontFamily: "Inter",
        // Top padding is generous to clear IG's username/profile-pic
        // overlay (~180px). Bottom padding clears the reply box and
        // link-sticker UI (~260px on iOS). Side padding stays at 72px.
        padding: "180px 72px 260px",
        position: "relative",
      }}
    >
      {/* Ambient accent glow top-left. Bigger than the OG variant
          because the vertical canvas needs a stronger mood pull. */}
      <div
        style={{
          position: "absolute",
          top: -300,
          left: -300,
          width: 900,
          height: 900,
          borderRadius: 900,
          backgroundColor: "rgba(56, 189, 248, 0.10)",
        }}
      />
      {/* Soft violet wash bottom-right — gives the lower band a
          different temperature so the eye reads top-to-bottom rather
          than ping-ponging on a flat field. */}
      <div
        style={{
          position: "absolute",
          bottom: -350,
          right: -350,
          width: 900,
          height: 900,
          borderRadius: 900,
          backgroundColor: "rgba(192, 132, 252, 0.08)",
        }}
      />

      {/* Header — wordmark + URL. URL drops below the wordmark on the
          9:16 canvas because the horizontal space is tighter and a
          two-line treatment reads more like a poster. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div
          style={{
            fontFamily: "Fraunces",
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: BRAND.ink,
          }}
        >
          CodeTutor AI
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "JetBrainsMono",
            fontSize: 22,
            color: BRAND.faint,
          }}
        >
          {`codetutor.msrivas.com/s/${props.shareToken}`}
        </div>
      </div>

      {/* Body — sits in the middle band. justify-content:space-between
          on the parent pulls header up and footer down; this section
          floats freely in between, naturally centered. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Course context eyebrow */}
        <div
          style={{
            display: "flex",
            fontFamily: "Inter",
            fontSize: 22,
            fontWeight: 500,
            color: BRAND.muted,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          {`${props.courseTitle} · Lesson ${props.lessonOrder} of ${props.courseTotalLessons}`}
        </div>

        {/* Lesson title — bigger than the OG card; 9:16 needs the title
            to dominate or it reads as filler. Solid success — same
            decision as the OG variant (gradient text didn't render
            reliably in Satori). */}
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
            color: BRAND.success,
          }}
        >
          {props.lessonTitle}
        </div>

        {/* Code block — THE artifact. Generous padding, occupies the
            middle third of the vertical space so it commands attention
            even on a phone-locked-screen-preview render. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: BRAND.panel,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 24,
            padding: "40px 44px",
            marginTop: 16,
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
                marginTop: 6,
                fontSize: codeFontSize * 0.8,
              }}
            >
              …
            </div>
          )}
        </div>
      </div>

      {/* Footer band — mastery ring + author + meta. Sits above an
          explicit CTA tile so the post reads as a self-contained poster
          even when stripped of the link sticker on Instagram. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
          paddingTop: 32,
          borderTop: `1px solid ${BRAND.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                width: 32,
                height: 32,
                borderRadius: 32,
                border: `3px solid ${masteryColor(props.mastery)}`,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontFamily: "Inter",
                  fontSize: 28,
                  fontWeight: 500,
                  color: BRAND.ink,
                }}
              >
                {author}
              </div>
              <div
                style={{
                  fontFamily: "Inter",
                  fontSize: 20,
                  color: BRAND.muted,
                  marginTop: 4,
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
              fontSize: 22,
              color: BRAND.faint,
            }}
          >
            {`${fmtTimeSpent(props.timeSpentMs) ? `${fmtTimeSpent(props.timeSpentMs)} · ` : ""}${props.attemptCount} ${
              props.attemptCount === 1 ? "attempt" : "attempts"
            }`}
          </div>
        </div>

        {/* CTA tile — visually distinct band with the link copy.
            Critical for Stories where the URL footer above reads as
            metadata; the explicit CTA is what an unfamiliar viewer
            actually parses. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(56, 189, 248, 0.10)",
            border: `1px solid rgba(56, 189, 248, 0.35)`,
            borderRadius: 20,
            padding: "28px 32px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Inter",
              fontSize: 30,
              fontWeight: 600,
              color: BRAND.ink,
              letterSpacing: "-0.01em",
            }}
          >
            Try the first lesson — about 10 minutes
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrainsMono",
              fontSize: 22,
              color: BRAND.accent,
              marginTop: 8,
            }}
          >
            {`codetutor.msrivas.com/s/${props.shareToken}`}
          </div>
        </div>
      </div>
    </div>
  );
}
