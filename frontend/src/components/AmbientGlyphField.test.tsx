import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AmbientGlyphField } from "./AmbientGlyphField";

describe("AmbientGlyphField visual contract", () => {
  it("uses complete, bounded code tokens instead of isolated punctuation", () => {
    const html = renderToStaticMarkup(<AmbientGlyphField />);

    expect(html).toContain('data-testid="ambient-glyph-field"');
    expect(html).toContain('data-glyph-token="&lt;/&gt;"');
    expect(html).toContain('data-glyph-token="{ }"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("lg:inline-flex");
    expect(html).not.toContain('data-glyph-token="{"');
    expect(html).not.toContain('data-glyph-token="&lt;"');
    expect(html).not.toContain('data-glyph-token="/"');
  });

  it("keeps the denser transition treatment grouped as readable tokens", () => {
    const html = renderToStaticMarkup(<AmbientGlyphField density="hero" />);

    expect(html.match(/data-glyph-token=/g)).toHaveLength(8);
    expect(html).toContain('data-glyph-token="&amp;&amp;"');
    expect(html).toContain('data-glyph-token="//"');
  });
});
