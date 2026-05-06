// Phase 22C — hero copy candidates for the marketing page.
//
// The plan locks in a mid-build workshop: render 8–10 hero claims live
// in the actual page (Fraunces 48px, gradient sweep, all the chrome) and
// pick the one that lands by sight. Until that workshop finishes, the
// SELECTED_INDEX below picks the default.
//
// Operator-locked rule: NO competitor named in any hero copy. No
// ChatGPT, no Codecademy, no Replit. The product names itself.
// Linear / Stripe / Arc do this — confident products don't elevate
// their competitors in their own headlines.

export interface HeroCandidate {
  /** The hero claim itself (≤ 9 words ideal). */
  claim: string;
  /** Short subhead, one line. Reads as a beat under the claim. */
  subhead: string;
  /** Posture this candidate projects — useful in workshop discussion. */
  posture: string;
}

export const HERO_CANDIDATES: readonly HeroCandidate[] = [
  {
    claim: "The AI tutor that won't spoil the answer.",
    subhead: "Walks you to it with hints and questions, so you actually learn.",
    posture: "USP at maximum compression. The 'spoil' verb captures the anti-cheat thesis.",
  },
  {
    claim: "Walks you to the answer. Never gives it away.",
    subhead: "An AI coding tutor for total beginners.",
    posture: "Two-sentence cinematic. Promise + differentiator on separate lines.",
  },
  {
    claim: "An AI tutor that teaches like a great human one.",
    subhead: "Hints, questions, and a sandbox to practice in.",
    posture: "Positive framing instead of negative. Anchors AI to a familiar trusted format.",
  },
  {
    claim: "The coding tutor that asks better questions.",
    subhead: "Real practice. Your code. Your win.",
    posture: "Anti-cheat angle. Names what we do, not what we're against.",
  },
  {
    claim: "Earn every line.",
    subhead: "A coding tutor that builds you, not the answer.",
    posture: "Bumper-sticker. High confidence, slight risk of being terse.",
  },
  {
    claim: "Code with someone who notices what you don't.",
    subhead: "A tutor that asks the questions you wouldn't think to ask yourself.",
    posture: "Empathetic. Reads as a co-pilot, not a search engine.",
  },
  {
    claim: "The tutor that asks. Not one that answers.",
    subhead: "Learn to code by doing the thinking yourself.",
    posture: "Direct binary contrast. Clearest 'why us' statement.",
  },
  {
    claim: "Code is something you do.",
    subhead: "A tutor that protects the part you're meant to learn.",
    posture: "Minimalist Steve-Jobs style. Very brave; can read as obvious.",
  },
  {
    claim: "Practice, not paste.",
    subhead: "An AI tutor that asks until you understand it yourself.",
    posture: "Snappy two-word. Reads as a slogan, not a thesis.",
  },
  {
    claim: "Become someone who codes.",
    subhead: "Not someone who copies code that runs.",
    posture: "Identity-shift framing. Aspirational. Risks sounding lofty.",
  },
  {
    claim: "A tutor that asks the questions you wouldn't think to ask yourself.",
    subhead: "Real lessons. Real practice. Real understanding.",
    posture: "Long-form. Most explanatory; least punchy.",
  },
  {
    claim: "Learn to code by doing the thinking.",
    subhead: "A tutor that asks instead of answers.",
    posture: "Action-verb opener. Clear product mechanic in the claim.",
  },
  {
    claim: "Built to make you better, not faster.",
    subhead: "An AI coding tutor that earns its silence.",
    posture: "Counter-positions against the speed-of-AI narrative.",
  },
  {
    claim: "AI that builds you, not the code",
    subhead: "An AI coding tutor for beginners",
    posture:
      "Operator pick. Names the AI category, makes the learner the subject of transformation, names the differentiator (won't write your code) without naming a competitor. Periods dropped — Linear/Stripe/Arc tagline register, lighter than declarative-sentence punctuation.",
  },
] as const;

/**
 * The default hero shown to non-workshop visitors. Index 13 = "AI that
 * builds you, not the code." — operator pick after the workshop pass.
 * Stays language-agnostic on purpose: editor supports 9 languages and
 * the course catalog is expected to grow beyond Python.
 *
 * In dev (Vite import.meta.env.DEV), the URL `?hero=N` overrides this so
 * we can A/B-render candidates against the real page chrome without
 * rebuilding.
 */
export const SELECTED_HERO_INDEX = 13;

export function pickHeroCopy(): HeroCandidate {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("hero");
    // Guard `raw !== null` BEFORE parsing — `Number(null)` returns 0,
    // which would silently force candidate 0 on every dev pageload that
    // didn't explicitly set ?hero=. (This was an actual bug masked by
    // the original SELECTED_HERO_INDEX being 0 — flipping the index
    // exposed it.)
    if (raw !== null) {
      const requested = Number(raw);
      if (
        Number.isInteger(requested) &&
        requested >= 0 &&
        requested < HERO_CANDIDATES.length
      ) {
        return HERO_CANDIDATES[requested]!;
      }
    }
  }
  return HERO_CANDIDATES[SELECTED_HERO_INDEX]!;
}
