import { particleSeed } from "../study/geometry";

export interface AuthBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Reading pages keep the field in the current viewport, not stretched around
 * a multi-screen document. They share auth's material, clock and pointer physics. */
export function readingBounds(width: number, height: number, contentWidth: number): AuthBounds {
  const readingWidth = Math.max(1, Math.min(contentWidth, width - 40));
  const readingHeight = Math.max(1, Math.min(height * 0.82, 960));
  return { left: (width - readingWidth) / 2, top: (height - readingHeight) / 2,
    width: readingWidth, height: readingHeight };
}

/** The homepage material opens into a living clearing, not a second sculpture.
 * Each seeded glyph travels with the shared clock through a broad, uneven stream.
 * No form values, input state, timers or per-page animation clocks are involved.
 * The fallback is the same field at time zero. */
export function authContour(count: number, viewportWidth: number, content: AuthBounds, seconds = 0, output?: Float32Array) {
  const points = output ?? new Float32Array(count * 3);
  // Foreground belongs to the centered task, not the monitor's outer edges.
  // The distant field independently retains the homepage's area-based density.
  const horizontal = Math.max(1, Math.min(viewportWidth * 0.48, content.width * 1.55));
  const vertical = Math.max(180, content.height * 0.76);
  for (let i = 0; i < count; i++) {
    const seed = particleSeed(i);
    const angle = i * 2.399963229728653 + seconds * (0.025 + seed * 0.009);
    const depth = 0.57 + particleSeed(i + 7919) * 0.38;
    const x = Math.sin(angle);
    const y = Math.cos(angle);
    // Softly squared flow gives text room without tracing a rigid frame.
    points[i * 3] = Math.sign(x) * Math.pow(Math.abs(x), 0.65) * horizontal * depth;
    points[i * 3 + 1] = y * vertical * depth;
    points[i * 3 + 2] = Math.sin(angle + seed * 6.28) * 120 * depth;
  }
  return points;
}
