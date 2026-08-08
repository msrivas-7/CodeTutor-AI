import type {
  AIAskParams,
  TutorIntent,
  TutorSections,
} from "./provider.js";
import { isStandardApiSymbol } from "./suspectApi.js";

type TutorPolicyParams = Pick<
  AIAskParams,
  "files" | "question" | "lessonContext" | "lastRun"
> &
  Partial<Pick<AIAskParams, "history" | "diffSinceLastTurn">>;

const PROTECTED_REQUEST =
  /\b(?:system prompt|hidden tests?|hidden validator|another learner|compare my progress|correct (?:choice|answer)|answer is|exact final line|complete finished program|paste it)\b|\bprivate\s+(?:[A-Z0-9_]+\s+)?(?:mastery|record)\b/i;
const CANARY = /\b[A-Z][A-Z0-9]*_CANARY_[A-Z0-9_]+\b/g;

const INLINE_CODE = /`([^`\n]+)`/g;
const CODE_LIKE =
  /```|=>|(?:^|\s)(?:const|let|var|return|def|for|while|if)\s+|(?:^|\s)[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))\s*|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\([^\n)]*[^\s)]\)/m;

function scrubCanaries(text: string | null | undefined): string | null | undefined {
  return text?.replace(CANARY, "protected value");
}

// Structured JSON can still contain text that ends mid-thought (for example,
// "The line where the first" or "Can you explain why"). Never render these
// fragments as polished tutor guidance. The list intentionally targets words
// that require a following object or clause; normal punctuation is optional.
const DANGLING_PROSE_END =
  /\b(?:a|an|the|and|or|but|because|if|when|where|why|how|to|of|for|with|from|by|as|than|that|which|who|whose|your|my|its|this|these|those|first|second|third|multiple|each|any|some|both|either|neither)\s*[`'"”’)]*$/i;

function looksIncomplete(value: string): boolean {
  const text = value.trim();
  return /[,;:–—-]$/.test(text) || DANGLING_PROSE_END.test(text);
}

function containsNewPasteableCode(
  text: string,
  params: Pick<AIAskParams, "files" | "question">,
): boolean {
  if (
    /\breplace\b[\s\S]{0,160}\bwith\b/i.test(text) ||
    /\b(?:use|using)\b[^.!?]{0,40}[`'"]?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\(\)/i.test(text)
  ) {
    return true;
  }
  if (!CODE_LIKE.test(text)) return false;
  CODE_LIKE.lastIndex = 0;
  const evidence = `${params.question}\n${params.files.map((file) => file.content).join("\n")}`;
  const calls = text.match(
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\([^\n)]*[^\s)]\)/g,
  ) ?? [];
  if (calls.some((call) => !evidence.includes(call))) return true;
  const snippets = [...text.matchAll(INLINE_CODE)].map((match) => match[1].trim());
  if (snippets.some((snippet) => CODE_LIKE.test(snippet) && !evidence.includes(snippet))) {
    CODE_LIKE.lastIndex = 0;
    return true;
  }
  CODE_LIKE.lastIndex = 0;
  // Code fences, arrows, assignments, and calls with arguments are unsafe
  // even if the model forgot to wrap them in backticks.
  if (/```|=>/.test(text)) return true;
  const executable = text.match(
    /(?:^|[.;:]\s+)((?:const|let|var|return|def|for|while|if)\s+[^.;]+|[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))\s*[^.;]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\([^\n)]*[^\s)]\))/gm,
  );
  return !!executable?.some((snippet) => !evidence.includes(snippet.trim()));
}

function safeAction(
  value: string | null | undefined,
  params: Pick<AIAskParams, "files" | "question">,
): string | null {
  if (!value) return null;
  const scrubbed = scrubCanaries(value) ?? null;
  if (
    !scrubbed ||
    looksIncomplete(scrubbed) ||
    containsNewPasteableCode(scrubbed, params)
  ) {
    return null;
  }
  return scrubbed.trim();
}

function safeText(value: string | null | undefined): string | null {
  return scrubCanaries(value)?.trim() || null;
}

function hasActualFileDiff(diff: string | null | undefined): boolean {
  const normalized = diff?.trim();
  return !!normalized && !/^\(no file edits since last tutor turn\)$/i.test(normalized);
}

function safeProse(
  value: string | null | undefined,
  params: Pick<AIAskParams, "files" | "question">,
): string | null {
  const text = safeText(value);
  return text && !containsNewPasteableCode(text, params) ? text : null;
}

function meaningfulProse(
  value: string | null | undefined,
  params: Pick<AIAskParams, "files" | "question">,
): string | null {
  const text = safeProse(value, params);
  if (!text || text.length < 12 || (text.match(/[A-Za-z]+/g)?.length ?? 0) < 3) {
    return null;
  }
  return looksIncomplete(text) ? null : text;
}

const OPEN_CLARIFYING_QUESTION =
  /^(?:what (?:did you expect|have you tried|happens|part|result|output|error|change|do you think)|where |which part|how would you describe|can you describe|when )/i;
const SOCRATIC_EVIDENCE_QUESTION =
  /\b(?:expect|observ|happen|result|output|errors?|tried|attempt|unclear|uncertain|confus|think|evidence|understand|noticed|changed)\w*\b/i;
const LEADING_QUESTION =
  /\b(?:answer|fix|replace|correct line|solution|should|need(?:s)?|missing|try|use|using|add|remove|delete|call|convert)\b|[`()[\]{}=]/i;
const FINAL_VALUE_REQUEST =
  /\b(?:final (?:score|value|result|output)|tell me (?:the )?(?:score|value|result|output))\b/i;

function firstVisibleIdentifier(params: Pick<AIAskParams, "files">): string | null {
  for (const file of params.files) {
    for (const line of file.content.split("\n")) {
      if (INSTRUCTION_INJECTION.test(line)) continue;
      const identifier = line.match(
        /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=/,
      )?.[1];
      if (identifier && !/_CANARY_/i.test(identifier)) return identifier;
    }
  }
  return null;
}

function likelyVisibleIdentifierTypo(
  params: Pick<AIAskParams, "files">,
): { declared: string; used: string; path: string; line: number } | null {
  const declared = firstVisibleIdentifier(params);
  if (!declared || declared.length < 3) return null;
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [index, line] of lines.entries()) {
      if (INSTRUCTION_INJECTION.test(line)) continue;
      for (const token of line.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []) {
        if (token === declared || token.length !== declared.length) continue;
        const mismatches = [...token].filter((char, position) => char !== declared[position]);
        if (
          mismatches.length === 2 &&
          [...token].sort().join("") === [...declared].sort().join("")
        ) {
          return { declared, used: token, path: file.path, line: index + 1 };
        }
      }
    }
  }
  return null;
}

function firstQuestionMentionedCall(
  params: Pick<AIAskParams, "files" | "question">,
): string | null {
  const question = params.question.toLocaleLowerCase();
  for (const file of params.files) {
    for (const line of file.content.split("\n")) {
      if (INSTRUCTION_INJECTION.test(line)) continue;
      for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        const symbol = match[1];
        if (question.includes(symbol.toLocaleLowerCase())) return symbol;
      }
    }
  }
  return null;
}

function questionUsesVisibleAnchor(
  question: string,
  params: Pick<AIAskParams, "files">,
): boolean {
  const identifier = firstVisibleIdentifier(params);
  const visibleSource = params.files
    .flatMap((file) => file.content.split("\n"))
    .filter((line) => line.trim() && !INSTRUCTION_INJECTION.test(line));
  if (!identifier) {
    if (visibleSource.length === 0) return true;
    const visibleCalls = new Set(
      visibleSource.flatMap((line) =>
        [...line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]),
      ),
    );
    return (
      [...visibleCalls].some((symbol) =>
        new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question),
      ) ||
      /\b(?:this|that|visible|current)\s+(?:line|file|code|value|expression|output)\b/i.test(
        question,
      )
    );
  }
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`\\b${escaped}\\b`, "i").test(question) ||
    /\b(?:this|that|visible|current)\s+(?:line|file|code|value|variable|expression|output)\b/i.test(
      question,
    )
  );
}

function fallbackClarifyingQuestion(params: TutorPolicyParams): string {
  const stderr = params.lastRun?.stderr?.trim() ?? "";
  if (stderr) {
    const line = stderr.match(/(?:line\s+|:)(\d+)(?::\d+)?/i)?.[1];
    if (/syntaxerror/i.test(stderr) && /(?:never closed|unmatched|expected ['"]?\)?)/i.test(stderr)) {
      return `The latest run reports an unmatched delimiter${line ? ` on line ${line}` : ""}. Which opening symbol still needs its matching partner?`;
    }
    const errorName = stderr.match(/\b([A-Za-z]+(?:Error|Exception))\b/)?.[1];
    if (errorName) {
      return `The latest run reports ${errorName}${line ? ` on line ${line}` : ""}. Which value or operation on that line does the message point to?`;
    }
  }
  const identifier = firstVisibleIdentifier(params);
  const calledSymbol = firstQuestionMentionedCall(params);
  const named = identifier ? `\`${identifier}\`` : "the visible code";
  const visibleLines = params.files.flatMap((file) => file.content.split("\n"));
  const executableLines = visibleLines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !/^(?:#|\/\/)/.test(trimmed) && !INSTRUCTION_INJECTION.test(trimmed);
  });
  const mentionedOutputCall = visibleLines
    .flatMap((line) => [...line.matchAll(/\b(print|console\.log)\s*\(/g)])
    .map((match) => match[1])[0];
  if (hasActualFileDiff(params.diffSinceLastTurn)) {
    return "Which visible behavior do you expect the edited line to change?";
  }

  if (executableLines.length === 0 && mentionedOutputCall) {
    return `What text do you want your first \`${mentionedOutputCall}()\` statement to display?`;
  }
  if (executableLines.length === 0) {
    return "What should the finished program display or change when it runs?";
  }
  if (/\b(?:right|correct|on the right track|choice|answer)\b/i.test(params.question)) {
    if (mentionedOutputCall) {
      return `What output do you predict from the visible \`${mentionedOutputCall}()\` call, and how does that support your choice?`;
    }
    return "What evidence led you to your current conclusion?";
  }
  if (/\b(?:walk(?:\s+me)?\s+through|walkthrough|line\s+by\s+line)\b/i.test(params.question)) {
    return `Which part of how ${named} behaves do you want to understand first?`;
  }
  if (
    params.lastRun ||
    /\b(?:wrong|errors?|exceptions?|unexpected|bugs?|broken|fail(?:s|ed|ing)?|doesn'?t work|does not work)\b/i.test(
      params.question,
    )
  ) {
    if (calledSymbol && /\b(?:errors?|exceptions?|fail(?:s|ed|ing)?|doesn'?t work|does not work)\b/i.test(params.question)) {
      return `What error did \`${calledSymbol}\` produce, and what did you want that call to do?`;
    }
    return `What result did you expect from ${named}, and how does it differ from what you observed?`;
  }
  if (/^\s*(?:what (?:is|are|does)|why|explain)\b/i.test(params.question)) {
    if (identifier) {
      return `What do you think \`${identifier}\` represents in this file?`;
    }
    return "What have you already noticed about this idea, and what part still feels unclear?";
  }
  if (/\b(?:how (?:do|can|should)|make|build|create)\b/i.test(params.question)) {
    if (identifier) {
      return `What have you tried with \`${identifier}\`, and what result do you want to see?`;
    }
    return "What have you tried so far, and where did it stop matching what you wanted?";
  }
  if (
    identifier &&
    FINAL_VALUE_REQUEST.test(params.question)
  ) {
    return `What value do you predict \`${identifier}\` will have after the visible code runs, and why?`;
  }
  if (identifier) {
    return `What did you expect \`${identifier}\` to do, and what have you observed instead?`;
  }
  return "What did you expect to happen, and what happened instead?";
}

function clarifyingQuestion(
  sections: TutorSections,
  params: TutorPolicyParams,
): string {
  if (firstVisibleIdentifier(params) && FINAL_VALUE_REQUEST.test(params.question)) {
    return fallbackClarifyingQuestion(params);
  }
  const learnerReportedMismatch =
    !!params.lastRun ||
    /\b(?:wrong|errors?|exceptions?|unexpected|bugs?|broken|fail(?:s|ed|ing)?|doesn'?t work|does not work)\b/i.test(
      params.question,
    );
  const candidates = [
    ...(sections.checkQuestions ?? []),
    sections.comprehensionCheck,
  ];
  for (const candidate of candidates) {
    const safe = safeAction(candidate, params);
    if (
      safe &&
      !learnerReportedMismatch &&
      /\b(?:observed instead|differ(?:s|ed)? from what you observed)\b/i.test(safe)
    ) {
      continue;
    }
    if (
      safe &&
      safe.length <= 220 &&
      !safe.includes("\n") &&
      safe.endsWith("?") &&
      OPEN_CLARIFYING_QUESTION.test(safe) &&
      SOCRATIC_EVIDENCE_QUESTION.test(safe) &&
      !LEADING_QUESTION.test(safe) &&
      questionUsesVisibleAnchor(safe, params)
    ) {
      return safe;
    }
  }
  return fallbackClarifyingQuestion(params);
}

function visibleConditionalChain(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  explain: string;
  example: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (
    params.lessonContext?.language !== "python" ||
    !/\belif\b/i.test(params.question) ||
    !/\b(?:multiple|separate)\s+ifs?\b/i.test(params.question)
  ) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const line = lines.findIndex((content) => /^\s*elif\b/.test(content));
    if (line < 0 || !lines.some((content) => /^\s*if\b/.test(content))) continue;
    return {
      explain:
        "In the visible `if`/`elif` chain, Python stops checking that chain after the first matching branch. Separate `if` statements are independent, so more than one branch can run when their conditions overlap.",
      example:
        "Use one chain for mutually exclusive choices; use separate `if` statements when every matching check should run.",
      citation: {
        path: file.path,
        line: line + 1,
        column: null,
        reason: "First alternative branch in the visible conditional chain",
      },
    };
  }
  return null;
}

function visibleJsConstBinding(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  summary: string;
  explain: string;
  example: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (
    params.lessonContext?.language !== "javascript" ||
    !/\bconst\b/i.test(params.question)
  ) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [index, line] of lines.entries()) {
      const identifier = line.match(
        /^\s*const\s+([A-Za-z_$][\w$]*)\s*=/,
      )?.[1];
      if (!identifier) continue;
      return {
        summary: `\`const\` makes the \`${identifier}\` binding non-reassignable after initialization.`,
        explain:
          `In the current file, \`${identifier}\` cannot be assigned a different value after this declaration; a \`let\` binding can be reassigned. ` +
          "For objects and arrays, `const` protects the binding, not the contents inside the value.",
        example:
          `Here, \`${identifier}\` is the visible \`const\` binding; use \`const\` when that name should keep pointing to the same value.`,
        citation: {
          path: file.path,
          line: index + 1,
          column: null,
          reason: `Visible const declaration for ${identifier}`,
        },
      };
    }
  }
  return null;
}

function visibleConceptAnchor(
  params: Pick<AIAskParams, "files">,
): { example: string; citation: NonNullable<TutorSections["citations"]>[number] } | null {
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [index, line] of lines.entries()) {
      const identifier = line.match(/^\s*([A-Za-z_$][\w$]*)\s*=/)?.[1];
      if (!identifier) continue;
      return {
        example: `In your current file, \`${identifier}\` is a visible example of this concept.`,
        citation: {
          path: file.path,
          line: index + 1,
          column: null,
          reason: "Current code used for this explanation",
        },
      };
    }
  }
  return null;
}

function visibleCodeCitation(
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["citations"]>[number] | null {
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index].trim() || INSTRUCTION_INJECTION.test(lines[index])) continue;
      return {
        path: file.path,
        line: index + 1,
        column: null,
        reason: "Current code used for this guidance",
      };
    }
  }
  return null;
}

const EXPLICIT_HINT_REQUEST =
  /\b(?:give|offer|provide|share|show) me (?:a |another )?(?:gentle|small|tiny|first|stronger)?\s*(?:hint|nudge|clue)\b|\b(?:can|could|would|will) you (?:give|offer|provide|share|show) (?:me )?(?:a |another )?(?:gentle|small|tiny|first|stronger)?\s*(?:hint|nudge|clue)\b|^(?:please\s+)?(?:a\s+)?(?:gentle|small|tiny|first|stronger)?\s*(?:hint|nudge|clue)\b|\bpoint me in the right direction\b|\bhelp me get started\b/i;

function visibleOutputOperation(
  params: Pick<AIAskParams, "files">,
): {
  path: string;
  line: number;
  call: "print" | "console.log";
  hasArgument: boolean;
} | null {
  for (const file of params.files) {
    for (const [index, source] of file.content.split("\n").entries()) {
      if (/^\s*(?:#|\/\/)/.test(source)) continue;
      const match = source.match(/\b(print|console\.log)\s*\((.*)\)/);
      if (!match || INSTRUCTION_INJECTION.test(source)) continue;
      return {
        path: file.path,
        line: index + 1,
        call: match[1] as "print" | "console.log",
        hasArgument: match[2].trim().length > 0,
      };
    }
  }
  return null;
}

function lessonGoal(params: TutorPolicyParams): string | null {
  const objective = params.lessonContext?.lessonObjectives.find((item) => item.trim());
  return objective?.replace(/[.!]+$/, "") ?? null;
}

function groundedGentleHint(params: TutorPolicyParams): {
  summary: string;
  hint: string;
  nextStep: string;
  question: string;
  citations: TutorSections["citations"];
} {
  const current = socraticValue(params);
  const hasVisibleCondition = params.files.some((file) =>
    file.content.split("\n").some((line) =>
      /^\s*(?:if|elif)\s+.+:?\s*$|^\s*(?:if|else\s+if)\s*\(.+\)/.test(line),
    ),
  );
  if (params.lastRun || hasActualFileDiff(params.diffSinceLastTurn) || hasVisibleCondition) {
    return {
      summary: current.summary ?? "The latest visible evidence should guide the next change.",
      hint: current.hint ?? "Use the cited result to narrow the next inspection to one line.",
      nextStep: "Run the smallest relevant case and compare the new result with this evidence.",
      question: current.question ?? clarifyingQuestion({}, params),
      citations: current.citations ?? null,
    };
  }

  const output = visibleOutputOperation(params);
  if (output) {
    const goal = lessonGoal(params);
    return {
      summary: `Your current line already uses \`${output.call}()\`, so the output operation itself is in place.`,
      hint: output.hasArgument
        ? `The text or expression inside \`${output.call}()\` is the part that determines what appears in Output${goal ? `; compare only that part with the lesson goal to ${goal.charAt(0).toLowerCase()}${goal.slice(1)}` : ""}.`
        : `The \`${output.call}()\` call is empty; decide which lesson result belongs inside its parentheses without changing the output operation.`,
      nextStep: `Run this exact line once, then compare the visible Output with the lesson request before editing anything else.`,
      question: `Which part inside \`${output.call}()\` controls the message the learner sees?`,
      citations: [{
        path: output.path,
        line: output.line,
        column: null,
        reason: "Current output operation and its visible argument",
      }],
    };
  }

  const goal = lessonGoal(params);
  return {
    summary: current.summary ?? (goal
      ? `The current task is to ${goal.charAt(0).toLowerCase()}${goal.slice(1)}.`
      : "The next useful move should be tied to the current file, not a guessed final answer."),
    hint: current.hint ?? (goal
      ? `Choose the smallest visible line that contributes to the goal to ${goal.charAt(0).toLowerCase()}${goal.slice(1)}, and predict its result before changing it.`
      : "Choose one visible line, predict its result, and run that smallest case before adding another step."),
    nextStep: "Run the smallest current case and use its actual output or error as the next piece of evidence.",
    question: current.question ?? clarifyingQuestion({}, params),
    citations: current.citations ?? null,
  };
}

function socraticValue(
  params: TutorPolicyParams,
): Pick<TutorSections, "summary" | "hint" | "citations"> & {
  question?: string;
} {
  const stderr = params.lastRun?.stderr?.trim() ?? "";
  if (stderr) {
    const line = Number(stderr.match(/(?:line\s+|:)(\d+)(?::\d+)?/i)?.[1] ?? 0);
    const citedFile = line > 0
      ? params.files.find((file) => line <= file.content.split("\n").length)
      : null;
    const errorName = stderr.match(/\b([A-Za-z]+(?:Error|Exception))\b/)?.[1] ?? "error";
    return {
      summary: `The latest run stopped with ${errorName}${line > 0 ? ` on line ${line}` : ""}, before the program could finish.`,
      hint: /(?:never closed|unmatched|expected ['"]?\)?)/i.test(stderr)
        ? "Check the cited line for an opening delimiter that does not yet have its matching partner."
        : "Use the error name and cited line to narrow the problem to one value or operation before changing anything else.",
      citations: citedFile
        ? [{
            path: citedFile.path,
            line,
            column: null,
            reason: "Latest run stopped at this line",
          }]
        : null,
    };
  }

  const stdout = params.lastRun?.stdout?.trim() ?? "";
  if (params.lastRun?.exitCode === 0) {
    const outputPreview = stdout
      ? stdout.replace(/\s+/g, " ").replace(/`/g, "'").slice(0, 100)
      : null;
    const citation = params.files.flatMap((file) =>
      file.content.split("\n").map((content, index) => ({ file, content, index })),
    ).find(({ content }) => /\b(?:print|console\.log)\s*\(/.test(content));
    return {
      summary: outputPreview
        ? `The latest run completed and displayed \`${outputPreview}\`.`
        : "The latest run completed without displaying any output.",
      hint: "Compare that observed output with the exact result you expected before deciding which expression to inspect.",
      citations: citation
        ? [{
            path: citation.file.path,
            line: citation.index + 1,
            column: null,
            reason: "Visible output operation from the latest successful run",
          }]
        : null,
    };
  }

  if (hasActualFileDiff(params.diffSinceLastTurn)) {
    const citation = visibleCodeCitation(params);
    return {
      summary: "The visible code has changed since the previous tutor turn, but there is no newer run result yet.",
      hint: "Predict what the edited line should change, then run it once and compare that prediction with the observed result.",
      citations: citation ? [citation] : null,
    };
  }

  const identifierTypo = likelyVisibleIdentifierTypo(params);
  if (identifierTypo) {
    return {
      summary:
        `The declaration uses \`${identifierTypo.declared}\`, while the later line uses a differently spelled identifier, \`${identifierTypo.used}\`.`,
      hint: "Compare those two spellings character by character before changing the program structure.",
      citations: [{
        path: identifierTypo.path,
        line: identifierTypo.line,
        column: null,
        reason: "Later identifier spelling differs from the visible declaration",
      }],
    };
  }

  const mentionedCall = firstQuestionMentionedCall(params);
  if (mentionedCall) {
    for (const file of params.files) {
      const lines = file.content.split("\n");
      const callIndex = lines.findIndex((line) =>
        new RegExp(`\\b${mentionedCall.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(line),
      );
      if (callIndex < 0) continue;
      return {
        summary: `The current file calls \`${mentionedCall}()\` on line ${callIndex + 1}.`,
        hint: "Use the exact error from running that call to separate a spelling/API problem from a data problem before choosing a replacement.",
        citations: [{
          path: file.path,
          line: callIndex + 1,
          column: null,
          reason: `Visible ${mentionedCall}() call named in the learner's question`,
        }],
      };
    }
  }

  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [conditionIndex, rawCondition] of lines.entries()) {
      const pythonCondition = rawCondition.match(/^\s*(?:if|elif)\s+(.+?)\s*:\s*$/)?.[1];
      const jsCondition = rawCondition.match(/^\s*(?:if|else\s+if)\s*\((.+)\)\s*\{?\s*$/)?.[1];
      const condition = pythonCondition ?? jsCondition;
      if (!condition) continue;
      const identifier = condition.match(/\b([A-Za-z_$][\w$]*)\b/)?.[1] ?? null;
      let visibleValue: string | null = null;
      if (identifier) {
        for (let index = conditionIndex - 1; index >= 0; index -= 1) {
          const assignment = lines[index].match(
            new RegExp(`^\\s*(?:(?:const|let|var)\\s+)?${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.+?);?\\s*$`),
          );
          if (!assignment) continue;
          visibleValue = assignment[1].replace(/;$/, "").trim();
          break;
        }
      }
      const subject = identifier && visibleValue
        ? ` after \`${identifier}\` is assigned \`${visibleValue}\``
        : "";
      return {
        summary: `Line ${conditionIndex + 1} tests \`${condition}\`${subject}.`,
        hint: "Evaluate that comparison as `True` or `False` first, then follow only the branch attached to that result.",
        question: identifier && visibleValue
          ? `With \`${identifier}\` currently \`${visibleValue}\`, what result does \`${condition}\` produce, and which branch follows from that?`
          : `What result does the visible condition \`${condition}\` produce, and which branch follows from that?`,
        citations: [{
          path: file.path,
          line: conditionIndex + 1,
          column: null,
          reason: "Visible condition that chooses the next branch",
        }],
      };
    }
  }

  for (const file of params.files) {
    const lines = file.content.split("\n");
    const executableIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      return trimmed && !/^(?:#|\/\/)/.test(trimmed) && !INSTRUCTION_INJECTION.test(trimmed);
    });
    if (executableIndex >= 0) {
      const content = lines[executableIndex].trim();
      const call = content.match(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/)?.[1];
      const assignment = content.match(
        /^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/,
      );
      if (assignment) {
        const [, identifier, rawValue] = assignment;
        const value = rawValue.replace(/;$/, "");
        const listItems = value.match(/^\[(.*)\]$/)?.[1]
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        return {
          summary: listItems
            ? `Line ${executableIndex + 1} creates \`${identifier}\` with ${listItems.length} visible ${listItems.length === 1 ? "item" : "items"}.`
            : `Line ${executableIndex + 1} assigns the visible value \`${value}\` to \`${identifier}\`.`,
          hint: listItems
            ? "Decide whether the goal needs one result per item or one combined result before choosing the repetition step."
            : "Track the name on the left of `=` and the value on the right separately, then predict which one can change later.",
          citations: [{
            path: file.path,
            line: executableIndex + 1,
            column: null,
            reason: `Visible assignment that introduces ${identifier}`,
          }],
        };
      }
      return {
        summary: `The first executable line is line ${executableIndex + 1}${call ? `, where \`${call}()\` is used` : ""}.`,
        hint: "Predict what that line should change or display, then run the smallest test that can confirm the prediction.",
        citations: [{
          path: file.path,
          line: executableIndex + 1,
          column: null,
          reason: "First executable line in the current file",
        }],
      };
    }

    const outputCommentIndex = lines.findIndex((line) => /\b(?:print|console\.log)\s*\(/.test(line));
    if (outputCommentIndex >= 0) {
      const outputCall = lines[outputCommentIndex].match(/\b(print|console\.log)\s*\(/)?.[1] ?? "output";
      return {
        summary: "The current file contains only comments, so running it cannot display anything yet.",
        hint: `The lesson points to \`${outputCall}()\` as the output operation; choose the text you want your program to show before writing the statement.`,
        citations: [{
          path: file.path,
          line: outputCommentIndex + 1,
          column: null,
          reason: "Starter comment identifies the lesson's output operation",
        }],
      };
    }
  }

  return {
    summary: "There is not enough executable code yet to compare behavior or output.",
    hint: "Start with one small statement tied to the lesson objective, then run it before adding another step.",
    citations: null,
  };
}

export function closeTutorTurnAtAllowanceBoundary(
  sections: TutorSections,
  remainingToday: number | null,
): TutorSections {
  if (remainingToday !== 0) return sections;
  const closed: TutorSections = {
    ...sections,
    comprehensionCheck: null,
    checkQuestions: null,
  };
  if (closed.intent === "socratic") {
    closed.intent = "howto";
    closed.nextStep = closed.nextStep ??
      "Use the clue above in the editor, run the smallest change you can, and compare the result with your prediction.";
  }
  return closed;
}

function visibleConcreteExample(
  params: Pick<AIAskParams, "files">,
): string | null {
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [index, raw] of lines.entries()) {
      if (INSTRUCTION_INJECTION.test(raw)) continue;
      const assignment = raw.trim().match(
        /^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/,
      );
      if (!assignment) continue;
      const [, name, expression] = assignment;
      const excerpt = expression.length > 100
        ? `${expression.slice(0, 97)}…`
        : expression;
      return `On line ${index + 1}, \`${name}\` receives the value from \`${excerpt}\`. Try a small input, predict what \`${name}\` contains at that point, then run and compare.`;
    }
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (!line || INSTRUCTION_INJECTION.test(line)) continue;
      const excerpt = line.length > 120 ? `${line.slice(0, 117)}…` : line;
      return `In the current file, line ${index + 1} is the concrete example: \`${excerpt}\`. Trace what value that visible line receives and what effect it has when the program runs.`;
    }
  }
  return null;
}

function pythonSingleListAddition(
  params: Pick<AIAskParams, "files" | "lessonContext">,
): { variable: string; method: string; path: string; line: number } | null {
  if (params.lessonContext?.language !== "python") return null;
  for (const file of params.files) {
    const listVariables = new Set(
      [...file.content.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*\[[^\n]*\]\s*$/gm)].map(
        (match) => match[1],
      ),
    );
    for (const match of file.content.matchAll(
      /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\s*(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_]\w*)\s*\)/g,
    )) {
      const [, variable, method] = match;
      if (
        listVariables.has(variable) &&
        !isStandardApiSymbol("python", method)
      ) {
        return {
          variable,
          method,
          path: file.path,
          line: file.content.slice(0, match.index).split("\n").length,
        };
      }
    }
  }
  return null;
}

function visibleCollectionHowto(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  summary: string;
  explain: string;
  hint: string;
  nextStep: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  const language = params.lessonContext?.language;
  for (const file of params.files) {
    const match = file.content.match(
      /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*\[[^\n]*\]\s*;?\s*$/m,
    );
    if (!match) continue;
    const variable = match[1];
    const line = file.content.slice(0, match.index).split("\n").length;
    const citation = {
      path: file.path,
      line,
      column: null,
      reason: `Visible collection named ${variable}`,
    };
    if (
      language === "python" &&
      /\badd\b[^.!?]{0,40}\bitem\b|\bitem\b[^.!?]{0,40}\blist\b/i.test(params.question)
    ) {
      return {
        summary: `The current \`${variable}\` list can add one item without replacing the values already inside it.`,
        explain: `Python's \`append()\` list method adds one item to the end of the existing \`${variable}\` list.`,
        hint: `Use the method on \`${variable}\` itself and pass only the one new item you want to add.`,
        nextStep: `Add one item to \`${variable}\`, then run the current print line and check that the list grew by exactly one entry.`,
        citation,
      };
    }
    if (language === "javascript" && /\bprintAll\b/i.test(params.question)) {
      return {
        summary: `The current \`${variable}\` array needs an iteration step rather than a fabricated display method.`,
        explain: `That proposed display method is not part of JavaScript arrays. To show every value in \`${variable}\`, visit each item once and log that current item.`,
        hint: "Use a standard iteration method such as `forEach()` rather than inventing a display method on the array.",
        nextStep: `Start one iteration over \`${variable}\` and decide what name represents the current item before adding the log action.`,
        citation,
      };
    }
  }
  return null;
}

function visiblePythonListSortCorrection(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  summary: string;
  explain: string;
  example: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (
    params.lessonContext?.language !== "python" ||
    !/\bsort(?:s|ed|ing)?\b/i.test(params.question)
  ) {
    return null;
  }
  for (const file of params.files) {
    const listVariables = new Set(
      [...file.content.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*\[[^\n]*\]\s*$/gm)].map(
        (match) => match[1],
      ),
    );
    for (const match of file.content.matchAll(
      /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\s*\)/g,
    )) {
      const [, variable, method] = match;
      if (
        !listVariables.has(variable) ||
        isStandardApiSymbol("python", method)
      ) {
        continue;
      }
      const line = file.content.slice(0, match.index).split("\n").length;
      return {
        summary: `\`${method}()\` is not a Python list method; the standard in-place sorting method is \`sort()\`.`,
        explain:
          `Calling \`${variable}.sort()\` rearranges that existing list and returns \`None\`. ` +
          "The separate `sorted()` function is the alternative when you need a new sorted list without changing the original.",
        example:
          `Because the visible call is on \`${variable}\`, compare its method name with the standard list method \`sort()\`.`,
        citation: {
          path: file.path,
          line,
          column: null,
          reason: `Non-standard \`${method}()\` call on the visible list`,
        },
      };
    }
  }
  return null;
}

function visibleNoOutputDebug(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  summary: string;
  diagnose: string;
  checkQuestion: string;
  hint: string;
  nextStep: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (
    params.lessonContext?.language !== "python" ||
    !/\b(?:doesn'?t|does not|doesnt|won'?t|will not)\s+print\b|\bno output\b/i.test(
      params.question,
    )
  ) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    if (lines.some((line) => /^\s*print\s*\(/.test(line))) continue;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const content = lines[index].trim();
      if (!content || INSTRUCTION_INJECTION.test(content)) continue;
      return {
        summary: "The file builds a value, but no statement sends that value to the output.",
        diagnose:
          "Python evaluates the final expression, but a script does not display that value automatically.",
        checkQuestion: "Which operation from this lesson displays a value when a script runs?",
        hint: "Compare the final expression with the lesson’s standard output operation.",
        nextStep:
          "Use `print()` around the existing final expression, then run the file again and inspect the output.",
        citation: {
          path: file.path,
          line: index + 1,
          column: null,
          reason: "Expression is evaluated here but is not displayed",
        },
      };
    }
  }
  return null;
}

function visibleInputOutputCheckin(
  params: Pick<AIAskParams, "files" | "lessonContext">,
): {
  diagnose: string;
  nextStep: string;
  citations: NonNullable<TutorSections["citations"]>;
} | null {
  if (params.lessonContext?.language !== "python") return null;
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [inputIndex, line] of lines.entries()) {
      const variable = line.match(
        /^\s*([A-Za-z_]\w*)\s*=\s*input\s*\(/,
      )?.[1];
      if (!variable) continue;
      const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const outputIndex = lines.findIndex(
        (candidate, index) =>
          index > inputIndex &&
          /^\s*print\s*\(/.test(candidate) &&
          new RegExp(`\\b${escaped}\\b`).test(candidate),
      );
      if (outputIndex < 0) continue;
      return {
        diagnose:
          `The visible approach is sound: the first cited line reads a value into \`${variable}\`, and the second uses \`${variable}\` in the greeting output.`,
        nextStep:
          "Predict the exact greeting for one short name, run the program, and compare the output with your prediction.",
        citations: [
          {
            path: file.path,
            line: inputIndex + 1,
            column: null,
            reason: `Reads the learner’s input into ${variable}`,
          },
          {
            path: file.path,
            line: outputIndex + 1,
            column: null,
            reason: `Uses ${variable} in the greeting output`,
          },
        ],
      };
    }
  }
  return null;
}

function visiblePythonInputHowto(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  explain: string;
  nextStep: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (
    params.lessonContext?.language !== "python" ||
    !/\b(?:input|ask(?:ing)? (?:the )?user|asks? for (?:a|the) name|their name)\b/i.test(params.question) ||
    !/\b(?:prints?|display|show|back)\b/i.test(params.question)
  ) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const printIndex = lines.findIndex((line) => /^\s*print\s*\(/.test(line));
    if (printIndex >= 0) {
      return {
        explain:
          "First store the value returned by `input()` in a variable; then use that variable in the existing `print()` call.",
        nextStep:
          `Add one \`input()\` assignment immediately before line ${printIndex + 1}, then run the file and enter a short name before changing the greeting.`,
        citation: {
          path: file.path,
          line: printIndex + 1,
          column: null,
          reason: "Existing output line that will use the captured name",
        },
      };
    }

    const firstVisibleIndex = lines.findIndex(
      (line) => line.trim() && !INSTRUCTION_INJECTION.test(line),
    );
    if (firstVisibleIndex >= 0) {
      return {
        explain:
          "`input()` produces the learner's name value; capture that value first so the later greeting has something specific to display.",
        nextStep:
          "Add only the name-capture assignment beneath the current placeholder, run it with a short name, and inspect that value before adding the greeting output.",
        citation: {
          path: file.path,
          line: firstVisibleIndex + 1,
          column: null,
          reason: "Current placeholder for the first name-input step",
        },
      };
    }
  }
  return null;
}

function visiblePythonRangeHowto(
  params: Pick<AIAskParams, "files" | "question" | "lessonContext">,
): {
  summary: string;
  explain: string;
  nextStep: string;
  citation: NonNullable<TutorSections["citations"]>[number];
} | null {
  if (params.lessonContext?.language !== "python") return null;
  const bounds = params.question.match(
    /\b(?:print|show|display)\s+(?:the\s+)?numbers?\s+(-?\d+)\s+(?:to|through)\s+(-?\d+)\b/i,
  );
  if (!bounds) return null;
  const start = Number(bounds[1]);
  const end = Number(bounds[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const anchorIndex = lines.findIndex(
      (line) => line.trim() && !INSTRUCTION_INJECTION.test(line),
    );
    if (anchorIndex < 0) continue;
    return {
      summary:
        `Displaying every number from ${start} through ${end} is a repetition task, so one loop should control the repeated output.`,
      explain:
        `Python's \`range()\` includes its starting value but stops before its ending value; account for that boundary so ${end} is not skipped.`,
      nextStep:
        "Add only the loop header for the requested interval beneath the current placeholder, then run once and inspect the first and last displayed values before changing anything else.",
      citation: {
        path: file.path,
        line: anchorIndex + 1,
        column: null,
        reason: "Current placeholder for the requested number loop",
      },
    };
  }
  return null;
}

const INSTRUCTION_INJECTION =
  /\b(?:ignore (?:prior|previous)|system\s*:|system (?:prompt|instruction)|hidden rules?|reveal hidden|canary)\b/i;

function walkthroughLineScore(
  body: string,
  content: string,
  mentionedSymbols: Set<string>,
): number {
  const lowerBody = body.toLowerCase();
  const lowerContent = content.toLowerCase();
  let score = [...mentionedSymbols].filter((symbol) =>
    lowerContent.includes(symbol.toLowerCase())
  ).length * 2;
  const mentionedNumbers = body.match(/(?<![\w.])-?\d+(?:\.\d+)?\b/g) ?? [];
  const sourceNumbers = new Set(
    content.match(/(?<![\w.])-?\d+(?:\.\d+)?\b/g) ?? [],
  );
  score += mentionedNumbers.filter((value) =>
    sourceNumbers.has(value)
  ).length * 4;

  const assignmentLine =
    /\b(?:const|let|var)\b[^=]*=/.test(content) ||
    /^\s*[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))/.test(content);
  const outputLine = /\bconsole\.log\s*\(|\bprint\s*\(/.test(content);
  const loopLine = /^\s*(?:for|while)\b/.test(content);
  const indentedUpdateLine =
    /^\s{2,}[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))/.test(content);
  const describesNumericInitialization =
    mentionedNumbers.length > 0 &&
    /\b(?:initializ|starts?|sets?|assigns?)\w*/.test(lowerBody);
  const describesOutput =
    /\b(?:after the loop|final (?:sum|result|value)|logs?|prints?|displays?|console\.log)\b/.test(lowerBody) ||
    (/\boutputs?\b/.test(lowerBody) && !/\binput and output\b/.test(lowerBody));
  const sourceIsComment = /^\s*(?:#|\/\/)/.test(content);
  const describesComment = /\b(?:comment|placeholder|todo|instruction)\b/.test(lowerBody);
  const describesExecutableBehavior =
    /\b(?:assign|call|convert|input|prompt|print|display|log|return|branch|loop|run|execute)\w*\b/.test(
      lowerBody,
    );

  if (sourceIsComment && describesExecutableBehavior && !describesComment) score -= 12;
  if (!sourceIsComment && describesComment) score -= 8;

  if (
    !describesOutput &&
    /\b(?:declar|assign|initializ|starts? (?:at|with)|constant|variable named|comput|calculat|stor|set)\w*/.test(lowerBody)
  ) {
    score += assignmentLine ? 7 : 0;
    score -= outputLine ? 4 : 0;
  }
  if (/\b(?:for|while) loop\b|\b(?:iterat|goes? through|loops? over)\w*/.test(lowerBody)) {
    score += loopLine ? 8 : 0;
  }
  if (
    !describesNumericInitialization &&
    /\b(?:inside|within) the loop\b|\b(?:add|increment|accumulat|updat)\w*\b/.test(lowerBody)
  ) {
    score += indentedUpdateLine ? 8 : 0;
    score -= outputLine ? 4 : 0;
  }
  if (describesOutput) {
    score += outputLine ? 9 : 0;
    if (/\bafter the loop\b|\bfinal (?:sum|result|value)\b/.test(lowerBody)) {
      score -= indentedUpdateLine ? 4 : 0;
    }
  }
  return score;
}

function compareNumericValues(left: number, operator: string, right: number): boolean {
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  return false;
}

function visiblePythonConditionalWalkthrough(
  params: Pick<AIAskParams, "files" | "lessonContext">,
): NonNullable<TutorSections["walkthrough"]> | null {
  if (params.lessonContext?.language !== "python") return null;
  for (const file of params.files) {
    const lines = file.content.split("\n");
    for (const [assignmentIndex, assignmentLine] of lines.entries()) {
      const assignment = assignmentLine.match(
        /^\s*([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/,
      );
      if (!assignment) continue;
      const [, variable, rawValue] = assignment;
      const value = Number(rawValue);
      const steps: NonNullable<TutorSections["walkthrough"]> = [{
        body: `\`${variable}\` starts with the value \`${rawValue}\`.`,
        path: file.path,
        line: assignmentIndex + 1,
      }];
      let sawConditional = false;
      let matched = false;

      for (let index = assignmentIndex + 1; index < lines.length; index += 1) {
        const condition = lines[index].match(
          new RegExp(
            `^\\s*(if|elif)\\s+${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(>=|<=|>|<|==|!=)\\s*(-?\\d+(?:\\.\\d+)?)\\s*:\\s*$`,
          ),
        );
        if (condition) {
          sawConditional = true;
          const [, , operator, rawRight] = condition;
          const passes = !matched && compareNumericValues(value, operator, Number(rawRight));
          steps.push({
            body: passes
              ? `\`${variable} ${operator} ${rawRight}\` is true, so this branch runs and later branches are skipped.`
              : `\`${variable} ${operator} ${rawRight}\` is false, so Python continues to the next branch.`,
            path: file.path,
            line: index + 1,
          });
          if (passes) {
            matched = true;
            const bodyIndex = lines.findIndex(
              (line, candidate) => candidate > index && /^\s+\S/.test(line),
            );
            if (bodyIndex > index) {
              const printed = lines[bodyIndex].match(/^\s*print\s*\((.+)\)\s*$/)?.[1];
              steps.push({
                body: printed
                  ? `This line displays \`${printed}\`.`
                  : "This line runs as the body of the matching branch.",
                path: file.path,
                line: bodyIndex + 1,
              });
            }
            break;
          }
          continue;
        }
        if (sawConditional && !matched && /^\s*else\s*:\s*$/.test(lines[index])) {
          steps.push({
            body: "No earlier condition matched, so the `else` branch runs.",
            path: file.path,
            line: index + 1,
          });
          const bodyIndex = lines.findIndex(
            (line, candidate) => candidate > index && /^\s+\S/.test(line),
          );
          if (bodyIndex > index) {
            const printed = lines[bodyIndex].match(/^\s*print\s*\((.+)\)\s*$/)?.[1];
            steps.push({
              body: printed
                ? `This line displays \`${printed}\`.`
                : "This line runs as the body of the `else` branch.",
              path: file.path,
              line: bodyIndex + 1,
            });
          }
          matched = true;
          break;
        }
      }
      if (sawConditional && matched) return steps.slice(0, 6);
    }
  }
  return null;
}

function requestedWalkthroughStart(
  params: Pick<AIAskParams, "files" | "question">,
): { path: string; line: number; content: string } | null {
  if (!/\bcontinue\b/i.test(params.question)) return null;
  const wantsOutput = /\b(?:log(?:ging)?|console\.log|print(?:ing)?|output)\b/i.test(
    params.question,
  );
  const wantsReturn = /\breturn(?:ing)?\b/i.test(params.question);
  const wantsLoop = /\bloop(?:ing)?\b/i.test(params.question);
  if (!wantsOutput && !wantsReturn && !wantsLoop) return null;
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const index = lines.findIndex((line) =>
      (wantsOutput && /\b(?:console\.log|print)\s*\(/.test(line)) ||
      (wantsReturn && /^\s*return\b/.test(line)) ||
      (wantsLoop && /^\s*(?:for|while)\b/.test(line)),
    );
    if (index >= 0) return { path: file.path, line: index + 1, content: lines[index] };
  }
  return null;
}

function continuationFallbackStep(
  continuation: { path: string; line: number; content: string },
): NonNullable<TutorSections["walkthrough"]>[number] {
  const logged = continuation.content.match(/\bconsole\.log\s*\(\s*([A-Za-z_$][\w$]*)/i)?.[1];
  const printed = continuation.content.match(/\bprint\s*\(\s*([A-Za-z_$][\w$]*)/i)?.[1];
  const returned = continuation.content.match(/^\s*return\s+([A-Za-z_$][\w$]*)/i)?.[1];
  const body = logged
    ? `This line logs the current \`${logged}\` value to the console.`
    : printed
      ? `This line displays the current \`${printed}\` value.`
      : returned
        ? `This line returns the current \`${returned}\` value to the caller.`
        : /^\s*(?:for|while)\b/.test(continuation.content)
          ? "This line begins the requested loop and controls when its body runs."
          : "This is the requested point where the walkthrough continues.";
  return {
    body,
    path: continuation.path,
    line: continuation.line,
  };
}

function normalizeWalkthroughLocationWording(
  steps: NonNullable<TutorSections["walkthrough"]>,
): NonNullable<TutorSections["walkthrough"]> {
  return steps.map((step) => {
    if (step.line == null) return step;
    const body = step.body
      .replace(
        /\bThe (?:first|second|third|fourth|fifth|sixth) line\b/g,
        "This line",
      )
      .replace(
        /\bthe (?:first|second|third|fourth|fifth|sixth) line\b/g,
        "this line",
      )
      .replace(/\bline\s+\d+\b/gi, `line ${step.line}`);
    return { ...step, body };
  });
}

function groundedWalkthrough(
  steps: NonNullable<TutorSections["walkthrough"]>,
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["walkthrough"]> {
  const safeLines = params.files.flatMap((file) =>
    file.content
      .split("\n")
      .map((content, index) => ({ path: file.path, line: index + 1, content }))
      .filter(({ content }) => content.trim() && !INSTRUCTION_INJECTION.test(content)),
  );
  const visibleIdentifiers = new Set(
    safeLines.flatMap(({ content }) =>
      content.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []
    ),
  );
  let fallbackIndex = 0;
  const usedLocations = new Set<string>();
  const grounded = steps
    .filter((step) => !INSTRUCTION_INJECTION.test(step.body))
    .map((step) => {
      const mentionedSymbols = new Set([
        ...step.body.matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?:\([^`]*\))?`/g),
      ].map((match) => match[1]));
      for (const match of step.body.matchAll(/\b([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\b/g)) {
        mentionedSymbols.add(match[1]);
      }
      for (const match of step.body.matchAll(/["']([^"'\n]{1,40})["']/g)) {
        mentionedSymbols.add(match[1]);
        for (const word of match[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
          mentionedSymbols.add(word);
        }
      }
      for (const match of step.body.matchAll(/\b(print|input|len|console\.log)\b/g)) {
        mentionedSymbols.add(match[1]);
      }
      // Models do not consistently wrap source identifiers in backticks or
      // quotes. Recover plain identifiers only when they actually occur in
      // the visible project so prose such as "prints the values list" can be
      // grounded to print(values), not an unrelated earlier print call.
      for (const token of step.body.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []) {
        if (token.length > 1 && visibleIdentifiers.has(token)) {
          mentionedSymbols.add(token);
        }
      }
      const currentLine = safeLines.find(
        (line) => line.path === step.path && line.line === step.line,
      );
      const score = (content: string) =>
        walkthroughLineScore(step.body, content, mentionedSymbols);
      const bestSymbolLine = safeLines
        .map((line) => ({ line, score: score(line.content) }))
        .sort((a, b) => b.score - a.score)[0];
      if (
        currentLine &&
        score(currentLine.content) >= (bestSymbolLine?.score ?? 0)
      ) {
        usedLocations.add(`${currentLine.path}:${currentLine.line}`);
        return step;
      }
      const symbolMatch = bestSymbolLine && bestSymbolLine.score > 0
        ? bestSymbolLine.line
        : undefined;
      let fallback = symbolMatch;
      while (!fallback && fallbackIndex < safeLines.length) {
        const candidate = safeLines[fallbackIndex++];
        if (!usedLocations.has(`${candidate.path}:${candidate.line}`)) {
          fallback = candidate;
        }
      }
      if (fallback) usedLocations.add(`${fallback.path}:${fallback.line}`);
      return fallback
        ? { ...step, path: fallback.path, line: fallback.line }
        : { ...step, path: null, line: null };
    });
  // Models sometimes split one source statement into two explanatory steps
  // (for example, declaration and initialization). Both legitimately ground
  // to the same line. Merge adjacent duplicates so we do not force the second
  // idea onto an unrelated line or clutter the UI with duplicate chips.
  return grounded.reduce<NonNullable<TutorSections["walkthrough"]>>(
    (result, step) => {
      const previous = result.at(-1);
      if (
        previous &&
        step.path &&
        step.line != null &&
        previous.path === step.path &&
        previous.line === step.line
      ) {
        previous.body = `${previous.body} ${step.body}`.slice(0, 2_000);
      } else {
        result.push(step);
      }
      return result;
    },
    [],
  );
}

const WALKTHROUGH_LINE_ORDINALS = new Map([
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["fourth", 3],
  ["fifth", 4],
  ["sixth", 5],
]);

/**
 * A model occasionally puts two source-line explanations into one step while
 * attaching only one navigation target. Split those sentences before semantic
 * grounding so each explanation gets its own accurate clickable location.
 * Ordinals are resolved against visible (non-instruction) lines because the
 * tutor intentionally omits instruction-injection comments from walkthroughs.
 */
function splitMultiLineWalkthroughSteps(
  steps: NonNullable<TutorSections["walkthrough"]>,
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["walkthrough"]> {
  const visibleByPath = new Map(
    params.files.map((file) => [
      file.path,
      file.content
        .split("\n")
        .map((content, index) => ({ content, line: index + 1 }))
        .filter(({ content }) => content.trim() && !INSTRUCTION_INJECTION.test(content)),
    ]),
  );

  return steps.flatMap((step) => {
    const sentences = step.body.split(/(?<=[.!?])\s+(?=[A-Z`])/);
    const path = step.path && visibleByPath.has(step.path)
      ? step.path
      : params.files.length === 1
        ? params.files[0].path
        : null;
    const visibleLines = path ? visibleByPath.get(path) : undefined;
    if (!path || !visibleLines) return [step];

    const located = sentences.map((body) => {
      const word = body.match(
        /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth)\s+line\b/i,
      )?.[1].toLowerCase();
      const index = word ? WALKTHROUGH_LINE_ORDINALS.get(word) : undefined;
      const line = index == null ? undefined : visibleLines[index]?.line;
      return { body, line };
    });
    const distinctLines = new Set(
      located.flatMap(({ line }) => line == null ? [] : [line]),
    );
    if (distinctLines.size === 0) return [step];
    if (distinctLines.size === 1 && located.length === 1) {
      return [{ ...step, path, line: located[0].line! }];
    }
    if (distinctLines.size < 2) return [step];

    return located.reduce<NonNullable<TutorSections["walkthrough"]>>(
      (result, sentence) => {
        if (sentence.line != null) {
          result.push({ body: sentence.body, path, line: sentence.line });
        } else if (result.length) {
          result[result.length - 1].body =
            `${result[result.length - 1].body} ${sentence.body}`.slice(0, 2_000);
        }
        return result;
      },
      [],
    );
  });
}

function fallbackWalkthroughSteps(
  sections: TutorSections,
  params: Pick<AIAskParams, "files" | "question">,
): NonNullable<TutorSections["walkthrough"]> {
  const source =
    meaningfulProse(sections.explain, params) ??
    meaningfulProse(sections.summary, params);
  if (!source) return [];
  const sentences = source.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((body) => ({ body, path: null, line: null }));
}

function visibleExpressionIdentifiers(expression: string | undefined): string[] {
  if (!expression) return [];
  const withoutStrings = expression.replace(/(["'])(?:\\.|(?!\1).)*\1/g, " ");
  return [...new Set(withoutStrings.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [])]
    .filter((name) => !["true", "false", "null", "undefined"].includes(name.toLowerCase()));
}

function visibleCodeWalkthroughSteps(
  params: Pick<AIAskParams, "files" | "question">,
): NonNullable<TutorSections["walkthrough"]> {
  const steps: NonNullable<TutorSections["walkthrough"]> = [];
  const lowerQuestion = params.question.toLowerCase();
  const namedFiles = params.files.filter((file) => {
    const path = file.path.toLowerCase();
    const basename = path.split("/").at(-1) ?? path;
    return lowerQuestion.includes(path) || lowerQuestion.includes(basename);
  });
  const walkthroughFiles = namedFiles.length > 0 ? namedFiles : params.files;
  for (const file of walkthroughFiles) {
    for (const [index, sourceLine] of file.content.split("\n").entries()) {
      const line = sourceLine.trim();
      if (
        !line ||
        /^(?:#|\/\/)/.test(line) ||
        /^(?:\{|\}|};?)$/.test(line) ||
        INSTRUCTION_INJECTION.test(line)
      ) {
        continue;
      }
      const jsFunction = line.match(
        /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
      );
      const pythonFunction = line.match(
        /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/,
      );
      const assignment = line.match(
        /^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/,
      );
      const returned = line.match(/^return\s+([A-Za-z_$][\w$]*)/);
      const consoleOutput = /^console\.log\s*\(/.test(line);
      const consoleOutputIdentifier = line.match(
        /^console\.log\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*;?$/,
      )?.[1];
      const consoleOutputExpression = line.match(
        /^console\.log\s*\((.*)\)\s*;?$/,
      )?.[1];
      const pythonOutput = /^print\s*\(/.test(line);
      const pythonOutputIdentifier = line.match(
        /^print\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*$/,
      )?.[1];
      const pythonLengthOutputIdentifier = line.match(
        /^print\s*\(\s*len\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)\s*$/,
      )?.[1];
      const pythonFormattedCall = line.match(
        /^print\s*\(\s*f["'][^"']*\{([A-Za-z_]\w*)\(([^}:]*)\)[^}]*\}[^"']*["']\s*\)\s*$/,
      );
      const pythonFormattedIdentifier = line.match(
        /^print\s*\(\s*f["'][^"']*\{([A-Za-z_]\w*)[^}]*\}[^"']*["']\s*\)\s*$/,
      )?.[1];
      const pythonOutputExpression = line.match(/^print\s*\((.*)\)\s*$/)?.[1];
      const consoleExpressionNames = visibleExpressionIdentifiers(consoleOutputExpression);
      const pythonExpressionNames = visibleExpressionIdentifiers(pythonOutputExpression);
      const pythonFromImport = line.match(
        /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/,
      );
      const pythonImport = line.match(/^import\s+(.+)$/);
      let body: string;
      if (jsFunction || pythonFunction) {
        const [, name, rawParameters] = jsFunction ?? pythonFunction!;
        const parameters = rawParameters
          .split(",")
          .map((parameter) => parameter.trim())
          .filter(Boolean)
          .map((parameter) => `\`${parameter}\``)
          .join(", ");
        body = parameters
          ? `This line defines \`${name}\` with the parameter ${parameters}.`
          : `This line defines \`${name}\` with no parameters.`;
      } else if (returned) {
        body = `This line returns \`${returned[1]}\` to the caller.`;
      } else if (consoleOutput) {
        body = consoleOutputIdentifier
          ? `This line logs the current \`${consoleOutputIdentifier}\` value to the console.`
          : consoleOutputExpression?.includes("+") && consoleExpressionNames.length
          ? `This line combines visible text with the current ${consoleExpressionNames.map((name) => `\`${name}\``).join(" and ")} value${consoleExpressionNames.length === 1 ? "" : "s"}, then logs the result to the console.`
          : "This line logs the visible expression’s result to the console.";
      } else if (pythonOutput) {
        body = pythonLengthOutputIdentifier
          ? `This line calls \`len(${pythonLengthOutputIdentifier})\` and displays the list’s length.`
          : pythonFormattedCall
          ? `This line computes and displays \`${pythonFormattedCall[1]}(${pythonFormattedCall[2].trim()})\`.`
          : pythonOutputIdentifier
          ? `This line displays the current \`${pythonOutputIdentifier}\` value.`
          : pythonFormattedIdentifier
          ? `This line displays the current \`${pythonFormattedIdentifier}\` value.`
          : pythonOutputExpression?.includes("+") && pythonExpressionNames.length
          ? `This line combines visible text with the current ${pythonExpressionNames.map((name) => `\`${name}\``).join(" and ")} value${pythonExpressionNames.length === 1 ? "" : "s"}, then displays the result.`
          : "This line displays the visible expression’s result.";
      } else if (pythonFromImport) {
        const names = pythonFromImport[2]
          .split(",")
          .map((name) => `\`${name.trim()}\``)
          .join(", ");
        body = `This line imports ${names} from \`${pythonFromImport[1]}\`.`;
      } else if (pythonImport) {
        const names = pythonImport[1]
          .split(",")
          .map((name) => `\`${name.trim()}\``)
          .join(", ");
        body = `This line imports ${names}.`;
      } else if (assignment) {
        const [, name, expression] = assignment;
        const called = expression.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1];
        const expressionNames = visibleExpressionIdentifiers(expression)
          .filter((identifier) => identifier !== name);
        body = called
          ? `\`${name}\` receives the value returned by calling \`${called}\`.`
          : expression.includes("+") && expressionNames.length
          ? `\`${name}\` stores new text combined from the visible text and the current ${expressionNames.map((identifier) => `\`${identifier}\``).join(" and ")} value${expressionNames.length === 1 ? "" : "s"}.`
          : `\`${name}\` stores the value computed by this expression.`;
      } else if (/^(?:if|elif|else\b|for|while)\b/.test(line)) {
        body = "This line controls which part of the visible flow runs next.";
      } else {
        body = "This statement performs the next visible operation in the file.";
      }
      steps.push({ body, path: file.path, line: index + 1 });
    }
  }
  return steps;
}

function repairMisgroundedOutputClaims(
  grounded: NonNullable<TutorSections["walkthrough"]>,
  visible: NonNullable<TutorSections["walkthrough"]>,
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["walkthrough"]> {
  const fallbackByLocation = new Map(
    visible.map((step) => [`${step.path ?? ""}:${step.line ?? ""}`, step]),
  );
  const sourceByLocation = new Map<string, string>(
    params.files.flatMap((file) =>
      file.content.split("\n").map((source, index) => [
        `${file.path}:${index + 1}`,
        source.trim(),
      ] as const),
    ),
  );
  return grounded.map((step) => {
    const location = `${step.path ?? ""}:${step.line ?? ""}`;
    const source = sourceByLocation.get(location) ?? "";
    const claimsOutput = /\b(?:prints?|printed|logs?|logged|displays?|displayed|outputs?|outputted)\b/i.test(step.body);
    const isOutputLine = /\b(?:print|console\.log)\s*\(/.test(source);
    return claimsOutput && !isOutputLine
      ? fallbackByLocation.get(location) ?? step
      : step;
  });
}

function ensureRepresentativeLongWalkthrough(
  grounded: NonNullable<TutorSections["walkthrough"]>,
  visibleSteps: NonNullable<TutorSections["walkthrough"]>,
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["walkthrough"]> {
  if (grounded.length < 3 || visibleSteps.length <= 6) return grounded;

  const modelByLocation = new Map(
    grounded.map((step) => [`${step.path ?? ""}:${step.line ?? ""}`, step]),
  );
  const sourceByLocation = new Map<string, string>(
    params.files.flatMap((file) =>
      file.content.split("\n").map((content, index) => [
        `${file.path}:${index + 1}`,
        content,
      ] as const),
    ),
  );
  const imports = visibleSteps.filter((step) => /\bimports?\b/i.test(step.body));
  const terminal = visibleSteps.at(-1)!;
  const forced = [imports.at(-1), terminal].filter(
    (step): step is NonNullable<typeof step> => !!step,
  );
  const forcedLocations = new Set(
    forced.map((step) => `${step.path ?? ""}:${step.line ?? ""}`),
  );
  const priority = (step: NonNullable<TutorSections["walkthrough"]>[number]) => {
    const source = sourceByLocation.get(`${step.path ?? ""}:${step.line ?? ""}`) ?? "";
    if (/\b(?:receives|stores) the value\b/i.test(step.body)) return 30;
    if (/\b(?:defines|returns)\b/i.test(step.body)) return 24;
    if (/\b(?:displays|logs)\b/i.test(step.body)) {
      return /^\s+/.test(source) ? 12 : 22;
    }
    if (/\bcontrols\b/i.test(step.body)) return 14;
    return 5;
  };
  const remaining = visibleSteps
    .filter((step) => !forcedLocations.has(`${step.path ?? ""}:${step.line ?? ""}`))
    .sort((left, right) => priority(right) - priority(left) ||
      (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 6 - forced.length);
  const selected = [...forced, ...remaining]
    .map((step) => modelByLocation.get(`${step.path ?? ""}:${step.line ?? ""}`) ?? step)
    .sort((left, right) => {
      const pathOrder = params.files.findIndex((file) => file.path === left.path) -
        params.files.findIndex((file) => file.path === right.path);
      return pathOrder || (left.line ?? Number.MAX_SAFE_INTEGER) -
        (right.line ?? Number.MAX_SAFE_INTEGER);
    });
  return selected;
}

function ensureTerminalWalkthroughCoverage(
  grounded: NonNullable<TutorSections["walkthrough"]>,
  visibleFallback: NonNullable<TutorSections["walkthrough"]>,
): NonNullable<TutorSections["walkthrough"]> {
  if (grounded.length === 0) return visibleFallback;
  const terminalStep = visibleFallback.at(-1);
  if (
    !terminalStep ||
    grounded.some((step) =>
      step.path === terminalStep.path && step.line === terminalStep.line,
    )
  ) {
    return grounded;
  }
  // A walkthrough that stops before the program's visible result is not a
  // walkthrough of the current file. Preserve model detail, but reserve the
  // final bounded slot for a deterministic, source-grounded terminal step.
  return grounded.length >= 6
    ? [...grounded.slice(0, 5), terminalStep]
    : [...grounded, terminalStep];
}

function ensureKeyDataFlowCoverage(
  grounded: NonNullable<TutorSections["walkthrough"]>,
  visibleFallback: NonNullable<TutorSections["walkthrough"]>,
): NonNullable<TutorSections["walkthrough"]> {
  // Do not expand a deliberately narrow one-step explanation or a requested
  // continuation. This guard is only for a substantially formed full-file
  // walkthrough that is missing one key early data-flow transition.
  if (grounded.length < 3 || grounded.length >= 6) return grounded;
  const covered = new Set(
    grounded.map((step) => `${step.path ?? ""}:${step.line ?? ""}`),
  );
  const result = [...grounded];
  const assignments = visibleFallback.filter((step) =>
    /\b(?:receives|stores) the value\b/i.test(step.body) &&
    !covered.has(`${step.path ?? ""}:${step.line ?? ""}`),
  );
  for (const assignment of assignments) {
    if (result.length >= 6) break;
    const insertAt = result.findIndex((step) =>
      step.path === assignment.path &&
      step.line != null &&
      assignment.line != null &&
      step.line > assignment.line,
    );
    result.splice(insertAt < 0 ? result.length : insertAt, 0, assignment);
    covered.add(`${assignment.path ?? ""}:${assignment.line ?? ""}`);
  }
  return result;
}

function groundComprehensionLine(
  question: string | null | undefined,
  params: Pick<AIAskParams, "files">,
): string | null {
  if (!question) return null;
  const citedLine = question.match(/\bline\s+(\d+)\b/i);
  if (!citedLine) return question;
  const citedNumber = Number(citedLine[1]);
  const mentioned = new Set(
    (question.match(/[A-Za-z_$][\w$]*/g) ?? []).map((token) => token.toLowerCase()),
  );
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const citedSource = lines[citedNumber - 1] ?? "";
    for (const [index, source] of lines.entries()) {
      const name = source.trim().match(
        /^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=/,
      )?.[1];
      if (!name || !mentioned.has(name.toLowerCase())) continue;
      if (new RegExp(`\\b${name}\\b`).test(citedSource)) return question;
      return question.replace(/\bline\s+\d+\b/i, `line ${index + 1}`);
    }
  }
  return question;
}

/**
 * Semantic output firewall applied after schema parsing and before any model
 * text reaches the learner. It pins the trusted intent, removes irrelevant
 * sections, strips newly generated pasteable code from every learner-visible
 * prose field, and makes protected-data refusals explicit. This is intentionally conservative:
 * a weaker hint is preferable to leaking the exercise answer.
 */
export function applyTutorOutputPolicy({
  sections,
  params,
  intent,
  priorTutorTurns,
}: {
  sections: TutorSections;
  params: TutorPolicyParams;
  intent: TutorIntent;
  priorTutorTurns: number;
}): TutorSections {
  if (intent === "socratic") {
    // Fail closed to a deterministic current-work observation, a bounded clue,
    // and one grounded question. A generic question by itself is not enough
    // value to consume a learner's limited tutor allowance.
    const grounded = EXPLICIT_HINT_REQUEST.test(params.question)
      ? groundedGentleHint(params)
      : socraticValue(params);
    const { question, summary, hint, citations } = grounded;
    return {
      intent: "socratic",
      summary,
      hint,
      citations,
      checkQuestions: [question ?? clarifyingQuestion(sections, params)],
    };
  }
  if (intent === "howto" && EXPLICIT_HINT_REQUEST.test(params.question)) {
    const value = groundedGentleHint(params);
    return {
      intent: "howto",
      summary: value.summary,
      hint: value.hint,
      nextStep: value.nextStep,
      checkQuestions: [value.question],
      citations: value.citations,
    };
  }
  const protectedRequest = PROTECTED_REQUEST.test(params.question);
  const fallbackCitation = visibleCodeCitation(params);
  const visibleIdentifier = firstVisibleIdentifier(params);
  const protectedSummary = /\b(?:system prompt|hidden (?:tests?|validator)|canary)\b/i.test(
    params.question,
  )
    ? `I can’t provide system instructions or protected values, but I can explain the concept using ${visibleIdentifier ? `\`${visibleIdentifier}\`` : "the visible code"}.`
    : "I can’t provide the requested answer or protected information, but I can help you reason from the visible code.";
  const common: TutorSections = {
    intent,
    summary: protectedRequest
      ? protectedSummary
      : meaningfulProse(sections.summary, params) ?? "Let’s use the current code as evidence.",
    citations:
      sections.citations?.length
        ? sections.citations.map((citation) => ({
            ...citation,
            reason:
              safeProse(citation.reason, params) ??
              "Current code used for this guidance",
          }))
        : fallbackCitation
          ? [fallbackCitation]
          : sections.citations,
    comprehensionCheck: safeAction(sections.comprehensionCheck, params),
    stuckness: sections.stuckness,
  };

  if (intent === "debug") {
    const singleListAddition = pythonSingleListAddition(params);
    const noOutput = visibleNoOutputDebug(params);
    return {
      ...common,
      summary: noOutput?.summary ?? common.summary,
      citations: noOutput
        ? [noOutput.citation]
        : singleListAddition
        ? [{
            path: singleListAddition.path,
            line: singleListAddition.line,
            column: null,
            reason: "Non-standard list method with one visible item",
          }]
        : common.citations,
      comprehensionCheck: noOutput
        ? noOutput.checkQuestion
        : singleListAddition
        ? "Which standard list operation adds one item rather than expanding a collection?"
        : common.comprehensionCheck,
      diagnose: noOutput?.diagnose ?? (singleListAddition
        ? `\`${singleListAddition.variable}\` is a list, and \`${singleListAddition.method}()\` is not a standard list method. The visible call passes one item.`
        : safeProse(sections.diagnose, params) ?? "The current result points to the cited area."),
      explain: singleListAddition
        ? `The visible call adds one item to \`${singleListAddition.variable}\`. Python’s standard single-item list method is \`append()\`; compare that method name with \`${singleListAddition.method}()\` on the cited line.`
        : safeProse(sections.explain, params),
      checkQuestions: noOutput
        ? [noOutput.checkQuestion]
        : singleListAddition
        ? ["Are you adding one item, or expanding an existing collection?"]
        : sections.checkQuestions?.map((item) => safeAction(item, params)!).filter(Boolean) ?? null,
      hint: noOutput?.hint ?? (singleListAddition
        ? "Compare the standard single-item method with the method on the cited line."
        : safeAction(sections.hint, params)),
      nextStep:
        (noOutput?.nextStep ?? (singleListAddition
          ? "Change only the method name on the cited line, then run the code again."
          : safeAction(sections.nextStep, params))) ??
        "Inspect the cited line, make one small change, and run it again.",
      strongerHint:
        priorTutorTurns > 0 ? safeAction(sections.strongerHint, params) : null,
      pitfalls: singleListAddition ? null : safeAction(sections.pitfalls, params),
    };
  }
  if (intent === "howto") {
    const inputHowto = visiblePythonInputHowto(params);
    const rangeHowto = visiblePythonRangeHowto(params);
    const collectionHowto = visibleCollectionHowto(params);
    return {
      ...common,
      summary: rangeHowto?.summary ?? collectionHowto?.summary ?? common.summary,
      citations: inputHowto
        ? [inputHowto.citation]
        : rangeHowto
          ? [rangeHowto.citation]
        : collectionHowto
          ? [collectionHowto.citation]
          : common.citations,
      explain:
        inputHowto?.explain ??
        rangeHowto?.explain ??
        collectionHowto?.explain ??
        safeProse(sections.explain, params),
      hint: collectionHowto?.hint ?? safeAction(sections.hint, params),
      nextStep:
        inputHowto?.nextStep ??
        rangeHowto?.nextStep ??
        collectionHowto?.nextStep ??
        (protectedRequest
          ? "Implement only the first behavior the task asks for, then run it and describe the value or output you observe before adding the next part."
          : safeAction(sections.nextStep, params)) ??
        "Choose the first small change in the cited file, then run it before adding more.",
      pitfalls: safeAction(sections.pitfalls, params),
    };
  }
  if (intent === "walkthrough") {
    const conditionalWalkthrough = visiblePythonConditionalWalkthrough(params);
    const sourceSteps = conditionalWalkthrough ?? (sections.walkthrough?.length
      ? sections.walkthrough
      : fallbackWalkthroughSteps(sections, params));
    const modelGrounded = groundedWalkthrough(
      splitMultiLineWalkthroughSteps(
        sourceSteps.flatMap((step) => {
          const body = meaningfulProse(step.body, params);
          return body ? [{ ...step, body }] : [];
        }),
        params,
      ),
      params,
    );
    const visibleSteps = visibleCodeWalkthroughSteps(params);
    const visibleFallback = visibleSteps.length <= 6
      ? visibleSteps
      : [...visibleSteps.slice(0, 5), visibleSteps.at(-1)!];
    // A deterministic conditional walkthrough already ends at the branch
    // that actually runs. Appending the file's final visible line would teach
    // an unreachable `else` body as if it executes next.
    const grounded = conditionalWalkthrough
      ? modelGrounded
      : ensureRepresentativeLongWalkthrough(
          ensureKeyDataFlowCoverage(
            ensureTerminalWalkthroughCoverage(modelGrounded, visibleFallback),
            visibleSteps,
          ),
          visibleSteps,
          params,
        );
    const repairedGrounded = repairMisgroundedOutputClaims(
      grounded,
      visibleSteps,
      params,
    );
    const continuation = requestedWalkthroughStart(params);
    const continued = continuation
      ? repairedGrounded.filter((step) =>
          step.path === continuation.path &&
          step.line != null &&
          step.line >= continuation.line,
        )
      : repairedGrounded;
    const walkthrough = normalizeWalkthroughLocationWording(continuation && continued.length === 0
      ? [continuationFallbackStep(continuation)]
      : continued);
    const containsInstructionComment = params.files.some((file) =>
      file.content.split("\n").some((line) => INSTRUCTION_INJECTION.test(line)),
    );
    return {
      ...common,
      summary: containsInstructionComment
        ? "I’ll ignore instruction-like comments and focus only on the executable behavior."
        : modelGrounded.length === 0
          ? "Let’s walk through the current code one visible step at a time."
          : common.summary,
      citations: walkthrough
        .filter((step) => step.path && step.line != null)
        .map((step) => ({
          path: step.path!,
          line: step.line!,
          column: null,
          reason: step.body.slice(0, 120),
        })),
      walkthrough,
      comprehensionCheck: groundComprehensionLine(
        common.comprehensionCheck,
        params,
      ),
      // Pitfalls are not a walkthrough field. Dropping them also prevents a
      // model aside from competing with the grounded ordered explanation.
      pitfalls: null,
    };
  }
  if (intent === "checkin") {
    const visibleReview = visibleInputOutputCheckin(params);
    const recentHistory = (params.history ?? [])
      .slice(-3)
      .map((message) => message.content)
      .join(" ");
    const typeMismatch = /\btypeerror\b|concatenat\w*[^.!?]*(?:integer|int)[^.!?]*(?:string|str)|concatenat\w*[^.!?]*(?:string|str)[^.!?]*(?:integer|int)/i.test(
      `${params.question} ${sections.diagnose ?? ""}`,
    );
    const irrelevantLabelEdit =
      typeMismatch &&
      /\b(?:changed?|edited?)\b[^.!?]{0,40}\blabel\b/i.test(recentHistory) &&
      /\b(?:right part|right place|changing the right)\b/i.test(params.question);
    const modelDiagnosis = safeProse(sections.diagnose, params);
    const summaryDiagnosis = meaningfulProse(sections.summary, params);
    const summaryIsSpecific =
      summaryDiagnosis != null &&
      !/^(?:you(?:'|’)re asking|let(?:'|’)s (?:review|use)|reviewing|this (?:response|answer) (?:reviews|looks at))\b/i.test(
        summaryDiagnosis,
      );
    return {
      ...common,
      citations: visibleReview?.citations ?? common.citations,
      summary: irrelevantLabelEdit
        ? "Changing the label text was not the relevant part; the type mismatch is still present."
        : common.summary,
      comprehensionCheck:
        common.comprehensionCheck ??
        "What result do you expect before you run the current code?",
      diagnose:
        visibleReview?.diagnose ??
        (protectedRequest
          ? "I can review your reasoning, but I won’t confirm the requested answer."
          : irrelevantLabelEdit
            ? "The label edit leaves the incompatible operand types unchanged at the cited operation."
          : modelDiagnosis) ??
        (summaryIsSpecific ? summaryDiagnosis : null) ??
        "I couldn’t complete a reliable review of the cited code in this response.",
      nextStep:
        visibleReview?.nextStep ??
        (protectedRequest
          ? "Predict the result from the cited line, then run it and compare what you observe."
          : safeAction(sections.nextStep, params)) ??
        (typeMismatch
          ? "Focus on making both sides of the cited operation compatible, then run it again."
          : null) ??
        "Run the current code once and compare its actual output or behavior with what you intended before making another edit.",
      pitfalls: safeAction(sections.pitfalls, params),
    };
  }
  const conditional = visibleConditionalChain(params);
  const constBinding = visibleJsConstBinding(params);
  const listSortCorrection = visiblePythonListSortCorrection(params);
  const anchor = visibleConceptAnchor(params);
  const asksForConcreteExample = /\bconcrete example\b/i.test(params.question);
  const asksWhyItMatters = /\bwhy (?:does )?(?:this|that|it) matter\b|\bwhy it matters\b/i.test(params.question);
  const citationExplanation = sections.citations
    ?.map((citation) => meaningfulProse(citation.reason, params))
    .filter((reason): reason is string => !!reason)
    .sort((a, b) => b.length - a.length)[0];
  const conceptCheck = conditional
    ? "With the current visible value, which branch do you predict will run first?"
    : constBinding
      ? `What would you expect to happen if the visible \`${visibleIdentifier ?? "const"}\` binding were assigned a different value later?`
      : listSortCorrection
        ? "Which option changes the visible list itself, and which option returns a separate sorted value?"
        : anchor
          ? "What result do you predict from the cited line when the current code runs?"
          : "How would you explain this concept in your own words before changing the code?";
  return {
    ...common,
    summary:
      listSortCorrection?.summary ??
      constBinding?.summary ??
      common.summary,
    citations:
      listSortCorrection
        ? [listSortCorrection.citation]
        : conditional
        ? [conditional.citation]
        : constBinding
          ? [constBinding.citation]
        : common.citations?.length
        ? common.citations
        : anchor
          ? [anchor.citation]
          : sections.citations,
    explain:
      listSortCorrection?.explain ??
      conditional?.explain ??
      constBinding?.explain ??
      meaningfulProse(sections.explain, params) ??
      citationExplanation ??
      (asksWhyItMatters
        ? "This matters because the cited line controls behavior the learner can observe on the next run. Being able to predict that line is what makes later debugging changes deliberate instead of guesswork."
        : "Use the cited line as the source of truth: predict what value it produces or changes, then compare that prediction with the next run."),
    example:
      listSortCorrection?.example ??
      conditional?.example ??
      constBinding?.example ??
      (asksForConcreteExample
        ? visibleConcreteExample(params) ?? anchor?.example ?? safeAction(sections.example, params)
        : protectedRequest
          ? anchor?.example
          : null) ??
      null,
    comprehensionCheck:
      conditional || constBinding || listSortCorrection
        ? conceptCheck
        : common.comprehensionCheck ?? conceptCheck,
    // Concept turns stay to three teaching beats: observation, explanation,
    // and one prediction/check. Extra examples are opt-in and pitfalls are
    // omitted so correct information does not become an overlong lecture.
    pitfalls: null,
  };
}

/**
 * Final response-value contract used by quota finalization. The output policy
 * performs the bounded deterministic repair first; this check is the last
 * fail-safe that prevents a structurally present but pedagogically empty turn
 * from consuming the learner's visible allowance.
 */
export function hasTutorTeachingValue(
  sections: TutorSections,
  params: Pick<TutorPolicyParams, "question" | "files" | "lessonContext" | "lastRun">,
): boolean {
  const text = [
    sections.summary,
    sections.diagnose,
    sections.explain,
    sections.example,
    sections.hint,
    sections.nextStep,
    sections.strongerHint,
    sections.comprehensionCheck,
    ...(sections.checkQuestions ?? []),
    ...(sections.walkthrough ?? []).map((step) => step.body),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (text.length === 0) return false;

  const anchored = Boolean(
    sections.citations?.length ||
    params.lastRun ||
    params.lessonContext ||
    params.files.some((file) => file.content.trim()),
  );
  if (!anchored) return false;

  if (EXPLICIT_HINT_REQUEST.test(params.question)) {
    const clue = sections.hint?.trim();
    const move = sections.intent === "socratic"
      ? sections.checkQuestions?.[0]?.trim()
      : sections.nextStep?.trim();
    if (!clue || !move) return false;
    if (/^(?:think about|look at|inspect|review|use) (?:the )?(?:current )?(?:code|file|task)[.!]?$/i.test(clue)) {
      return false;
    }
  }

  switch (sections.intent) {
    case "socratic":
      return Boolean(sections.summary?.trim() && sections.hint?.trim() && sections.checkQuestions?.length);
    case "debug":
      return Boolean(sections.diagnose?.trim() && (sections.nextStep?.trim() || sections.hint?.trim()));
    case "howto":
      return Boolean(sections.nextStep?.trim() && (sections.hint?.trim() || sections.explain?.trim()));
    case "walkthrough":
      return Boolean(sections.walkthrough?.length);
    case "checkin":
      return Boolean(sections.diagnose?.trim());
    case "concept":
      return Boolean(sections.explain?.trim() || sections.example?.trim());
    default:
      return text.length >= 2;
  }
}

/**
 * Honest recovery copy for the rare case where the repaired provider output
 * still cannot satisfy the teaching-value contract. Routes deliberately keep
 * this turn outside the visible allowance and progression state.
 */
export function tutorValueRecovery(
  params: Pick<TutorPolicyParams, "files" | "lastRun">,
): TutorSections {
  const citation = visibleCodeCitation(params);
  if (params.lastRun) {
    const observed = params.lastRun.stderr.trim() || params.lastRun.stdout.trim();
    return {
      intent: "howto",
      summary: "I couldn't ground a reliable teaching response yet, so use the latest run as the next source of truth.",
      hint: observed
        ? "Start with the first visible output or error line and connect it to the line that produced it."
        : "The latest run produced no visible output; first identify which current line is expected to display or return a result.",
      nextStep: "Run the smallest relevant case once more, then ask about the first output or error line you do not understand.",
      citations: citation ? [citation] : null,
    };
  }
  if (citation) {
    return {
      intent: "howto",
      summary: "I couldn't ground a reliable teaching response from the available evidence yet.",
      hint: "Use the cited current line as the starting point and predict one observable result before changing it.",
      nextStep: "Run that smallest case, then ask about the first output or error that differs from your prediction.",
      citations: [citation],
    };
  }
  return {
    intent: "howto",
    summary: "I don't have enough current-work evidence to give you a useful answer yet.",
    hint: "A visible line of code or a run result will let me give a specific clue instead of guessing.",
    nextStep: "Add or select the line you are working on, run it once, and then ask again with the visible output or error.",
    citations: null,
  };
}
