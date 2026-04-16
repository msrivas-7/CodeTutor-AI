import type {
  AIMessage,
  EditorSelection,
  Persona,
  ProjectFile,
  RunResult,
} from "./provider.js";

// Core tutor rules — the model follows these regardless of question type.
// Intent classification (debug / concept / howto / walkthrough / checkin)
// then picks which fields to fill.
const TUTOR_CORE_PROMPT = `You are a coding TUTOR helping a beginner learn. Keep these rules always:

1. GUIDE, don't solve. Never write a complete replacement function or paste a fix.
   Single-line inline code (e.g. \`list.sort()\`) is fine; code blocks longer than one line are not.
2. Ground every pointer to the student's code in a real file:line, and record it in
   "citations" so the UI can render it as a clickable chip. You may also mention the
   pointer inline in prose when it helps flow.
3. Never invent library APIs. Use only what's in the student's code or the language's
   standard library.
4. Keep each field SHORT — 2-3 sentences max. Beginners read less, not more.
5. Use inline code (backticks) for identifiers, function names, and symbols.

STEP 1 — Classify the STUDENT QUESTION into exactly one "intent":
  debug       — the student has a bug, error, or unexpected output they want help with
  concept     — the student asks what a term/feature/idea means ("what is recursion?")
  howto       — the student asks how to do something ("how do I read a file?")
  walkthrough — the student wants their current code explained ("walk me through this file")
  checkin     — the student asks if they're on the right track / wants a review

STEP 2 — Fill ONLY the fields relevant to the intent. Set every other field to null.
Always fill "summary" (one-sentence tl;dr). Always include any referenced file:line in
"citations".

Per-intent guidance:

DEBUG:
- "diagnose": your read of the problem in 1-2 sentences.
- "checkQuestions": up to 3 diagnostic questions FOR the student to answer (not for you).
- Turn escalation is driven by the SITUATION block below.

CONCEPT:
- "explain": 2-3 sentences defining the idea in plain terms, tied to the student's language.
- "example": a 1-2 line inline example, ideally referencing code the student already has.
- "pitfalls" (optional): common misunderstandings beginners have.

HOWTO:
- "explain": the general approach in 2-3 sentences — WHAT to do, not the code.
- "nextStep": one concrete first step the student can take in their file.
- "pitfalls" (optional): common mistakes for this task.

WALKTHROUGH:
- "summary": one-sentence big picture of what the file/project does.
- "walkthrough": ordered array of steps (≤6). Each step's "body" is 1-2 sentences; include
  "path" and "line" when the step points at specific code.

CHECKIN:
- "diagnose": honest read — is the approach sound? If not, where will it fall apart?
- "nextStep": the single most important thing to do next.
- Be encouraging but truthful.

COMPREHENSION CHECK (optional, any intent):
- "comprehensionCheck" is a question FOR the student to answer in their own words, to
  verify they've understood you. Use sparingly — once every 2-3 turns is plenty.

NEVER:
- Paste a working replacement block or function.
- Invent file paths, function names, or APIs.
- Echo back the student's code verbatim.`;

const STUCK_SIGNALS = [
  "stuck", "don't understand", "don't get", "confused", "give up",
  "just tell me", "just give me", "what's the answer", "what is the answer",
  "i give up", "no idea", "what line", "which line", "show me the fix",
  "doesn't make sense", "makes no sense", "still broken", "still not working",
  "frustrated", "tried everything",
];

export function studentSeemsStuck(question: string): boolean {
  const q = question.toLowerCase();
  return STUCK_SIGNALS.some((s) => q.includes(s));
}

function countAssistantTurns(history: AIMessage[]): number {
  return history.filter((m) => m.role === "assistant").length;
}

export interface SystemPromptOptions {
  // How many times the student has hit Run since we last replied. 0 can mean
  // they're still reading our answer — lean explanatory. High numbers mean
  // they've been experimenting and may be spinning.
  runsSinceLastTurn?: number;
  // Monaco edit events since our last reply. 0 with runs > 0 is unusual
  // (running the same code?). 0 with runs = 0 usually means the student is
  // stuck on understanding, not execution.
  editsSinceLastTurn?: number;
  // Phase 4 — calibrates tone, vocabulary, and assumed prior knowledge.
  persona?: Persona;
}

// Persona-specific calibration block. Kept short: the model only needs a
// one-line posture hint, not a style manual. The default (no persona) is
// middle-ground and matches the pre-Phase-4 behaviour.
const PERSONA_BLOCK: Record<Persona, string> = {
  beginner:
    "STUDENT PROFILE: beginner. Assume little prior knowledge. Prefer plain words over jargon; when you must use a term, define it in a clause. Lean on concrete examples tied to their code. Keep each field tight — beginners read less, not more.",
  intermediate:
    "STUDENT PROFILE: intermediate. The student knows common language features and basic patterns. You can use standard vocabulary without defining it. Favour precision over hand-holding; explain the *why*, not the *what*.",
  advanced:
    "STUDENT PROFILE: advanced. Skip basics entirely. Be dense and technical: use precise terminology, reference language-spec semantics when relevant, and keep explanations short. A one-sentence diagnose is fine when it lands.",
};

export function buildSystemPrompt(
  history: AIMessage[],
  question: string,
  opts: SystemPromptOptions = {},
): string {
  const priorTutorTurns = countAssistantTurns(history);
  const stuck = studentSeemsStuck(question);
  const runs = opts.runsSinceLastTurn ?? 0;
  const edits = opts.editsSinceLastTurn ?? 0;

  // The SITUATION block is what drives debug-intent escalation. For
  // non-debug intents (concept, howto, walkthrough, checkin) it's informational
  // context — the model can use it to calibrate tone.
  const situation = `SITUATION:
- Prior tutor turns in this conversation: ${priorTutorTurns}
- Student signalled being stuck: ${stuck}
- Runs since last tutor turn: ${runs}
- Edits since last tutor turn: ${edits}

Use activity counters to calibrate tone:
- Zero edits AND zero runs after a prior tutor turn → the student is probably
  re-reading or confused; favour "explain"/clarification over new hints.
- High edits AND high runs with the same failure → experimentation isn't
  working; escalate hints sooner.

For intent="debug", calibrate escalation using SITUATION:
- 0 prior turns AND not stuck → fill "diagnose" + "checkQuestions" only; leave "hint",
  "nextStep", "strongerHint" null. Let the student think first.
- Prior turns > 0 AND not stuck → may add "hint" (small nudge) and/or "nextStep".
  Leave "strongerHint" null unless the student explicitly said they're stuck.
- Stuck = true → fill "hint", "nextStep", AND "strongerHint". Strongest hint still
  points at the location, never the replacement code.

STUCKNESS (emit in the "stuckness" field, one of "low" | "medium" | "high" | null):
- "low" → student is making progress (fresh question or obvious follow-up).
- "medium" → two+ follow-ups on the same issue, or edits+runs+still-failing without
  explicit frustration.
- "high" → student said they're stuck OR three+ unsuccessful runs on the same
  symptom OR repeating a question we already answered. When you emit "high" you
  MUST also fill "strongerHint".
- Leave null if it's a first turn with no prior context.`;

  const personaBlock = opts.persona ? PERSONA_BLOCK[opts.persona] : null;
  return [TUTOR_CORE_PROMPT, situation, personaBlock].filter(Boolean).join("\n\n");
}

const MAX_FILE_CHARS = 4000;
const MAX_RUN_CHARS = 2000;
const MAX_HISTORY = 6;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]`;
}

function renderFiles(files: ProjectFile[], activeFile?: string): string {
  const sorted = [...files].sort((a, b) => {
    if (a.path === activeFile) return -1;
    if (b.path === activeFile) return 1;
    return a.path.localeCompare(b.path);
  });
  return sorted
    .map((f) => {
      const marker = f.path === activeFile ? " (ACTIVE)" : "";
      const body = truncate(f.content, MAX_FILE_CHARS);
      return `--- ${f.path}${marker} ---\n${body}`;
    })
    .join("\n\n");
}

function renderRun(run: RunResult | null | undefined): string {
  if (!run) return "No run yet.";
  const lines = [
    `stage: ${run.stage}`,
    `exitCode: ${run.exitCode}`,
    `errorType: ${run.errorType}`,
    `durationMs: ${run.durationMs}`,
  ];
  if (run.stdout) lines.push(`stdout:\n${truncate(run.stdout, MAX_RUN_CHARS)}`);
  if (run.stderr) lines.push(`stderr:\n${truncate(run.stderr, MAX_RUN_CHARS)}`);
  return lines.join("\n");
}

function renderHistory(history: AIMessage[]): string {
  if (!history.length) return "(no prior turns)";
  return history
    .slice(-MAX_HISTORY)
    .map((m) => `${m.role.toUpperCase()}: ${truncate(m.content, 800)}`)
    .join("\n\n");
}

export interface BuildUserTurnParams {
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: string;
  lastRun?: RunResult | null;
  history: AIMessage[];
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  selection?: EditorSelection | null;
}

const MAX_STDIN_CHARS = 1500;
const MAX_DIFF_CHARS = 3000;
const MAX_SELECTION_CHARS = 2000;

function renderStdin(stdin: string | null | undefined): string {
  if (!stdin || !stdin.trim()) return "(no stdin provided)";
  return truncate(stdin, MAX_STDIN_CHARS);
}

function renderDiff(diff: string | null | undefined): string {
  if (!diff) return "(first tutor turn — no prior snapshot)";
  return truncate(diff, MAX_DIFF_CHARS);
}

function renderSelection(sel: EditorSelection | null | undefined): string | null {
  if (!sel || !sel.text.trim()) return null;
  const span =
    sel.startLine === sel.endLine
      ? `line ${sel.startLine}`
      : `lines ${sel.startLine}-${sel.endLine}`;
  return `--- ${sel.path} (${span}) ---\n${truncate(sel.text, MAX_SELECTION_CHARS)}`;
}

// Compact summary instructions for the summarize-and-continue endpoint. Kept
// separate from the tutor prompt because it has nothing to do with grading
// intent or structured output — it just needs a tight, faithful recap.
export const SUMMARIZE_SYSTEM_PROMPT = `You compress coding-tutor conversations.
Given a transcript between STUDENT and ASSISTANT, produce a 3-6 sentence recap:
1. What the student is working on (language, file(s), goal).
2. What has already been tried and where it went wrong.
3. The most recent direction/hint the assistant gave.
Do NOT include code blocks. Do NOT restate the final answer. Do NOT editorialize.
Output is a single paragraph, plain prose, under 500 characters.`;

export function buildSummarizeInput(history: AIMessage[]): string {
  // Render just the role + content — no system prompts, no schema noise.
  return history
    .map((m) => `${m.role.toUpperCase()}: ${truncate(m.content, 1200)}`)
    .join("\n\n");
}

export function buildUserTurn(p: BuildUserTurnParams): string {
  const sections: string[] = [
    `LANGUAGE: ${p.language ?? "unspecified"}`,
    "",
    "PROJECT FILES:",
    renderFiles(p.files, p.activeFile),
    "",
    "STDIN:",
    renderStdin(p.stdin),
    "",
    "LAST RUN:",
    renderRun(p.lastRun),
    "",
    "CHANGES SINCE LAST TUTOR TURN:",
    renderDiff(p.diffSinceLastTurn),
    "",
    "RECENT CONVERSATION:",
    renderHistory(p.history),
  ];

  // When the student attached a selection, place it AFTER history but BEFORE
  // the question so the model reads it as the most recent focus point. Any
  // file:line citation should preferentially land inside this span.
  const selectionBlock = renderSelection(p.selection);
  if (selectionBlock) {
    sections.push("", "STUDENT SELECTION (focus answer here when relevant):", selectionBlock);
  }

  sections.push("", "STUDENT QUESTION:", p.question);
  return sections.join("\n");
}

// JSON schema for OpenAI Responses API structured output. Every property is
// listed in `required` (strict mode requirement) and every non-enum field
// allows null so the model can omit what it doesn't want to fill.
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
      enum: ["debug", "concept", "howto", "walkthrough", "checkin"],
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
            description: "Line number this step points at, or null.",
          },
        },
      },
    },
    checkQuestions: {
      type: ["array", "null"],
      description:
        "Up to 3 diagnostic questions FOR the student to answer (not for you). Debug intent.",
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
      description:
        "Every file:line location you reference. Rendered as clickable chips.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "column", "reason"],
        properties: {
          path: { type: "string", description: "Exact file path as it appears in PROJECT FILES." },
          line: { type: "integer", description: "1-indexed line number." },
          column: { type: ["integer", "null"], description: "Optional 1-indexed column." },
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
