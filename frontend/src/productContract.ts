/**
 * Versioned, executable contract for the promises made before a learner signs
 * in. Public surfaces import these values instead of restating them so routes,
 * timing, and product behavior cannot quietly disagree.
 */
export const PUBLIC_PRODUCT_CONTRACT_VERSION = 1 as const;

export const FIRST_LESSON_CONTRACT = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  route: "/try/lesson/python-fundamentals/hello-world",
  estimatedMinutes: 10,
  requiresSignup: false,
  requiresCard: false,
} as const;

export const FIRST_LESSON_FINEPRINT = `Free to start. No card. About ${FIRST_LESSON_CONTRACT.estimatedMinutes} minutes for your first lesson.`;

export interface PublicProductClaim {
  id: string;
  claim: string;
  sourceOfTruth: string;
  verifiedBy: string;
}

/**
 * Inventory reviewed whenever public positioning or the first-use journey
 * changes. `verifiedBy` names the automated contract that must fail when the
 * implementation stops earning the claim.
 */
export const PUBLIC_PRODUCT_CLAIMS_V1: readonly PublicProductClaim[] = [
  {
    id: "trial-without-signup",
    claim: "A signed-out visitor can start lesson 1 without creating an account.",
    sourceOfTruth: "FIRST_LESSON_CONTRACT.route and requiresSignup",
    verifiedBy: "productContract.test.ts and zero-state-first-journey.spec.ts",
  },
  {
    id: "first-lesson-duration",
    claim: "The first lesson takes about 10 minutes.",
    sourceOfTruth: "FIRST_LESSON_CONTRACT.estimatedMinutes",
    verifiedBy: "productContract.test.ts",
  },
  {
    id: "no-payment-before-trial",
    claim: "The first lesson requires no card.",
    sourceOfTruth: "FIRST_LESSON_CONTRACT.requiresCard",
    verifiedBy: "productContract.test.ts and marketing.spec.ts",
  },
  {
    id: "tutor-does-not-supply-solution",
    claim: "The tutor guides with questions and hints without supplying the complete answer.",
    sourceOfTruth: "firstRun/scriptedTurns.ts and server tutor policy",
    verifiedBy: "productContract.test.ts and tutor policy tests",
  },
  {
    id: "completion-requires-proof",
    claim: "Lesson completion requires code checks and a short recall question.",
    sourceOfTruth: "lesson.json completionRules",
    verifiedBy: "productContract.test.ts and retrieval-check-gate.spec.ts",
  },
  {
    id: "anonymous-share-link",
    claim: "A completed anonymous lesson can create a public share link before signup.",
    sourceOfTruth: "POST /api/anon/shares and AnonShareDialog",
    verifiedBy: "anon-wall-reasons-coverage.spec.ts",
  },
] as const;
