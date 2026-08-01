import { HttpError } from "../middleware/errorHandler.js";
import {
  getLessonMemorySnapshot,
  type CanonicalMemoryWarmup,
  type PracticeEvidenceSnapshot,
} from "../services/share/lessonCatalog.js";
import { db, withRlsContext } from "./client.js";

export const MEMORY_REFRESH_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type ConceptMemoryState =
  | "unseen"
  | "encountered"
  | "practiced"
  | "remembered"
  | "retained";

export interface ConceptMemory {
  conceptTag: string;
  state: ConceptMemoryState;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastRetrievalAt: string | null;
  practiceCount: number;
  supportedRetrievalCount: number;
  independentRetrievalCount: number;
  refreshDue: boolean;
}

export interface MemoryWarmupPrompt {
  episodeId: string;
  courseId: string;
  lessonId: string;
  warmupId: string;
  warmupVersion: number;
  conceptTags: string[];
  prompt: string;
  choices: string[];
  attemptCount: number;
}

export interface MemoryWarmupAnswer {
  episodeId: string;
  isCorrect: boolean;
  attemptNumber: number;
  completed: boolean;
  firstAttemptCorrect: boolean;
  explanation: string;
}

interface MemoryAggregate {
  conceptTag: string;
  firstExposedAt: Date | string | null;
  lastExposedAt: Date | string | null;
  firstEvidenceAt: Date | string | null;
  lastEvidenceAt: Date | string | null;
  lastRetrievalAt: Date | string | null;
  practiceCount: number;
  supportedRetrievalCount: number;
  independentRetrievalDays: Array<Date | string>;
}

interface EpisodeRow {
  id: string;
  course_id: string;
  lesson_id: string;
  warmup_id: string;
  warmup_version: number;
  concept_tags: string[];
  status: "active" | "completed" | "superseded";
  attempt_count: number;
  first_attempt_correct: boolean | null;
}

interface AnswerRow {
  episode_id: string;
  is_correct: boolean;
  attempt_number: number;
}

export interface PracticeEvidenceInput {
  requestId: string;
  attemptCount: number;
  hintCount: number;
  timeSpentMs: number;
  modelAssisted: boolean;
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestDate(...values: Array<Date | string | null>): Date | null {
  return values
    .map(asDate)
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>(
      (latest, value) => (!latest || value > latest ? value : latest),
      null,
    );
}

function earliestDate(...values: Array<Date | string | null>): Date | null {
  return values
    .map(asDate)
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>(
      (earliest, value) => (!earliest || value < earliest ? value : earliest),
      null,
    );
}

function hasSpacedIndependentRetrieval(days: Array<Date | string>): boolean {
  const timestamps = days
    .map((day) => asDate(day)?.getTime() ?? Number.NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (timestamps.length < 2) return false;
  return timestamps[timestamps.length - 1]! - timestamps[0]! >= MEMORY_REFRESH_DAYS * DAY_MS;
}

/**
 * Honest B1 read model. Exposure and fast completion cannot become mastery:
 * practice is supporting evidence, one unassisted retrieval is remembered,
 * and retained requires independent retrieval on days spaced at least five
 * days apart. The learner-facing Phase C graph can later project these states
 * without changing the evidence contract.
 */
export function classifyConceptMemory(
  aggregate: MemoryAggregate,
  now = new Date(),
): ConceptMemory {
  const independentRetrievalCount = aggregate.independentRetrievalDays.length;
  const hasPractice =
    aggregate.practiceCount > 0 || aggregate.supportedRetrievalCount > 0;
  const hasExposure = aggregate.firstExposedAt !== null;
  let state: ConceptMemoryState = "unseen";
  if (hasExposure) state = "encountered";
  if (hasPractice) state = "practiced";
  if (independentRetrievalCount > 0) state = "remembered";
  if (hasSpacedIndependentRetrieval(aggregate.independentRetrievalDays)) {
    state = "retained";
  }

  const firstSeen = earliestDate(
    aggregate.firstExposedAt,
    aggregate.firstEvidenceAt,
  );
  const lastSeen = latestDate(
    aggregate.lastExposedAt,
    aggregate.lastEvidenceAt,
  );
  const lastRetrieval = asDate(aggregate.lastRetrievalAt);
  // A retrieval is useful only after the learner has actually encountered
  // the concept, and spacing starts from the most recent meaningful contact.
  // Without this anchor, a brand-new learner would be quizzed on unseen
  // material and a just-completed lesson would trigger immediate recognition
  // rather than delayed recall.
  const refreshAnchor = latestDate(lastRetrieval, lastSeen);
  const refreshDue =
    state !== "unseen" &&
    refreshAnchor !== null &&
    now.getTime() - refreshAnchor.getTime() >= MEMORY_REFRESH_DAYS * DAY_MS;

  return {
    conceptTag: aggregate.conceptTag,
    state,
    firstSeenAt: firstSeen?.toISOString() ?? null,
    lastSeenAt: lastSeen?.toISOString() ?? null,
    lastRetrievalAt: lastRetrieval?.toISOString() ?? null,
    practiceCount: aggregate.practiceCount,
    supportedRetrievalCount: aggregate.supportedRetrievalCount,
    independentRetrievalCount,
    refreshDue,
  };
}

/** User-scoped memory graph over a server-owned bounded concept set. */
export async function getConceptMemory(
  userId: string,
  conceptTags: string[],
  now = new Date(),
): Promise<ConceptMemory[]> {
  const tags = Array.from(
    new Set(conceptTags.map((tag) => tag.trim()).filter(Boolean)),
  ).slice(0, 200);
  if (tags.length === 0) return [];

  const rows = await withRlsContext(userId, async (tx) => tx<
    Array<{
      concept_tag: string;
      first_exposed_at: Date | null;
      last_exposed_at: Date | null;
      first_evidence_at: Date | null;
      last_evidence_at: Date | null;
      last_retrieval_at: Date | null;
      practice_count: number | string;
      supported_retrieval_count: number | string;
      independent_retrieval_days: Array<Date | string> | null;
    }>
  >`
    WITH requested AS (
      SELECT unnest(${tags}::text[]) AS concept_tag
    ), exposure AS (
      SELECT concept_tag,
             min(occurred_at) AS first_exposed_at,
             max(occurred_at) AS last_exposed_at
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
         AND concept_tag = ANY(${tags}::text[])
       GROUP BY concept_tag
    ), evidence AS (
      SELECT concept_tag,
             min(occurred_at) AS first_evidence_at,
             max(occurred_at) AS last_evidence_at,
             max(occurred_at) FILTER (
               WHERE evidence_type IN (
                 'retrieval_first_attempt', 'retrieval_after_feedback'
               )
             ) AS last_retrieval_at,
             count(*) FILTER (
               WHERE evidence_type = 'practice_completed'
             )::int AS practice_count,
             count(*) FILTER (
               WHERE evidence_type = 'retrieval_after_feedback'
             )::int AS supported_retrieval_count,
             array_agg(DISTINCT evidence_day ORDER BY evidence_day) FILTER (
               WHERE evidence_type = 'retrieval_first_attempt'
             ) AS independent_retrieval_days
        FROM public.learner_concept_evidence
       WHERE user_id = ${userId}
         AND concept_tag = ANY(${tags}::text[])
       GROUP BY concept_tag
    )
    SELECT requested.concept_tag,
           exposure.first_exposed_at,
           exposure.last_exposed_at,
           evidence.first_evidence_at,
           evidence.last_evidence_at,
           evidence.last_retrieval_at,
           coalesce(evidence.practice_count, 0) AS practice_count,
           coalesce(evidence.supported_retrieval_count, 0) AS supported_retrieval_count,
           coalesce(evidence.independent_retrieval_days, ARRAY[]::date[])
             AS independent_retrieval_days
      FROM requested
      LEFT JOIN exposure USING (concept_tag)
      LEFT JOIN evidence USING (concept_tag)
     ORDER BY requested.concept_tag
  `);

  return rows.map((row) =>
    classifyConceptMemory(
      {
        conceptTag: row.concept_tag,
        firstExposedAt: row.first_exposed_at,
        lastExposedAt: row.last_exposed_at,
        firstEvidenceAt: row.first_evidence_at,
        lastEvidenceAt: row.last_evidence_at,
        lastRetrievalAt: row.last_retrieval_at,
        practiceCount: Number(row.practice_count),
        supportedRetrievalCount: Number(row.supported_retrieval_count),
        independentRetrievalDays: row.independent_retrieval_days ?? [],
      },
      now,
    ),
  );
}

/** Store bounded, canonical practice completion as supporting evidence only. */
export async function recordPracticeEvidence(
  userId: string,
  snapshot: PracticeEvidenceSnapshot,
  input: PracticeEvidenceInput,
): Promise<number> {
  if (snapshot.conceptTags.length === 0) return 0;
  const result = await db().begin(async (tx) => {
    let inserted = 0;
    for (const conceptTag of snapshot.conceptTags) {
      const rows = await tx<Array<{ id: string }>>`
        INSERT INTO public.learner_concept_evidence (
          user_id, concept_tag, course_id, lesson_id, activity_id,
          evidence_type, evidence_source, attempt_count, hint_count,
          time_spent_ms, model_assisted, request_id
        ) VALUES (
          ${userId}, ${conceptTag}, ${snapshot.courseId}, ${snapshot.lessonId},
          ${snapshot.exerciseId}, 'practice_completed', 'client_observed',
          ${input.attemptCount}, ${input.hintCount}, ${input.timeSpentMs},
          ${input.modelAssisted}, ${input.requestId}::uuid
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      inserted += rows.length;
    }
    return inserted;
  });
  return result as number;
}

function toPrompt(row: EpisodeRow, warmup: CanonicalMemoryWarmup): MemoryWarmupPrompt {
  return {
    episodeId: row.id,
    courseId: row.course_id,
    lessonId: row.lesson_id,
    warmupId: row.warmup_id,
    warmupVersion: row.warmup_version,
    conceptTags: [...row.concept_tags],
    prompt: warmup.prompt,
    choices: [...warmup.choices],
    attemptCount: row.attempt_count,
  };
}

function pickWarmup(
  warmups: CanonicalMemoryWarmup[],
  memory: ConceptMemory[],
): CanonicalMemoryWarmup | null {
  const due = new Set(
    memory.filter((item) => item.refreshDue).map((item) => item.conceptTag),
  );
  return (
    [...warmups]
      .filter((warmup) => warmup.conceptTags.some((tag) => due.has(tag)))
      .sort((a, b) => {
        const aDue = a.conceptTags.filter((tag) => due.has(tag)).length;
        const bDue = b.conceptTags.filter((tag) => due.has(tag)).length;
        return bDue - aDue || a.id.localeCompare(b.id);
      })[0] ?? null
  );
}

/** Return one deterministic warm-up when a lesson's prior concepts are due. */
export async function getOrCreateMemoryWarmup(
  userId: string,
  courseId: string,
  lessonId: string,
  now = new Date(),
): Promise<MemoryWarmupPrompt | null> {
  const snapshot = await getLessonMemorySnapshot(courseId, lessonId);
  if (!snapshot) throw new HttpError(404, "lesson not found");
  if (snapshot.priorConcepts.length === 0 || snapshot.warmups.length === 0) {
    return null;
  }
  const memory = await getConceptMemory(userId, snapshot.priorConcepts, now);
  const warmup = pickWarmup(snapshot.warmups, memory);
  if (!warmup) return null;

  const createOrRead = async (): Promise<EpisodeRow> =>
    (await db().begin(async (tx) => {
      const existing = await tx<EpisodeRow[]>`
        SELECT id, course_id, lesson_id, warmup_id, warmup_version,
               concept_tags, status, attempt_count, first_attempt_correct
          FROM public.learner_retrieval_episodes
         WHERE user_id = ${userId}
           AND course_id = ${courseId}
           AND lesson_id = ${lessonId}
           AND warmup_id = ${warmup.id}
           AND warmup_version = ${warmup.version}
           AND status = 'active'
         LIMIT 1
      `;
      if (existing[0]) return existing[0];
      const created = await tx<EpisodeRow[]>`
        INSERT INTO public.learner_retrieval_episodes (
          user_id, course_id, lesson_id, warmup_id, warmup_version, concept_tags
        ) VALUES (
          ${userId}, ${courseId}, ${lessonId}, ${warmup.id}, ${warmup.version},
          ${warmup.conceptTags}
        )
        RETURNING id, course_id, lesson_id, warmup_id, warmup_version,
                  concept_tags, status, attempt_count, first_attempt_correct
      `;
      return created[0]!;
    })) as EpisodeRow;

  try {
    return toPrompt(await createOrRead(), warmup);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error as { code?: string }).code !== "23505"
    ) {
      throw error;
    }
    // A concurrent request won the partial-unique insert. Read its episode.
    return toPrompt(await createOrRead(), warmup);
  }
}

async function loadCanonicalWarmup(row: EpisodeRow): Promise<CanonicalMemoryWarmup> {
  const snapshot = await getLessonMemorySnapshot(row.course_id, row.lesson_id);
  const warmup = snapshot?.warmups.find(
    (candidate) =>
      candidate.id === row.warmup_id && candidate.version === row.warmup_version,
  );
  if (!warmup) {
    throw new HttpError(409, "warm-up content changed; reload the lesson");
  }
  return warmup;
}

/** Check an answer against server-owned content and write honest evidence. */
export async function answerMemoryWarmup(
  userId: string,
  episodeId: string,
  requestId: string,
  choiceIndex: number,
): Promise<MemoryWarmupAnswer> {
  const episodeRows = await withRlsContext(userId, async (tx) => tx<EpisodeRow[]>`
    SELECT id, course_id, lesson_id, warmup_id, warmup_version,
           concept_tags, status, attempt_count, first_attempt_correct
      FROM public.learner_retrieval_episodes
     WHERE id = ${episodeId}::uuid AND user_id = ${userId}
     LIMIT 1
  `);
  const episode = episodeRows[0];
  if (!episode) throw new HttpError(404, "warm-up not found");
  const warmup = await loadCanonicalWarmup(episode);
  if (choiceIndex < 0 || choiceIndex >= warmup.choices.length) {
    throw new HttpError(400, "choiceIndex is out of range");
  }

  const result = await db().begin(async (tx) => {
    const lockedRows = await tx<EpisodeRow[]>`
      SELECT id, course_id, lesson_id, warmup_id, warmup_version,
             concept_tags, status, attempt_count, first_attempt_correct
        FROM public.learner_retrieval_episodes
       WHERE id = ${episodeId}::uuid AND user_id = ${userId}
       FOR UPDATE
    `;
    const locked = lockedRows[0];
    if (!locked) throw new HttpError(404, "warm-up not found");

    const priorAnswers = await tx<AnswerRow[]>`
      SELECT episode_id, is_correct, attempt_number
        FROM public.learner_retrieval_answers
       WHERE user_id = ${userId} AND request_id = ${requestId}::uuid
       LIMIT 1
    `;
    const prior = priorAnswers[0];
    if (prior) {
      if (prior.episode_id !== episodeId) {
        throw new HttpError(409, "requestId was already used");
      }
      return {
        episodeId,
        isCorrect: prior.is_correct,
        attemptNumber: prior.attempt_number,
        completed: locked.status === "completed",
        firstAttemptCorrect: locked.first_attempt_correct ?? false,
        explanation: warmup.explanation,
      };
    }
    if (locked.status !== "active") {
      throw new HttpError(409, "warm-up is already complete");
    }

    const attemptNumber = locked.attempt_count + 1;
    if (attemptNumber > 100) {
      throw new HttpError(409, "warm-up attempt limit reached");
    }
    const isCorrect = choiceIndex === warmup.correctIndex;
    const firstAttemptCorrect =
      attemptNumber === 1 ? isCorrect : (locked.first_attempt_correct ?? false);

    await tx`
      INSERT INTO public.learner_retrieval_answers (
        request_id, episode_id, user_id, choice_index, is_correct, attempt_number
      ) VALUES (
        ${requestId}::uuid, ${episodeId}::uuid, ${userId}, ${choiceIndex},
        ${isCorrect}, ${attemptNumber}
      )
    `;

    await tx`
      UPDATE public.learner_retrieval_episodes
         SET attempt_count = ${attemptNumber},
             first_attempt_correct = ${firstAttemptCorrect},
             status = ${isCorrect ? "completed" : "active"},
             completed_at = CASE WHEN ${isCorrect} THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = ${episodeId}::uuid AND user_id = ${userId}
    `;

    if (isCorrect) {
      const evidenceType = firstAttemptCorrect
        ? "retrieval_first_attempt"
        : "retrieval_after_feedback";
      for (const conceptTag of locked.concept_tags) {
        await tx`
          INSERT INTO public.learner_concept_evidence (
            user_id, concept_tag, course_id, lesson_id, activity_id,
            evidence_type, evidence_source, attempt_count, hint_count,
            time_spent_ms, model_assisted, request_id
          ) VALUES (
            ${userId}, ${conceptTag}, ${locked.course_id}, ${locked.lesson_id},
            ${locked.warmup_id}, ${evidenceType}, 'server_verified',
            ${attemptNumber}, 0, 0, false, ${requestId}::uuid
          )
          ON CONFLICT DO NOTHING
        `;
      }
    }

    return {
      episodeId,
      isCorrect,
      attemptNumber,
      completed: isCorrect,
      firstAttemptCorrect,
      explanation: warmup.explanation,
    };
  });
  return result as MemoryWarmupAnswer;
}
