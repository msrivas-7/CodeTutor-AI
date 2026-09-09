import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { designTokenCss, publicBrand, publicCanvasColor, renderDesignTokensHtml } from "./tokens";

describe("shared public design tokens", () => {
  it("derives both CSS color formats and browser chrome from one value", () => {
    const css = designTokenCss();
    expect(css).toContain(`--brand-canvas-rgb: ${publicBrand.dark.canvas.join(" ")}`);
    expect(css).toContain(`--brand-canvas: ${publicCanvasColor}`);
    expect(css).toContain("--study-bg: var(--brand-canvas)");
    expect(css).toContain("--color-bg: var(--brand-canvas-rgb)");
  });

  it("resolves every referenced brand token and scopes public aliases", () => {
    const css = designTokenCss();
    const definitions = new Set([...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    for (const [, token] of css.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(definitions.has(token), token).toBe(true);
    }
    const root = css.slice(0, css.indexOf("}"));
    expect(root).not.toContain("--color-");
    expect(css).toContain(".motion-study, .public-theme");
    expect(css).toContain(".motion-study.study-light");
  });

  it("injects one critical source before bootstrap, without another request", () => {
    const template = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const html = renderDesignTokensHtml(template);
    expect(html.match(/id="design-system-tokens"/g)).toHaveLength(1);
    expect(html).not.toContain("__PUBLIC_CANVAS_COLOR__");
    expect(html).not.toContain("<!-- design-system:tokens -->");
    expect(html.indexOf('id="design-system-tokens"')).toBeLessThan(html.indexOf('id="public-theme-bootstrap"'));
    expect(html).toContain(`isPublic ? "${publicCanvasColor}"`);
  });
});
