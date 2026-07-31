import type {
  AIAskParams,
  TutorIntent,
  TutorSections,
} from "./provider.js";
import { isStandardApiSymbol } from "./suspectApi.js";

type TutorPolicyParams = Pick<
  AIAskParams,
  "files" | "question" | "lessonContext"
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

function meaningfulText(value: string | null | undefined): string | null {
  const text = safeText(value);
  if (!text || text.length < 12 || (text.match(/[A-Za-z]+/g)?.length ?? 0) < 3) {
    return null;
  }
  if (looksIncomplete(text)) return null;
  return text;
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

  const assignmentLine =
    /\b(?:const|let|var)\b[^=]*=/.test(content) ||
    /^\s*[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))/.test(content);
  const outputLine = /\bconsole\.log\s*\(|\bprint\s*\(/.test(content);
  const loopLine = /^\s*(?:for|while)\b/.test(content);
  const indentedUpdateLine =
    /^\s{2,}[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))/.test(content);

  if (/\b(?:declar|assign|initializ|starts? (?:at|with)|constant|variable named)\w*/.test(lowerBody)) {
    score += assignmentLine ? 7 : 0;
    score -= outputLine ? 4 : 0;
  }
  if (/\b(?:for|while) loop\b|\b(?:iterat|goes? through|loops? over)\w*/.test(lowerBody)) {
    score += loopLine ? 8 : 0;
  }
  if (/\b(?:inside|within) the loop\b|\b(?:add|increment|accumulat|updat)\w*\b/.test(lowerBody)) {
    score += indentedUpdateLine ? 8 : 0;
    score -= outputLine ? 4 : 0;
  }
  if (/\b(?:after the loop|final (?:sum|result|value)|output|logs?|prints?|displays?|console\.log)\b/.test(lowerBody)) {
    score += outputLine ? 9 : 0;
    if (/\bafter the loop\b|\bfinal (?:sum|result|value)\b/.test(lowerBody)) {
      score -= indentedUpdateLine ? 4 : 0;
    }
  }
  return score;
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
        (mentionedSymbols.size === 0 ||
          score(currentLine.content) >= (bestSymbolLine?.score ?? 0))
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

function fallbackWalkthroughSteps(
  sections: TutorSections,
): NonNullable<TutorSections["walkthrough"]> {
  const source = meaningfulText(sections.explain) ?? meaningfulText(sections.summary);
  if (!source) return [];
  const sentences = source.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((body) => ({ body, path: null, line: null }));
}

/**
 * Semantic output firewall applied after schema parsing and before any model
 * text reaches the learner. It pins the trusted intent, removes irrelevant
 * sections, strips newly generated pasteable code from action fields, and
 * makes protected-data refusals explicit. This is intentionally conservative:
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
  const protectedRequest = PROTECTED_REQUEST.test(params.question);
  const fallbackCitation = visibleCodeCitation(params);
  const common: TutorSections = {
    intent,
    summary: protectedRequest
      ? "I can’t provide the requested answer or protected information, but I can help you reason from the visible code."
      : meaningfulText(sections.summary) ?? "Let’s use the current code as evidence.",
    citations:
      sections.citations?.length
        ? sections.citations
        : fallbackCitation
          ? [fallbackCitation]
          : sections.citations,
    comprehensionCheck: safeAction(sections.comprehensionCheck, params),
    stuckness: sections.stuckness,
  };

  if (intent === "debug") {
    const singleListAddition = pythonSingleListAddition(params);
    return {
      ...common,
      citations: singleListAddition
        ? [{
            path: singleListAddition.path,
            line: singleListAddition.line,
            column: null,
            reason: "Non-standard list method with one visible item",
          }]
        : common.citations,
      comprehensionCheck: singleListAddition
        ? "Which standard list operation adds one item rather than expanding a collection?"
        : common.comprehensionCheck,
      diagnose: singleListAddition
        ? `\`${singleListAddition.variable}\` is a list, and \`${singleListAddition.method}()\` is not a standard list method. The visible call passes one item.`
        : safeText(sections.diagnose) ?? "The current result points to the cited area.",
      explain: singleListAddition
        ? `The visible call adds one item to \`${singleListAddition.variable}\`. Python’s standard single-item list method is \`append()\`; compare that method name with \`${singleListAddition.method}()\` on the cited line.`
        : safeText(sections.explain),
      checkQuestions: singleListAddition
        ? ["Are you adding one item, or expanding an existing collection?"]
        : sections.checkQuestions?.map((item) => safeText(item)!).filter(Boolean) ?? null,
      hint: singleListAddition
        ? "Compare the standard single-item method with the method on the cited line."
        : safeAction(sections.hint, params),
      nextStep:
        (singleListAddition
          ? "Change only the method name on the cited line, then run the code again."
          : safeAction(sections.nextStep, params)) ??
        "Inspect the cited line, make one small change, and run it again.",
      strongerHint:
        priorTutorTurns > 0 ? safeAction(sections.strongerHint, params) : null,
      pitfalls: singleListAddition ? null : safeAction(sections.pitfalls, params),
    };
  }
  if (intent === "howto") {
    return {
      ...common,
      explain: safeText(sections.explain),
      hint: safeAction(sections.hint, params),
      nextStep:
        (protectedRequest
          ? "Implement only the first behavior the task asks for, then run it and describe the value or output you observe before adding the next part."
          : safeAction(sections.nextStep, params)) ??
        "Choose the first small change in the cited file, then run it before adding more.",
      pitfalls: safeAction(sections.pitfalls, params),
    };
  }
  if (intent === "walkthrough") {
    const sourceSteps = sections.walkthrough?.length
      ? sections.walkthrough
      : fallbackWalkthroughSteps(sections);
    const walkthrough = groundedWalkthrough(
      sourceSteps.map((step) => ({
        ...step,
        body: safeText(step.body) ?? "Inspect this step in the current flow.",
      })),
      params,
    );
    return {
      ...common,
      citations: walkthrough
        .filter((step) => step.path && step.line != null)
        .map((step) => ({
          path: step.path!,
          line: step.line!,
          column: null,
          reason: step.body.slice(0, 120),
        })),
      walkthrough,
      // Pitfalls are not a walkthrough field. Dropping them also prevents a
      // model aside from competing with the grounded ordered explanation.
      pitfalls: null,
    };
  }
  if (intent === "checkin") {
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
    return {
      ...common,
      summary: irrelevantLabelEdit
        ? "Changing the label text was not the relevant part; the type mismatch is still present."
        : common.summary,
      comprehensionCheck:
        common.comprehensionCheck ??
        "What result do you expect before you run the current code?",
      diagnose:
        (protectedRequest
          ? "I can review your reasoning, but I won’t confirm the requested answer."
          : irrelevantLabelEdit
            ? "The label edit leaves the incompatible operand types unchanged at the cited operation."
          : safeText(sections.diagnose)) ??
        "Your approach needs one more check against the current lesson goal.",
      nextStep:
        (protectedRequest
          ? "Predict the result from the cited line, then run it and compare what you observe."
          : safeAction(sections.nextStep, params)) ??
        (typeMismatch
          ? "Focus on making both sides of the cited operation compatible, then run it again."
          : null) ??
        "Run the current code and compare the result with the lesson goal before changing another line.",
      pitfalls: safeAction(sections.pitfalls, params),
    };
  }
  const conditional = visibleConditionalChain(params);
  const constBinding = visibleJsConstBinding(params);
  const anchor = visibleConceptAnchor(params);
  const citationExplanation = sections.citations
    ?.map((citation) => meaningfulText(citation.reason))
    .filter((reason): reason is string => !!reason)
    .sort((a, b) => b.length - a.length)[0];
  return {
    ...common,
    summary: constBinding?.summary ?? common.summary,
    citations:
      conditional
        ? [conditional.citation]
        : constBinding
          ? [constBinding.citation]
        : sections.citations?.length
        ? sections.citations
        : anchor
          ? [anchor.citation]
          : sections.citations,
    explain:
      conditional?.explain ??
      constBinding?.explain ??
      meaningfulText(sections.explain) ??
      citationExplanation ??
      "Compare the cited forms in the current file and note how each one treats the visible values.",
    example:
      conditional?.example ??
      constBinding?.example ??
      safeAction(sections.example, params) ??
      anchor?.example ??
      null,
    pitfalls: safeAction(sections.pitfalls, params),
  };
}
