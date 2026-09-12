import { useLayoutEffect, useState } from "react";
import { authContour, readingBounds, type AuthBounds } from "./authComposition";
import { particleIdentity, particleSeed } from "../study/geometry";

const glyphs = ["{", "}", "<", ">", "[", "]", ";", "+"];

/** Geometry fallback exists before WebGL and survives reduced motion or failure. */
export function AuthFieldStill({ root, reading = false }: { root: HTMLElement; reading?: boolean }) {
  const [layout, setLayout] = useState<{
    width: number;
    height: number;
    content: AuthBounds;
  } | null>(null);
  useLayoutEffect(() => {
    const content = root.querySelector<HTMLElement>(".public-content, main");
    if (!content) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const page = root.getBoundingClientRect();
      const rect = content.getBoundingClientRect();
      setLayout(reading ? {
        width: innerWidth, height: innerHeight,
        content: readingBounds(innerWidth, innerHeight, rect.width),
      } : {
        width: page.width,
        height: page.height,
        content: { left: rect.left - page.left, top: rect.top - page.top,
          width: rect.width, height: rect.height },
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(content);
    window.addEventListener("resize", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [root, reading]);
  if (!layout) return null;
  const points = authContour(160, layout.width, layout.content);
  const cx = layout.content.left + layout.content.width / 2;
  const cy = layout.content.top + layout.content.height / 2;
  return (
    <div className={reading ? "public-flow-still" : "public-auth-still"} aria-hidden="true">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`}>
        <g fontFamily="monospace" textAnchor="middle" dominantBaseline="middle">
          {Array.from({ length: 160 }, (_, i) => (
            <text key={i} x={cx + points[i * 3]!} y={cy - points[i * 3 + 1]!}
              fill={particleIdentity(i)[1] < 0.7 ? "currentColor" : "#c4a7e7"}
              opacity={0.35 + particleSeed(i) * 0.45} fontSize={4 + particleSeed(i) ** 2 * 16}>
              {glyphs[Math.floor(particleIdentity(i)[0] * 8)]}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
