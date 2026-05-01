import type { JSONValue } from "postgres";
import { z } from "zod";
import { withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

export interface EditorProject {
  language: string;
  files: Record<string, string>;
  activeFile: string | null;
  openTabs: string[];
  fileOrder: string[];
  stdin: string;
  updatedAt: string;
}

const DEFAULT_PROJECT: EditorProject = {
  language: "python",
  files: {},
  activeFile: null,
  openTabs: [],
  fileOrder: [],
  stdin: "",
  updatedAt: new Date(0).toISOString(),
};

// Phase 20-P3 Bucket 3 (#2): parse rows at the DB boundary.
export const ProjectRowSchema = z.object({
  language: z.string(),
  files: z.record(z.string(), z.string()).nullable(),
  active_file: z.string().nullable(),
  open_tabs: z.array(z.string()).nullable(),
  file_order: z.array(z.string()).nullable(),
  stdin: z.string().nullable(),
  updated_at: z.date(),
});

function rowToProject(raw: unknown): EditorProject {
  const parsed = ProjectRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt editor_project row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    language: r.language,
    files: r.files ?? {},
    activeFile: r.active_file,
    openTabs: r.open_tabs ?? [],
    fileOrder: r.file_order ?? [],
    stdin: r.stdin ?? "",
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getEditorProject(userId: string): Promise<EditorProject> {
  // Phase 26: RLS-scoped read.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      SELECT language, files, active_file, open_tabs, file_order, stdin, updated_at
        FROM public.editor_project
       WHERE user_id = ${userId}
    `;
  });
  if (rows.length === 0) return { ...DEFAULT_PROJECT };
  return rowToProject(rows[0]);
}

export interface EditorProjectInput {
  language: string;
  files: Record<string, string>;
  activeFile: string | null;
  openTabs: string[];
  fileOrder: string[];
  stdin: string;
}

export async function saveEditorProject(
  userId: string,
  project: EditorProjectInput,
): Promise<EditorProject> {
  // Phase 26: RLS-scoped UPSERT. WITH CHECK on the policy enforces that
  // the row's user_id must equal auth.uid() — defense against a route-
  // handler bug threading the wrong userId.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      INSERT INTO public.editor_project (
        user_id, language, files, active_file, open_tabs, file_order, stdin
      )
      VALUES (
        ${userId},
        ${project.language},
        ${tx.json(project.files as JSONValue)},
        ${project.activeFile},
        ${project.openTabs},
        ${project.fileOrder},
        ${project.stdin}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        language    = EXCLUDED.language,
        files       = EXCLUDED.files,
        active_file = EXCLUDED.active_file,
        open_tabs   = EXCLUDED.open_tabs,
        file_order  = EXCLUDED.file_order,
        stdin       = EXCLUDED.stdin,
        updated_at  = now()
      RETURNING language, files, active_file, open_tabs, file_order, stdin, updated_at
    `;
  });
  return rowToProject(rows[0]);
}
