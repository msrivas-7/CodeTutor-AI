import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AmbientGlyphField } from "./AmbientGlyphField";

describe("AmbientGlyphField visual contract", () => {
  it("renders the original individual code atmosphere on a background layer", () => {
    const html = renderToStaticMarkup(<AmbientGlyphField />);

    expect(html).toContain('data-testid="ambient-glyph-field"');
    expect(html).toContain('data-floating-glyph="{"');
    expect(html).toContain('data-floating-glyph="&lt;"');
    expect(html).toContain('data-floating-glyph="/"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("z-0");
    expect(html).not.toContain("rounded-full");
  });

  it("keeps the richer hero field deterministic", () => {
    const html = renderToStaticMarkup(<AmbientGlyphField density="hero" />);

    expect(html.match(/data-floating-glyph=/g)).toHaveLength(24);
    expect(html).toContain('data-floating-glyph="&amp;"');
    expect(html).toContain('data-floating-glyph="["');
  });

  it("can reserve a central content-safe column without changing the glyph language", () => {
    const html = renderToStaticMarkup(<AmbientGlyphField occludeCenter />);

    expect(html).toContain("ambient-glyph-field--center-safe");
    expect(html.match(/data-floating-glyph=/g)).toHaveLength(7);
  });
});
