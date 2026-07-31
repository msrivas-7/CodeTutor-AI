import { getTutorConceptEvidence } from "../../db/conceptLedger.js";
import { listLessonProgress } from "../../db/lessonProgress.js";
import {
  getTutorLessonSnapshot,
  type TutorLessonSnapshot,
} from "../share/lessonCatalog.js";
import type { LessonContext } from "./prompts/lessonContext.js";

/** The only lesson fields a browser may nominate for guided mode. */
export interface ClientLessonIdentity {
  courseId: string;
  lessonId: string;
  exerciseId?: string | null;
}

/**
 * Explicit trust classification for the Release 0D prompt boundary. These
 * fields remain in the user turn and can never become instruction authority.
 */
export interface ClientObservedTutorEvidence {
  question: "untrusted";
  files: "untrusted";
  selection: "untrusted";
  stdin: "untrusted";
  runOutput: "untrusted";
  diff: "untrusted";
  history: "untrusted";
}

export const TUTOR_EVIDENCE_TRUST: ClientObservedTutorEvidence = {
  question: "untrusted",
  files: "untrusted",
  selection: "untrusted",
  stdin: "untrusted",
  runOutput: "untrusted",
  diff: "untrusted",
  history: "untrusted",
};

function buildProgressSummary(
  lesson: TutorLessonSnapshot,
  progress: Awaited<ReturnType<typeof listLessonProgress>>[number] | undefined,
  evidence: Awaited<ReturnType<typeof getTutorConceptEvidence>>,
): string {
  const status = progress?.status ?? "not_started";
  const activity = progress
    ? `${progress.runCount} runs, ${progress.attemptCount} checks, ${progress.hintCount} accepted hints`
    : "no persisted attempts yet";
  const practiced = evidence
    .filter((item) => item.practiced)
    .map((item) => item.conceptTag);
  const seen = evidence
    .filter((item) => item.taught || item.used)
    .map((item) => item.conceptTag);
  const mastery = practiced.length
    ? `practiced concepts: ${practiced.join(", ")}`
    : seen.length
      ? `previously encountered concepts: ${seen.join(", ")}`
      : "no prior concept evidence";
  return `${lesson.exerciseId ? "Practice" : "Lesson"} status: ${status}; ${activity}; ${mastery}.`;
}

/**
 * Resolves every trusted guided-prompt field from server-owned catalog and
 * authenticated-user data. A client cannot override objectives, validator
 * rules, concept scope, language, ordering, or another learner's progress.
 */
export async function resolveCanonicalTutorContext(
  userId: string,
  identity: ClientLessonIdentity,
): Promise<LessonContext | null> {
  const lesson = await getTutorLessonSnapshot(
    identity.courseId,
    identity.lessonId,
    identity.exerciseId,
  );
  if (!lesson) return null;

  const relevantConcepts = Array.from(
    new Set([
      ...lesson.priorConcepts,
      ...lesson.teachesConceptTags,
      ...lesson.usesConceptTags,
    ]),
  );
  const [allProgress, conceptEvidence] = await Promise.all([
    listLessonProgress(userId, lesson.courseId),
    getTutorConceptEvidence(userId, relevantConcepts),
  ]);
  const progress = allProgress.find(
    (row) =>
      row.courseId === lesson.courseId && row.lessonId === lesson.lessonId,
  );
  return {
    courseId: lesson.courseId,
    lessonId: lesson.lessonId,
    lessonTitle: lesson.lessonTitle,
    language: lesson.language,
    lessonObjectives: lesson.lessonObjectives,
    teachesConceptTags: lesson.teachesConceptTags,
    usesConceptTags: lesson.usesConceptTags,
    priorConcepts: lesson.priorConcepts,
    completionCriteria: lesson.completionCriteria,
    studentProgressSummary: buildProgressSummary(
      lesson,
      progress,
      conceptEvidence,
    ),
    lessonOrder: lesson.lessonOrder,
    totalLessons: lesson.totalLessons,
  };
}

/** Anonymous mode has no persisted cross-user mastery read. */
export async function resolveCanonicalAnonTutorContext(
  identity: ClientLessonIdentity,
): Promise<LessonContext | null> {
  const lesson = await getTutorLessonSnapshot(
    identity.courseId,
    identity.lessonId,
    identity.exerciseId,
  );
  if (!lesson) return null;
  return {
    courseId: lesson.courseId,
    lessonId: lesson.lessonId,
    lessonTitle: lesson.lessonTitle,
    language: lesson.language,
    lessonObjectives: lesson.lessonObjectives,
    teachesConceptTags: lesson.teachesConceptTags,
    usesConceptTags: lesson.usesConceptTags,
    priorConcepts: lesson.priorConcepts,
    completionCriteria: lesson.completionCriteria,
    studentProgressSummary: "Anonymous first-session context; no persisted mastery is loaded.",
    lessonOrder: lesson.lessonOrder,
    totalLessons: lesson.totalLessons,
  };
}
