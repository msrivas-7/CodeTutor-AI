import { z } from "zod";
import type { ProjectFile, TutorSections } from "./provider.js";

const boundedText = z.string().max(4_000);
const nullableText = boundedText.nullable().optional();

const citationSchema = z.object({
  path: z.string().min(1).max(256),
  line: z.number().int().min(1).max(1_000_000),
  // Some models emit zero for an omitted/unknown column even though line
  // navigation is 1-indexed. Accept it at the wire boundary and neutralize it
  // below instead of discarding an otherwise safe response.
  column: z.number().int().min(0).max(1_000_000).nullable().optional(),
  // Accept a modestly oversized provider explanation and truncate it at the
  // render boundary. Rejecting the entire response because this auxiliary
  // label is 121 characters turns harmless model variance into a user error.
  reason: z.string().min(1).max(500),
});

const walkStepSchema = z.object({
  body: z.string().min(1).max(2_000),
  path: z.string().min(1).max(256).nullable().optional(),
  line: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

export const tutorSectionsSchema = z
  .object({
    intent: z
      .enum(["socratic", "debug", "concept", "howto", "walkthrough", "checkin"])
      .nullable()
      .optional(),
    summary: nullableText,
    diagnose: nullableText,
    explain: nullableText,
    example: nullableText,
    walkthrough: z.array(walkStepSchema).max(6).nullable().optional(),
    checkQuestions: z.array(z.string().min(1).max(1_000)).max(3).nullable().optional(),
    hint: nullableText,
    nextStep: nullableText,
    strongerHint: nullableText,
    pitfalls: nullableText,
    citations: z.array(citationSchema).max(20).nullable().optional(),
    comprehensionCheck: nullableText,
    stuckness: z.enum(["low", "medium", "high"]).nullable().optional(),
  })
  .strict();

function validLocation(
  fileLines: Map<string, string[]>,
  path: string | null | undefined,
  line: number | null | undefined,
): boolean {
  if (!path || line == null) return false;
  const lines = fileLines.get(path);
  return lines !== undefined && line <= lines.length && !!lines[line - 1]?.trim();
}

/**
 * Parses model JSON into the only output shape the UI is allowed to render.
 * Text remains plain React text; file navigation is restricted to the current
 * project and real line bounds. Malformed/oversized structures fail closed.
 */
export function parseTutorOutput(
  raw: string,
  files: ProjectFile[],
): TutorSections {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("model returned invalid tutor JSON");
  }
  const parsed = tutorSectionsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `model returned invalid tutor sections: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const fileLines = new Map(
    files.map((file) => [file.path, file.content.split("\n")]),
  );
  const sections = parsed.data;
  return {
    ...sections,
    citations:
      sections.citations
        ?.filter((citation) =>
          validLocation(fileLines, citation.path, citation.line),
        )
        .map((citation) => ({
          ...citation,
          reason: citation.reason.slice(0, 120),
          column:
            citation.column != null && citation.column >= 1
              ? citation.column
              : null,
        })) ?? sections.citations,
    walkthrough:
      sections.walkthrough?.map((step) =>
        step.path && step.line != null
          ? validLocation(fileLines, step.path, step.line)
            ? step
            : { body: step.body, path: null, line: null }
          : { ...step, path: null, line: null },
      ) ?? sections.walkthrough,
  };
}
