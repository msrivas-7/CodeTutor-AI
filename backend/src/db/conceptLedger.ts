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

import { db } from "./client.js";

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

/**
 * Write concept-tag rows for a single lesson completion. Returns the
 * count of NEW rows inserted (skipping rows that already exist via
 * ON CONFLICT DO NOTHING). Caller fires-and-forgets — failures are
 * logged but don't propagate (the user's lesson completion succeeded
 * regardless of ledger health).
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

  // ON CONFLICT (uq_learner_concept_ledger_user OR …_ip) DO NOTHING.
  // The two unique partial indexes are mutually exclusive (each gates
  // on user_id IS NOT NULL vs IS NULL) — postgres-js with no explicit
  // conflict target relies on the table's primary key, so we have to
  // reach for an explicit conflict target. Using ON CONFLICT
  // (user_id, course_id, lesson_id, concept_tag, event_type) requires
  // a unique constraint matching that tuple — we don't have one (the
  // unique indexes are partial, which postgres won't accept as the
  // target). The simplest robust path: a pre-check SELECT for each
  // row and an insert if absent. For the small N (lesson 1 has 3
  // tags; max realistic per call is ~20), the round-trip cost is
  // bounded.
  //
  // Alternative considered: bulk INSERT … SELECT … LEFT JOIN to
  // self-anti-join. Too clever for v0; the pre-check shape is easy
  // to reason about and tests against the actual UNIQUE constraints.
  const sql = db();
  let inserted = 0;
  for (const r of rows) {
    // The partial unique index already prevents duplicates at the DB
    // level — any race that bypasses our pre-check still 23505s on
    // INSERT, which we catch and treat as "already there." So this
    // is a fast path (skip the INSERT round trip for the common
    // re-complete case) layered over a correct path (DB constraint).
    const existing = userId
      ? await sql<{ id: string }[]>`
          SELECT id FROM public.learner_concept_ledger
           WHERE user_id = ${userId}
             AND course_id = ${input.courseId}
             AND lesson_id = ${input.lessonId}
             AND concept_tag = ${r.tag}
             AND event_type = ${r.ev}
           LIMIT 1
        `
      : await sql<{ id: string }[]>`
          SELECT id FROM public.learner_concept_ledger
           WHERE ip_hash = ${ipHash}
             AND course_id = ${input.courseId}
             AND lesson_id = ${input.lessonId}
             AND concept_tag = ${r.tag}
             AND event_type = ${r.ev}
           LIMIT 1
        `;
    if (existing.length > 0) continue;
    try {
      await sql`
        INSERT INTO public.learner_concept_ledger
          (user_id, ip_hash, course_id, lesson_id, concept_tag, event_type)
        VALUES
          (${userId}, ${ipHash}, ${input.courseId}, ${input.lessonId}, ${r.tag}, ${r.ev})
      `;
      inserted += 1;
    } catch (err) {
      // 23505 = unique-violation (the row was inserted between the
      // SELECT above and the INSERT here — concurrent re-completion).
      // Treat as a no-op: the row exists, our intent is satisfied.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        continue;
      }
      throw err;
    }
  }
  return inserted;
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
