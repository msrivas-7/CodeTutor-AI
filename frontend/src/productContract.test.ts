import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FIRST_LESSON_CONTRACT,
  FIRST_LESSON_FINEPRINT,
  PUBLIC_PRODUCT_CLAIMS_V1,
  PUBLIC_PRODUCT_CONTRACT_VERSION,
} from "./productContract";

const frontendRoot = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, frontendRoot), "utf8");

describe("public product contract v1", () => {
  it("has a complete, uniquely-addressable claims inventory", () => {
    expect(PUBLIC_PRODUCT_CONTRACT_VERSION).toBe(1);
    expect(PUBLIC_PRODUCT_CLAIMS_V1.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PUBLIC_PRODUCT_CLAIMS_V1.map((claim) => claim.id)).size).toBe(
      PUBLIC_PRODUCT_CLAIMS_V1.length,
    );
    for (const claim of PUBLIC_PRODUCT_CLAIMS_V1) {
      expect(claim.claim).not.toHaveLength(0);
      expect(claim.sourceOfTruth).not.toHaveLength(0);
      expect(claim.verifiedBy).toMatch(/\.test\.|\.spec\./);
    }
  });

  it("keeps lesson metadata and every public duration claim aligned", () => {
    const lesson = JSON.parse(
      read("public/courses/python-fundamentals/lessons/hello-world/lesson.json"),
    ) as { estimatedMinutes: number };
    expect(lesson.estimatedMinutes).toBe(FIRST_LESSON_CONTRACT.estimatedMinutes);
    expect(FIRST_LESSON_FINEPRINT).toContain(
      `${FIRST_LESSON_CONTRACT.estimatedMinutes} minutes`,
    );

    const publicSurfaces = [
      read("src/pages/MarketingPage.tsx"),
      read("src/pages/CompactMarketingPage.tsx"),
      read("src/pages/WhyNotChatGPTPage.tsx"),
    ].join("\n");
    expect(publicSurfaces).not.toMatch(/About 5 minutes|Five minutes/i);
  });

  it("makes the account-free lesson the signed-out primary route", () => {
    expect(FIRST_LESSON_CONTRACT.requiresSignup).toBe(false);
    expect(FIRST_LESSON_CONTRACT.requiresCard).toBe(false);
    expect(FIRST_LESSON_CONTRACT.route).toBe(
      "/try/lesson/python-fundamentals/hello-world",
    );

    const cta = read("src/features/marketing/components/MarketingCta.tsx");
    const compact = read("src/pages/CompactMarketingPage.tsx");
    expect(cta).toContain("FIRST_LESSON_CONTRACT.route");
    expect(compact).toContain("FIRST_LESSON_CONTRACT.route");
  });

  it("does not expose internal learning jargon on beginner-facing surfaces", () => {
    const beginnerSurfaces = [
      read("src/pages/WhyNotChatGPTPage.tsx"),
      read("src/features/learning/pages/LessonPage.tsx"),
    ].join("\n");
    expect(beginnerSurfaces).not.toMatch(/cold retrieval question|Starting session…/);
  });
});
