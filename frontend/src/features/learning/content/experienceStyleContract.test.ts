import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

describe("critical experience style contract", () => {
  const bodyCopySurfaces = [
    "src/features/learning/components/LessonInstructionsPanel.tsx",
    "src/features/learning/components/RetrievalCheckPanel.tsx",
    "src/features/learning/components/LessonCompletePanel.tsx",
    "src/features/learning/components/AnonShareDialog.tsx",
    "src/features/learning/components/PhoneGraduationDialog.tsx",
    "src/features/learning/components/SignupWallDialog.tsx",
    "src/features/share/components/ShareDialog.tsx",
    "src/auth/OAuthButtons.tsx",
    "src/pages/TrustPage.tsx",
  ];

  it("does not reintroduce arbitrary 9-11px copy on the critical journey", () => {
    for (const path of bodyCopySurfaces) {
      expect(source(path), path).not.toMatch(/text-\[(?:9|10|11)px\]/);
    }
  });

  it("keeps ordinary stages out of destructive alert-dialog semantics", () => {
    expect(source("src/features/learning/components/LessonCompletePanel.tsx")).toContain(
      'role="dialog"',
    );
    expect(source("src/features/learning/components/SignupWallDialog.tsx")).toContain(
      'role="dialog"',
    );
    expect(source("src/features/learning/components/RetrievalCheckPanel.tsx")).toContain(
      'role="region"',
    );
    expect(source("src/features/learning/components/CoachBubble.tsx")).toContain(
      'role="region"',
    );
  });

  it("keeps the shared modal responsible for stacked focus and background inertness", () => {
    const modal = source("src/components/Modal.tsx");
    expect(modal).toContain("[data-modal-layer]");
    expect(modal).toContain("node.inert = true");
    expect(modal).toContain('aria-modal="true"');
  });
});
