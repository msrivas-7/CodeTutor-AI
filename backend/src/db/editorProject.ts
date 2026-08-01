import type { JSONValue } from "postgres";
import { z } from "zod";
import { db, withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

export interface EditorProject {
  language: string;
  files: Record<string, string>;
  activeFile: string | null;
  openTabs: string[];
  fileOrder: string[];
  stdin: string;
  revision: number;
  writerId: string | null;
  updatedAt: string;
}

const DEFAULT_PROJECT: EditorProject = {
  language: "python",
  files: {},
  activeFile: null,
  openTabs: [],
  fileOrder: [],
  stdin: "",
  revision: 0,
  writerId: null,
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
  revision: z.union([z.number(), z.string()]),
  writer_id: z.string().uuid().nullable(),
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
    revision: Number(r.revision),
    writerId: r.writer_id,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getEditorProject(userId: string): Promise<EditorProject> {
  // Phase 26: RLS-scoped read.
  const rows = await withRlsContext(userId, async (tx) => {
    return await tx`
      SELECT language, files, active_file, open_tabs, file_order, stdin,
             revision, writer_id, updated_at
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
  expectedRevision: number;
  writerId: string;
}

export type EditorProjectSaveResult =
  | { ok: true; project: EditorProject }
  | { ok: false; current: EditorProject };

export async function saveEditorProject(
  userId: string,
  project: EditorProjectInput,
): Promise<EditorProjectSaveResult> {
  // Server-authoritative CAS transaction. Browser roles are read-only; every
  // write and fallback read carries the explicit owning user id.
  return await db().begin(async (tx) => {
    const rows = await tx`
      INSERT INTO public.editor_project (
        user_id, language, files, active_file, open_tabs, file_order, stdin,
        revision, writer_id
      )
      VALUES (
        ${userId},
        ${project.language},
        ${tx.json(project.files as JSONValue)},
        ${project.activeFile},
        ${project.openTabs},
        ${project.fileOrder},
        ${project.stdin},
        1,
        ${project.writerId}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        language    = EXCLUDED.language,
        files       = EXCLUDED.files,
        active_file = EXCLUDED.active_file,
        open_tabs   = EXCLUDED.open_tabs,
        file_order  = EXCLUDED.file_order,
        stdin       = EXCLUDED.stdin,
        revision    = public.editor_project.revision + 1,
        writer_id   = EXCLUDED.writer_id,
        updated_at  = now()
      WHERE public.editor_project.revision = ${project.expectedRevision}
      RETURNING language, files, active_file, open_tabs, file_order, stdin,
                revision, writer_id, updated_at
    `;
    if (rows.length > 0) {
      return { ok: true as const, project: rowToProject(rows[0]) };
    }
    const currentRows = await tx`
      SELECT language, files, active_file, open_tabs, file_order, stdin,
             revision, writer_id, updated_at
        FROM public.editor_project
       WHERE user_id = ${userId}
    `;
    return {
      ok: false as const,
      current: currentRows.length > 0
        ? rowToProject(currentRows[0])
        : { ...DEFAULT_PROJECT },
    };
  });
}
