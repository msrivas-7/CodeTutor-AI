import { describe, expect, it } from "vitest";
import { authContour, readingBounds } from "./authComposition";

describe("public reading composition", () => {
  it.each([[320, 740], [1440, 900], [3840, 2160]])("keeps the living field centered and bounded at %i x %i", (width, height) => {
    const bounds = readingBounds(width, height, 760);
    expect(bounds.left + bounds.width / 2).toBe(width / 2);
    expect(bounds.top + bounds.height / 2).toBe(height / 2);
    expect(bounds.width).toBeLessThanOrEqual(width - 40);
    expect(bounds.height).toBeLessThanOrEqual(960);
    const points = authContour(420, width, bounds, 40);
    expect(points).not.toEqual(authContour(420, width, bounds, 45));
    expect(Array.from(points).every(Number.isFinite)).toBe(true);
  });
});

describe("centered auth composition", () => {
  it.each([[390, 600], [1280, 620], [3840, 760], [320, 1200]])(
    "keeps finite deterministic surrounding material at width %i and content height %i",
    (width, height) => {
      const bounds = { left: 20, top: 88, width: Math.min(420, width - 40), height };
      const points = authContour(420, width, bounds);
      expect(points).toEqual(authContour(420, width, bounds));
      expect(points.length).toBe(1260);
      expect(Array.from(points).every(Number.isFinite)).toBe(true);
      const xs = Array.from(points).filter((_, i) => i % 3 === 0);
      const ys = Array.from(points).filter((_, i) => i % 3 === 1);
      expect(Math.min(...xs)).toBeLessThan(-Math.min(width * 0.3, 300));
      expect(Math.max(...xs)).toBeGreaterThan(Math.min(width * 0.3, 300));
      expect(Math.max(...xs.map(Math.abs))).toBeLessThan(width / 2);
      expect(Math.min(...ys)).toBeLessThan(-height * 0.4);
      expect(Math.max(...ys)).toBeGreaterThan(height * 0.4);
    },
  );
  it("does not stretch a short form's contour across a 4K display", () => {
    const bounds = { left: 0, top: 0, width: 420, height: 480 };
    expect(authContour(160, 3840, bounds)).toEqual(authContour(160, 1920, bounds));
  });
  it("adapts to expanded content without changing horizontal identity", () => {
    const base = { left: 430, top: 120, width: 420, height: 550 };
    const a = authContour(160, 1280, base);
    const b = authContour(160, 1280, { ...base, height: 850 });
    for (let i = 0; i < 160; i++) {
      expect(a[i * 3]).toBe(b[i * 3]);
      expect(a[i * 3 + 2]).toBe(b[i * 3 + 2]);
      expect(Math.abs(b[i * 3 + 1]!)).toBeGreaterThanOrEqual(Math.abs(a[i * 3 + 1]!));
    }
  });
  it("flows continuously without resetting identities or allocating a new pool", () => {
    const bounds = {left:0, top:0, width:420, height:620};
    const a = authContour(420, 1280, bounds, 30);
    const b = authContour(420, 1280, bounds, 30 + 1 / 60);
    const later = authContour(420, 1280, bounds, 35);
    expect(Math.max(...a.map((v,i) => Math.abs(v-b[i]!)))).toBeLessThan(3);
    expect(Math.max(...a.map((v,i) => Math.abs(v-later[i]!)))).toBeGreaterThan(20);
    const output = new Float32Array(420 * 3);
    expect(authContour(420, 1280, bounds, 35, output)).toBe(output);
    expect(output).toEqual(later);
  });
});
