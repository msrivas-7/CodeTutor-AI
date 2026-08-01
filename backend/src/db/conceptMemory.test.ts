import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  answerMemoryWarmup,
  getConceptMemory,
  getOrCreateMemoryWarmup,
  recordPracticeEvidence,
} from "./conceptMemory.js";
import { closeDb, db, withRlsContext } from "./client.js";
import { writeConceptTags } from "./conceptLedger.js";
import { getPracticeEvidenceSnapshot } from "../services/share/lessonCatalog.js";

let dbReachable = false;
const userIds: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      ${id}, 'authenticated', 'authenticated', ${`memory-${id}@test.local`},
      '{}'::jsonb, '{}'::jsonb, now(), now()
    )
  `;
  userIds.push(id);
  return id;
}

async function seedDueExposure(
  userId: string,
  conceptTags: string[],
): Promise<void> {
  for (const conceptTag of conceptTags) {
    await db()`
      INSERT INTO public.learner_concept_ledger (
        user_id, course_id, lesson_id, concept_tag, event_type, occurred_at
      ) VALUES (
        ${userId}, 'python-fundamentals', 'memory-test-exposure',
        ${conceptTag}, 'used', now() - interval '6 days'
      )
      ON CONFLICT DO NOTHING
    `;
  }
}

beforeAll(async () => {
  try {
    await db()`SELECT 1 FROM public.learner_concept_evidence LIMIT 0`;
    await db()`SELECT 1 FROM public.learner_retrieval_episodes LIMIT 0`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable && userIds.length > 0) {
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

describe("Phase B1 concept memory integration", () => {
  it("reads Phase A exposure only for the authenticated owner", async () => {
    if (!dbReachable) return;
    const alice = await mkUser();
    const bob = await mkUser();
    await writeConceptTags({
      userId: alice,
      courseId: "python-fundamentals",
      lessonId: "variables",
      taught: ["variables"],
    });

    const aliceMemory = await getConceptMemory(alice, ["variables"]);
    const bobMemory = await getConceptMemory(bob, ["variables"]);

    expect(aliceMemory[0]).toMatchObject({
      conceptTag: "variables",
      state: "encountered",
      refreshDue: false,
    });
    expect(aliceMemory[0]?.firstSeenAt).not.toBeNull();
    expect(bobMemory[0]).toMatchObject({
      conceptTag: "variables",
      state: "unseen",
      firstSeenAt: null,
    });
  }, 30_000);

  it("records canonical practice once and never promotes it beyond practiced", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const snapshot = await getPracticeEvidenceSnapshot(
      "python-fundamentals",
      "functions",
      "square-function",
    );
    expect(snapshot).not.toBeNull();
    const input = {
      requestId: randomUUID(),
      attemptCount: 2,
      hintCount: 1,
      timeSpentMs: 42_000,
      modelAssisted: true,
    };

    const first = await recordPracticeEvidence(userId, snapshot!, input);
    const replay = await recordPracticeEvidence(userId, snapshot!, input);
    const memory = await getConceptMemory(userId, ["def", "return"]);

    expect(first).toBe(5);
    expect(replay).toBe(0);
    expect(memory.map((item) => item.state)).toEqual(["practiced", "practiced"]);
    expect(memory.every((item) => item.independentRetrievalCount === 0)).toBe(true);
  }, 30_000);

  it("creates one warm-up under concurrency and records first-attempt recall idempotently", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await seedDueExposure(userId, ["int", "str", "string-concat"]);
    const [first, second] = await Promise.all([
      getOrCreateMemoryWarmup(userId, "python-fundamentals", "input-output"),
      getOrCreateMemoryWarmup(userId, "python-fundamentals", "input-output"),
    ]);

    expect(first).not.toBeNull();
    expect(second?.episodeId).toBe(first?.episodeId);
    expect(first).not.toHaveProperty("correctIndex");
    expect(first).not.toHaveProperty("explanation");

    const requestId = randomUUID();
    const answer = await answerMemoryWarmup(
      userId,
      first!.episodeId,
      requestId,
      1,
    );
    const replay = await answerMemoryWarmup(
      userId,
      first!.episodeId,
      requestId,
      1,
    );
    const memory = await getConceptMemory(userId, first!.conceptTags);
    const immediateRepeat = await getOrCreateMemoryWarmup(
      userId,
      "python-fundamentals",
      "input-output",
    );
    const activeRows = await db()<Array<{ count: number }>>`
      SELECT count(*)::int AS count
        FROM public.learner_retrieval_episodes
       WHERE user_id = ${userId}
         AND course_id = 'python-fundamentals'
         AND lesson_id = 'input-output'
         AND status = 'active'
    `;

    expect(answer).toMatchObject({
      isCorrect: true,
      attemptNumber: 1,
      completed: true,
      firstAttemptCorrect: true,
    });
    expect(replay).toEqual(answer);
    expect(memory.every((item) => item.state === "remembered")).toBe(true);
    expect(memory.every((item) => item.refreshDue === false)).toBe(true);
    expect(immediateRepeat).toBeNull();
    expect(activeRows[0]?.count).toBe(0);
  }, 30_000);

  it("distinguishes recall after feedback and denies another learner's episode", async () => {
    if (!dbReachable) return;
    const alice = await mkUser();
    const bob = await mkUser();
    await seedDueExposure(alice, ["int", "str", "string-concat"]);
    const warmup = await getOrCreateMemoryWarmup(
      alice,
      "python-fundamentals",
      "input-output",
    );
    expect(warmup).not.toBeNull();

    await expect(
      answerMemoryWarmup(bob, warmup!.episodeId, randomUUID(), 1),
    ).rejects.toMatchObject({ status: 404 });

    const wrong = await answerMemoryWarmup(
      alice,
      warmup!.episodeId,
      randomUUID(),
      0,
    );
    const corrected = await answerMemoryWarmup(
      alice,
      warmup!.episodeId,
      randomUUID(),
      1,
    );
    const memory = await getConceptMemory(alice, warmup!.conceptTags);

    expect(wrong).toMatchObject({
      isCorrect: false,
      attemptNumber: 1,
      completed: false,
      firstAttemptCorrect: false,
    });
    expect(corrected).toMatchObject({
      isCorrect: true,
      attemptNumber: 2,
      completed: true,
      firstAttemptCorrect: false,
    });
    expect(memory.every((item) => item.state === "practiced")).toBe(true);
    expect(memory.every((item) => item.supportedRetrievalCount === 1)).toBe(true);
  }, 30_000);

  it("requires spaced independent evidence before returning retained", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    for (const [evidenceDay, occurredAt] of [
      ["2026-07-20", "2026-07-20T12:00:00.000Z"],
      ["2026-07-25", "2026-07-25T12:00:00.000Z"],
    ]) {
      await db()`
        INSERT INTO public.learner_concept_evidence (
          user_id, concept_tag, course_id, lesson_id, activity_id,
          evidence_type, evidence_source, request_id, evidence_day, occurred_at
        ) VALUES (
          ${userId}, 'loops', 'python-fundamentals', 'while-loops',
          ${`retention-${evidenceDay}`}, 'retrieval_first_attempt',
          'server_verified', ${randomUUID()}, ${evidenceDay}::date,
          ${occurredAt}::timestamptz
        )
      `;
    }

    const memory = await getConceptMemory(
      userId,
      ["loops"],
      new Date("2026-07-26T12:00:00.000Z"),
    );
    expect(memory[0]).toMatchObject({
      state: "retained",
      independentRetrievalCount: 2,
      refreshDue: false,
    });
  }, 30_000);

  it("enforces own-user RLS on every new memory table even without WHERE clauses", async () => {
    if (!dbReachable) return;
    const alice = await mkUser();
    const bob = await mkUser();
    const aliceEpisode = randomUUID();
    const bobEpisode = randomUUID();
    await db()`
      INSERT INTO public.learner_retrieval_episodes (
        id, user_id, course_id, lesson_id, warmup_id, warmup_version,
        concept_tags, status, attempt_count, first_attempt_correct, completed_at
      ) VALUES
        (${aliceEpisode}, ${alice}, 'python-fundamentals', 'input-output',
         'rls-proof', 1, ARRAY['str'], 'completed', 1, true, now()),
        (${bobEpisode}, ${bob}, 'python-fundamentals', 'input-output',
         'rls-proof', 1, ARRAY['str'], 'completed', 1, true, now())
    `;
    await db()`
      INSERT INTO public.learner_retrieval_answers (
        request_id, episode_id, user_id, choice_index, is_correct, attempt_number
      ) VALUES
        (${randomUUID()}, ${aliceEpisode}, ${alice}, 0, true, 1),
        (${randomUUID()}, ${bobEpisode}, ${bob}, 0, true, 1)
    `;
    await db()`
      INSERT INTO public.learner_concept_evidence (
        user_id, concept_tag, course_id, lesson_id, activity_id,
        evidence_type, evidence_source, request_id
      ) VALUES
        (${alice}, 'str', 'python-fundamentals', 'input-output', 'rls-proof',
         'retrieval_first_attempt', 'server_verified', ${randomUUID()}),
        (${bob}, 'str', 'python-fundamentals', 'input-output', 'rls-proof',
         'retrieval_first_attempt', 'server_verified', ${randomUUID()})
    `;

    const visible = await withRlsContext(alice, async (tx) => {
      const evidence = await tx<Array<{ user_id: string }>>`
        SELECT user_id FROM public.learner_concept_evidence
      `;
      const episodes = await tx<Array<{ user_id: string }>>`
        SELECT user_id FROM public.learner_retrieval_episodes
      `;
      const answers = await tx<Array<{ user_id: string }>>`
        SELECT user_id FROM public.learner_retrieval_answers
      `;
      return { evidence, episodes, answers };
    });

    for (const rows of Object.values(visible)) {
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.user_id))).toEqual(new Set([alice]));
    }
  }, 30_000);

  it("denies direct authenticated writes while backend-owned writes still work", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const episodeId = randomUUID();
    await db()`
      INSERT INTO public.learner_retrieval_episodes (
        id, user_id, course_id, lesson_id, warmup_id, warmup_version,
        concept_tags
      ) VALUES (
        ${episodeId}, ${userId}, 'python-fundamentals', 'input-output',
        'authenticated-write-proof', 1, ARRAY['str']
      )
    `;

    const expectPermissionDenied = async (
      operation: () => Promise<unknown>,
    ): Promise<void> => {
      await expect(operation()).rejects.toMatchObject({ code: "42501" });
    };

    await expectPermissionDenied(() =>
      withRlsContext(userId, async (tx) => tx`
        INSERT INTO public.learner_concept_evidence (
          user_id, concept_tag, course_id, lesson_id, activity_id,
          evidence_type, evidence_source, request_id
        ) VALUES (
          ${userId}, 'str', 'python-fundamentals', 'input-output',
          'forged-browser-evidence', 'retrieval_first_attempt',
          'server_verified', ${randomUUID()}
        )
      `),
    );
    await expectPermissionDenied(() =>
      withRlsContext(userId, async (tx) => tx`
        INSERT INTO public.learner_retrieval_episodes (
          user_id, course_id, lesson_id, warmup_id, warmup_version,
          concept_tags
        ) VALUES (
          ${userId}, 'python-fundamentals', 'input-output',
          'forged-browser-episode', 1, ARRAY['str']
        )
      `),
    );
    await expectPermissionDenied(() =>
      withRlsContext(userId, async (tx) => tx`
        UPDATE public.learner_retrieval_episodes
           SET status = 'completed', first_attempt_correct = true
         WHERE id = ${episodeId}::uuid AND user_id = ${userId}
      `),
    );
    await expectPermissionDenied(() =>
      withRlsContext(userId, async (tx) => tx`
        INSERT INTO public.learner_retrieval_answers (
          request_id, episode_id, user_id, choice_index, is_correct,
          attempt_number
        ) VALUES (
          ${randomUUID()}, ${episodeId}::uuid, ${userId}, 0, true, 1
        )
      `),
    );

    const snapshot = await getPracticeEvidenceSnapshot(
      "python-fundamentals",
      "functions",
      "square-function",
    );
    expect(snapshot).not.toBeNull();
    await expect(
      recordPracticeEvidence(userId, snapshot!, {
        requestId: randomUUID(),
        attemptCount: 1,
        hintCount: 0,
        timeSpentMs: 1_000,
        modelAssisted: false,
      }),
    ).resolves.toBe(5);
  }, 30_000);
});
