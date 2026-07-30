import { useLayoutEffect, useRef, useState } from "react";
import type { ShareMastery } from "../../../api/client";
import { MasteryRing, masteryLabel } from "./MasteryRing";

// Phase 21C: in-browser preview of the OG card. This is a 1200×630 layout
// scaled down to fit the dialog (we use CSS transform: scale + a fixed
// inner size so the proportions match the Satori-rendered PNG exactly).
//
// Mirrors backend/src/services/share/og/OgArtifact.tsx — same hierarchy,
// same brand colors, same 4-color code tokenization. We don't share the
// actual JSX module because Satori's flexbox subset rules don't carry
// over cleanly to web (Satori wants explicit `display: flex` on every
// multi-child div), and the web preview is happier expressing the layout
// in Tailwind.

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
  if (kind === "cmt") return "rgb(100 116 139)";
  return "rgba(230 236 245 / 0.92)";
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

export interface ShareCardPreviewProps {
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: ShareMastery;
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
  /** Used for the bottom-right URL. The dialog passes "preview" as the
   *  placeholder — the real token is unknown until POST resolves. */
  shareToken: string;
}

const W = 1200;
const H = 630;
const MAX_LINES = 10;

export function ShareCardPreview(props: ShareCardPreviewProps) {
  const allLines = props.codeSnippet.split("\n");
  const lines = allLines.slice(0, MAX_LINES);
  const truncated = allLines.length > MAX_LINES;
  const author = props.displayName ?? "A learner on CodeTutor";

  // The card renders at intrinsic 1200×630, then we wrap it in a
  // scaler so the dialog can show it at any width. Caller controls the
  // wrapper size; we just emit the artwork.
  return (
    <div
      className="relative overflow-hidden text-ink"
      style={{
        width: W,
        height: H,
        backgroundColor: "rgb(11 16 32)",
        fontFamily: "var(--font-sans, Inter)",
      }}
    >
      {/* Ambient accent glow top-left (matches the Satori artifact's
          radial — we use a CSS radial-gradient here since the web has
          full gradient support). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: -200,
          left: -200,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(56 189 248 / 0.12) 0%, rgba(56 189 248 / 0) 70%)",
        }}
      />

      <div className="relative flex h-full flex-col px-16 pt-12 pb-10">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div
            style={{
              fontFamily: "var(--font-display, Fraunces), serif",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "rgb(230 236 245)",
            }}
          >
            CodeTutor
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 16,
              color: "rgb(100 116 139)",
            }}
          >
            codetutor.msrivas.com/s/{props.shareToken}
          </div>
        </div>

        {/* Body */}
        <div className="mt-9 flex flex-1 flex-col gap-[18px]">
          {/* Course context — eyebrow */}
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "rgb(148 163 184)",
            }}
          >
            {props.courseTitle} · Lesson {props.lessonOrder} of{" "}
            {props.courseTotalLessons}
          </div>

          {/* Lesson title — solid success-green Fraunces. Matches the
              Satori artifact (gradient-text didn't render reliably in
              Satori, so we kept solid for parity across the artifact
              and the page). */}
          <div
            style={{
              fontFamily: "var(--font-display, Fraunces), serif",
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
              color: "rgb(52 211 153)",
            }}
          >
            {props.lessonTitle}
          </div>

          {/* Code block — THE artifact. */}
          <div
            className="mt-2 rounded-2xl border"
            style={{
              backgroundColor: "rgb(15 23 42)",
              borderColor: "rgb(51 65 85)",
              padding: "24px 28px",
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 22,
              lineHeight: 1.45,
            }}
          >
            {lines.map((line, i) => {
              const tokens = tokenizeLine(line);
              return (
                <div
                  key={i}
                  className="flex"
                  style={{ height: 32 }}
                >
                  {tokens.length === 0 ? (
                    <span style={{ color: "rgb(100 116 139)" }}>&nbsp;</span>
                  ) : (
                    tokens.map((t, j) => (
                      <span
                        key={j}
                        style={{
                          color: tokenColor(t.kind),
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
                className="mt-1"
                style={{
                  color: "rgb(100 116 139)",
                  fontSize: 22 * 0.8,
                }}
              >
                …
              </div>
            )}
          </div>
        </div>

        {/* Footer band */}
        <div
          className="mt-6 flex items-center justify-between border-t pt-5"
          style={{ borderColor: "rgb(51 65 85)" }}
        >
          <div className="flex items-center gap-3">
            <MasteryRing mastery={props.mastery} size={22} />
            <div className="flex flex-col">
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  color: "rgb(230 236 245)",
                }}
              >
                {author}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: "rgb(148 163 184)",
                  marginTop: 2,
                }}
              >
                {masteryLabel(props.mastery)}
              </span>
            </div>
          </div>
          <div
            style={{
              fontSize: 14,
              color: "rgb(100 116 139)",
            }}
          >
            {fmtTimeSpent(props.timeSpentMs)} · {props.attemptCount}{" "}
            {props.attemptCount === 1 ? "attempt" : "attempts"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper that scales the 1200×630 card to a target width while
 *  keeping the same aspect ratio. */
export function ShareCardPreviewScaled({
  width,
  ...rest
}: ShareCardPreviewProps & { width: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState(width);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const sync = () => setRenderWidth(Math.min(width, frame.clientWidth));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [width]);

  const scale = renderWidth / W;
  return (
    <div
      ref={frameRef}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-bg"
      style={{ maxWidth: width, aspectRatio: `${W} / ${H}` }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: W,
          height: H,
        }}
      >
        <ShareCardPreview {...rest} />
      </div>
    </div>
  );
}
