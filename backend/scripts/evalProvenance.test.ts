import { describe, expect, it } from "vitest";

import { QUALITY_CONTRACT_FILES } from "./evalProvenance.js";

describe("AI evaluation provenance", () => {
  it("fingerprints the shared user-file context renderer", () => {
    expect(QUALITY_CONTRACT_FILES).toContain(
      "src/services/ai/prompts/renderContext.ts",
    );
  });
});
