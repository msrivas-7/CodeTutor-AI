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
const LEADING_QUESTION =
  /\b(?:answer|fix|replace|correct line|solution|should|need(?:s)?|missing|try|use|using|add|remove|delete|call|convert)\b|[`()[\]{}=]/i;

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
  if (!identifier) return true;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`\\b${escaped}\\b`, "i").test(question) ||
    /\b(?:this|that|visible|current)\s+(?:line|file|code|value|variable|expression|output)\b/i.test(
      question,
    )
  );
}

function fallbackClarifyingQuestion(params: TutorPolicyParams): string {
  const identifier = firstVisibleIdentifier(params);
  const calledSymbol = firstQuestionMentionedCall(params);
  const named = identifier ? `\`${identifier}\`` : "the visible code";
  if (params.diffSinceLastTurn) {
    return "What changed in the result after your most recent edit?";
  }
  if (/\b(?:right|correct|on the right track|choice|answer)\b/i.test(params.question)) {
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
  if (identifier) {
    return `What did you expect \`${identifier}\` to do, and what have you observed instead?`;
  }
  return "What did you expect to happen, and what happened instead?";
}

function clarifyingQuestion(
  sections: TutorSections,
  params: TutorPolicyParams,
): string {
  const candidates = [
    ...(sections.checkQuestions ?? []),
    sections.comprehensionCheck,
  ];
  for (const candidate of candidates) {
    const safe = safeAction(candidate, params);
    if (
      safe &&
      safe.length <= 220 &&
      !safe.includes("\n") &&
      safe.endsWith("?") &&
      OPEN_CLARIFYING_QUESTION.test(safe) &&
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
    !/\b(?:input|ask(?:ing)? (?:the )?user|their name)\b/i.test(params.question) ||
    !/\b(?:print|display|show|back)\b/i.test(params.question)
  ) {
    return null;
  }
  for (const file of params.files) {
    const lines = file.content.split("\n");
    const printIndex = lines.findIndex((line) => /^\s*print\s*\(/.test(line));
    if (printIndex < 0) continue;
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
  const describesOutput =
    /\b(?:after the loop|final (?:sum|result|value)|outputs?|logs?|prints?|displays?|console\.log)\b/.test(lowerBody);

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
  if (/\b(?:inside|within) the loop\b|\b(?:add|increment|accumulat|updat)\w*\b/.test(lowerBody)) {
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

function visibleCodeWalkthroughFallback(
  params: Pick<AIAskParams, "files">,
): NonNullable<TutorSections["walkthrough"]> {
  const steps: NonNullable<TutorSections["walkthrough"]> = [];
  for (const file of params.files) {
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
      const pythonOutput = /^print\s*\(/.test(line);
      const pythonOutputIdentifier = line.match(
        /^print\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*$/,
      )?.[1];
      const pythonLengthOutputIdentifier = line.match(
        /^print\s*\(\s*len\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\)\s*$/,
      )?.[1];
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
          : "This line logs the visible expression’s result to the console.";
      } else if (pythonOutput) {
        body = pythonLengthOutputIdentifier
          ? `This line calls \`len(${pythonLengthOutputIdentifier})\` and displays the list’s length.`
          : pythonOutputIdentifier
          ? `This line displays the current \`${pythonOutputIdentifier}\` value.`
          : "This line displays the visible expression’s result.";
      } else if (assignment) {
        const [, name, expression] = assignment;
        const called = expression.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1];
        body = called
          ? `\`${name}\` receives the value returned by calling \`${called}\`.`
          : `\`${name}\` stores the value computed by this expression.`;
      } else if (/^(?:if|elif|else\b|for|while)\b/.test(line)) {
        body = "This line controls which part of the visible flow runs next.";
      } else {
        body = "This statement performs the next visible operation in the file.";
      }
      steps.push({ body, path: file.path, line: index + 1 });
      if (steps.length === 6) return steps;
    }
  }
  return steps;
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
    // Fail closed to a deterministic question. Nothing from summary,
    // diagnosis, citations, hints, or stuckness may cross the first-turn
    // boundary, even if the model ignored the prompt or the learner claimed
    // prior progress in browser-owned history.
    return {
      intent: "socratic",
      checkQuestions: [clarifyingQuestion(sections, params)],
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
    return {
      ...common,
      citations: inputHowto ? [inputHowto.citation] : common.citations,
      explain: inputHowto?.explain ?? safeProse(sections.explain, params),
      hint: safeAction(sections.hint, params),
      nextStep:
        inputHowto?.nextStep ??
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
    const visibleFallback = visibleCodeWalkthroughFallback(params);
    const grounded = ensureTerminalWalkthroughCoverage(
      modelGrounded,
      visibleFallback,
    );
    const continuation = requestedWalkthroughStart(params);
    const continued = continuation
      ? grounded.filter((step) =>
          step.path === continuation.path &&
          step.line != null &&
          step.line >= continuation.line,
        )
      : grounded;
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
  const citationExplanation = sections.citations
    ?.map((citation) => meaningfulProse(citation.reason, params))
    .filter((reason): reason is string => !!reason)
    .sort((a, b) => b.length - a.length)[0];
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
      "Compare the cited forms in the current file and note how each one treats the visible values.",
    example:
      listSortCorrection?.example ??
      conditional?.example ??
      constBinding?.example ??
      anchor?.example ??
      safeAction(sections.example, params) ??
      null,
    pitfalls: safeAction(sections.pitfalls, params),
  };
}
