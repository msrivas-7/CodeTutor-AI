export const TUTOR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "summary",
    "diagnose",
    "explain",
    "example",
    "walkthrough",
    "checkQuestions",
    "hint",
    "nextStep",
    "strongerHint",
    "pitfalls",
    "citations",
    "comprehensionCheck",
    "stuckness",
  ],
  properties: {
    intent: {
      type: "string",
      enum: ["socratic", "debug", "concept", "howto", "walkthrough", "checkin"],
      description:
        "Your classification of the student's question. Pick the single best match.",
    },
    summary: {
      type: ["string", "null"],
      description: "One-sentence tl;dr of your response.",
    },
    diagnose: {
      type: ["string", "null"],
      description:
        "Your read of what's happening. 1-2 sentences. Mainly for debug and checkin intents.",
    },
    explain: {
      type: ["string", "null"],
      description:
        "A conceptual explanation in 2-3 sentences. For concept and howto intents.",
    },
    example: {
      type: ["string", "null"],
      description:
        "A tiny 1-2 line inline example, ideally tied to the student's code. For concept intents.",
    },
    walkthrough: {
      type: ["array", "null"],
      maxItems: 6,
      description:
        "Ordered steps explaining the student's code. At most 6 steps. For walkthrough intent only.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["body", "path", "line"],
        properties: {
          body: { type: "string", description: "One-or-two-sentence explanation." },
          path: {
            type: ["string", "null"],
            description: "File this step points at, or null if general.",
          },
          line: {
            type: ["integer", "null"],
            minimum: 1,
            description: "1-indexed line number this step points at, or null.",
          },
        },
      },
    },
    checkQuestions: {
      type: ["array", "null"],
      maxItems: 3,
      description:
        "One clarifying question for Socratic intent; up to 3 diagnostic questions for debug intent.",
      items: { type: "string" },
    },
    hint: {
      type: ["string", "null"],
      description: "A small nudge toward the fix. Debug intent.",
    },
    nextStep: {
      type: ["string", "null"],
      description: "One concrete action the student should take next.",
    },
    strongerHint: {
      type: ["string", "null"],
      description:
        "More explicit guidance. Only fill when student has signalled being stuck.",
    },
    pitfalls: {
      type: ["string", "null"],
      description: "Common mistakes or misunderstandings. Concept/howto intents.",
    },
    citations: {
      type: ["array", "null"],
      maxItems: 20,
      description:
        "Every file:line location you reference. Rendered as clickable chips.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "column", "reason"],
        properties: {
          path: { type: "string", description: "Exact file path as it appears in PROJECT FILES." },
          line: { type: "integer", minimum: 1, description: "1-indexed line number." },
          column: {
            type: ["integer", "null"],
            minimum: 0,
            description: "Optional 1-indexed column; use null when unknown.",
          },
          reason: {
            type: "string",
            description: "Short (≤60 chars) reason this location matters.",
          },
        },
      },
    },
    comprehensionCheck: {
      type: ["string", "null"],
      description:
        "Optional question FOR the student to answer, to verify they understood. Use sparingly.",
    },
    stuckness: {
      type: ["string", "null"],
      enum: ["low", "medium", "high", null],
      description:
        "Your assessment of how stuck the student is. Emit 'high' only alongside strongerHint.",
    },
  },
} as const;
