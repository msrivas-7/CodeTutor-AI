import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const WIDTH = 1200;
const HEIGHT = 630;

export interface LessonOgProps {
  courseTitle: string;
  lessonTitle: string;
  lessonOrder: number;
  totalLessons: number;
  description: string;
  language: string;
  concepts: string[];
}

const palette = {
  bg: "rgb(8, 13, 27)",
  panel: "rgb(15, 23, 42)",
  ink: "rgb(236, 241, 248)",
  muted: "rgb(148, 163, 184)",
  accent: "rgb(56, 189, 248)",
  success: "rgb(52, 211, 153)",
  violet: "rgb(192, 132, 252)",
  line: "rgb(41, 55, 82)",
  paper: "rgb(242, 239, 231)",
  paperInk: "rgb(35, 32, 31)",
} as const;

function LessonOgCard(props: LessonOgProps): React.ReactElement {
  const concepts = props.concepts.slice(0, 4);
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        background: palette.paper,
        padding: "18px 18px 0",
        fontFamily: "JetBrainsMono",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          position: "relative",
          borderRadius: 8,
          background: palette.bg,
          color: palette.ink,
          padding: "44px 54px 38px",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: 420,
            right: -160,
            top: -210,
            background: "rgba(56, 189, 248, 0.10)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 30,
              fontWeight: 600,
            }}
          >
            CodeTutor
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 15,
              color: palette.muted,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
          >
            {props.language} field note
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            maxWidth: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              color: palette.accent,
              fontSize: 17,
              letterSpacing: "0.04em",
              marginBottom: 16,
            }}
          >
            {`${props.courseTitle} · Lesson ${props.lessonOrder} of ${props.totalLessons}`}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: props.lessonTitle.length > 34 ? 60 : 70,
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
              color: palette.ink,
            }}
          >
            {props.lessonTitle}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 910,
              marginTop: 20,
              color: palette.muted,
              fontSize: 20,
              lineHeight: 1.5,
            }}
          >
            {props.description.length > 150
              ? `${props.description.slice(0, 147).trimEnd()}…`
              : props.description}
          </div>
          {concepts.length > 0 && (
            <div style={{ display: "flex", gap: 10, marginTop: 25 }}>
              {concepts.map((concept, index) => (
                <div
                  key={concept}
                  style={{
                    display: "flex",
                    border: `1px solid ${palette.line}`,
                    borderRadius: 999,
                    padding: "8px 13px",
                    color: index === 0 ? palette.success : palette.muted,
                    fontSize: 14,
                  }}
                >
                  {concept.replaceAll("-", " ")}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          color: palette.paperInk,
          fontSize: 15,
        }}
      >
        <div style={{ display: "flex", fontFamily: "Fraunces", fontWeight: 600 }}>
          Built to teach, not to autocomplete.
        </div>
        <div style={{ display: "flex", color: "rgb(87, 83, 78)" }}>
          codetutor.msrivas.com
        </div>
      </div>
    </div>
  );
}

interface LoadedFont {
  name: string;
  data: Buffer;
  weight: 400 | 600;
}

let fontCache: LoadedFont[] | null = null;

async function loadFonts(): Promise<LoadedFont[]> {
  if (fontCache) return fontCache;
  // Vite bundles vite.config.ts and its imports into a temporary module.
  // import.meta.url inside this file would therefore resolve to that wrapper
  // (and Vite 5 may rewrite it to an unavailable injected identifier). Build
  // and dev commands both execute with frontend/ as cwd, which is the stable
  // package boundary AGENTS.md requires agents to preserve.
  const frontendRoot = process.cwd();
  fontCache = await Promise.all([
    readFile(
      path.join(
        frontendRoot,
        "node_modules/@fontsource/fraunces/files/fraunces-latin-600-normal.woff",
      ),
    ).then((data) => ({ name: "Fraunces", data, weight: 600 as const })),
    readFile(
      path.join(
        frontendRoot,
        "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff",
      ),
    ).then((data) => ({ name: "JetBrainsMono", data, weight: 400 as const })),
  ]);
  return fontCache;
}

export async function renderLessonOgPng(props: LessonOgProps): Promise<Buffer> {
  const fonts = await loadFonts();
  const svg = await satori(LessonOgCard(props), {
    width: WIDTH,
    height: HEIGHT,
    fonts: fonts.map((font) => ({
      name: font.name,
      data: font.data,
      weight: font.weight,
      style: "normal" as const,
    })),
  });
  const renderer = new Resvg(svg, {
    background: palette.paper,
    fitTo: { mode: "width", value: WIDTH },
  });
  return Buffer.from(renderer.render().asPng());
}
