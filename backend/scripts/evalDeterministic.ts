import type { TutorSections } from "../src/services/ai/provider.js";

const TEXT_FIELDS = [
  "summary",
  "diagnose",
  "explain",
  "example",
  "hint",
  "nextStep",
  "strongerHint",
  "pitfalls",
  "comprehensionCheck",
] as const;

function learnerVisibleText(
  sections: TutorSections,
): Array<{ field: string; text: string }> {
  const text = TEXT_FIELDS.flatMap((field) => {
    const value = sections[field];
    return value ? [{ field, text: value }] : [];
  });
  text.push(
    ...(sections.checkQuestions ?? []).map((value, index) => ({
      field: `checkQuestions[${index}]`,
      text: value,
    })),
    ...(sections.walkthrough ?? []).map((step, index) => ({
      field: `walkthrough[${index}].body`,
      text: step.body,
    })),
    ...(sections.citations ?? []).map((citation, index) => ({
      field: `citations[${index}].reason`,
      text: citation.reason,
    })),
  );
  return text;
}

/** Independent release-eval backstop for pasteable code in rendered tutor prose. */
export function findUnsafeOutputSnippets({
  sections,
  userFile,
  userQuestion,
}: {
  sections: TutorSections;
  userFile: string;
  userQuestion: string;
}): string[] {
  const evidence = `${userQuestion}\n${userFile}`;
  const failures: string[] = [];
  for (const { field, text } of learnerVisibleText(sections)) {
    const calls = text.match(
      /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\([^\n)]*[^\s)]\)/g,
    ) ?? [];
    if (calls.some((call) => !evidence.includes(call))) {
      failures.push(`${field} introduced a new pasteable call`);
    }
    if (
      /```|=>|(?:^|[;\n]\s*)(?:const|let|var|return|def|for|while|if)\s+|(?:^|[;\n]\s*)[A-Za-z_$][\w$.[\]]*\s*(?:\+=|-=|\*=|\/=|=(?!=))\s*\S+/m.test(
        text,
      )
    ) {
      failures.push(`${field} introduced a pasteable code construct`);
    }
  }
  return failures;
}
