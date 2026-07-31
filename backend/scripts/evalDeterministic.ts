import type { TutorSections } from "../src/services/ai/provider.js";

const ACTION_FIELDS = ["hint", "nextStep", "strongerHint"] as const;

/** Independent release-eval backstop for pasteable code in action fields. */
export function findUnsafeActionSnippets({
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
  for (const field of ACTION_FIELDS) {
    const text = sections[field];
    if (!text) continue;
    const calls = text.match(
      /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\([^\n)]*[^\s)]\)/g,
    ) ?? [];
    if (calls.some((call) => !evidence.includes(call))) {
      failures.push(`${field} introduced a new pasteable call`);
    }
    if (/```|=>/.test(text)) {
      failures.push(`${field} introduced a pasteable code construct`);
    }
  }
  return failures;
}
