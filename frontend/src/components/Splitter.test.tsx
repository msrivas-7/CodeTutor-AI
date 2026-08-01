import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

describe("Splitter accessibility contract", () => {
  it("announces the real pane value and bounds", () => {
    const html = renderToStaticMarkup(
      <Splitter
        orientation="vertical"
        valueNow={320}
        valueMin={240}
        valueMax={520}
        valueText="Instructions panel 320 pixels wide"
        onDrag={vi.fn()}
      />,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="320"');
    expect(html).toContain('aria-valuemin="240"');
    expect(html).toContain('aria-valuemax="520"');
    expect(html).toContain('aria-valuetext="Instructions panel 320 pixels wide"');
  });
});
