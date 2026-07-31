// Phase A — A6 (memory v0): write-only concept-tag ledger.
//
// Every lesson completion writes one row per concept the lesson
// teaches/uses, keyed by user_id (authed) OR ip_hash (anon pre-signup).
// This is the data substrate Phase B's read-side will use (concept-
// mastery graph, retrieval-warmup beats, Socratic try-first gate);
// Phase A is WRITE-ONLY.
//
// Idempotency: re-completing a lesson MUST NOT double-insert. The
// migration's UNIQUE partial indexes (one for each key path) enforce
// it at the DB layer. We use ON CONFLICT DO NOTHING so a second-time
// completion is a no-op rather than an error — caller can
// fire-and-forget without worrying about the replay case.
//
// RLS: the table is deny-all-by-default for anon/authenticated roles
// (migration line 75). All writes here go through the service-role
// pool (`db()`).

import { db, withRlsContext } from "./client.js";

export type ConceptEventType = "taught" | "used" | "practiced";

export interface ConceptLedgerWriteInput {
  // Exactly one of (userId, ipHash) must be set — owner_ck DB CHECK
  // enforces it server-side too.
  userId?: string | null;
  ipHash?: string | null;
  courseId: string;
  lessonId: string;
  // Tags grouped by event type so the caller can pass through both the
  // lesson's `teachesConceptTags` and `usesConceptTags` in one call.
  taught?: string[];
  used?: string[];
  practiced?: string[];
}

export interface TutorConceptEvidence {
  conceptTag: string;
  taught: boolean;
  used: boolean;
  practiced: boolean;
}

/**
 * Server-only, user-scoped read for the contextual tutor. There is no client
 * read route and the query always binds the authenticated user id; callers
 * cannot nominate a different learner whose mastery should be loaded.
 */
export async function getTutorConceptEvidence(
  userId: string,
  conceptTags: string[],
): Promise<TutorConceptEvidence[]> {
  const tags = dedup(conceptTags).slice(0, 100);
  if (tags.length === 0) return [];
  const rows = await withRlsContext(userId, async (tx) => tx<
    Array<{
      concept_tag: string;
      taught: boolean;
      used: boolean;
      practiced: boolean;
    }>
  >`
    SELECT concept_tag,
           bool_or(event_type = 'taught') AS taught,
           bool_or(event_type = 'used') AS used,
           bool_or(event_type = 'practiced') AS practiced
      FROM public.learner_concept_ledger
     WHERE user_id = ${userId}
       AND concept_tag = ANY(${tags}::text[])
     GROUP BY concept_tag
     ORDER BY concept_tag
  `);
  return rows.map((row) => ({
    conceptTag: row.concept_tag,
    taught: row.taught,
    used: row.used,
    practiced: row.practiced,
  }));
}

/**
 * Write concept-tag rows for a single lesson completion. Returns the
 * count of NEW rows inserted (skipping rows that already exist via
 * ON CONFLICT DO NOTHING). Callers await this write before closing their
 * request lifecycle so a successful response cannot race process shutdown.
 */
export async function writeConceptTags(
  input: ConceptLedgerWriteInput,
): Promise<number> {
  const userId = input.userId ?? null;
  const ipHash = input.ipHash ?? null;
  // owner_ck DB CHECK enforces XOR; we pre-validate here so a typo
  // doesn't surface as a 23514 (constraint-violation) on every call.
  if ((userId === null) === (ipHash === null)) {
    throw new Error(
      "writeConceptTags: exactly one of (userId, ipHash) must be set",
    );
  }

  type Row = { tag: string; ev: ConceptEventType };
  const rows: Row[] = [];
  for (const tag of dedup(input.taught ?? [])) rows.push({ tag, ev: "taught" });
  for (const tag of dedup(input.used ?? [])) rows.push({ tag, ev: "used" });
  for (const tag of dedup(input.practiced ?? []))
    rows.push({ tag, ev: "practiced" });
  if (rows.length === 0) return 0;

  // A targetless ON CONFLICT DO NOTHING applies to every applicable unique
  // index, including the mutually exclusive user/ip partial indexes. Insert
  // the bounded lesson concept set in one statement: this is both race-safe
  // and avoids an N×(SELECT + INSERT) remote-Postgres request path.
  const sql = db();
  const values = rows.map((row) => ({
    user_id: userId,
    ip_hash: ipHash,
    course_id: input.courseId,
    lesson_id: input.lessonId,
    concept_tag: row.tag,
    event_type: row.ev,
  }));
  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO public.learner_concept_ledger ${sql(values)}
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return inserted.length;
}

function dedup(tags: string[]): string[] {
  // Trim + drop empty + dedup. Lesson authors sometimes ship the same
  // tag twice (legacy, accidental); the unique index would reject
  // the duplicate downstream, but it's cheaper to collapse upfront.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = (raw ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
