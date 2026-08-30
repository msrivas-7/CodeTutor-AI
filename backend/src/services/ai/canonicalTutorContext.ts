import { getTutorConceptEvidence } from "../../db/conceptLedger.js";
import { listLessonProgress } from "../../db/lessonProgress.js";
import {
  getTutorLessonSnapshot,
  type TutorLessonSnapshot,
} from "../share/lessonCatalog.js";
import type { LessonContext } from "./prompts/lessonContext.js";
import type {
  ContextualTutorOffer,
  ProjectFile,
  RunResult,
} from "./provider.js";
import {
  verifyContextualEvidenceToken,
  type EvidenceOptions,
} from "./contextualEvidence.js";

/** The only lesson fields a browser may nominate for guided mode. */
export interface ClientLessonIdentity {
  courseId: string;
  lessonId: string;
  exerciseId?: string | null;
}

/** Browser-observed 1C evidence. Every field is validated and remains untrusted. */
export interface ClientContextualTutorOffer {
  contextVersion: 0;
  contextEpoch: string;
  projectRevision: number;
  evidenceToken: string;
  moveId: string;
  evidence: {
    code: "python-unclosed-parenthesis";
    path: string;
    line: number;
  };
  scaffoldLevel: 1;
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

const UNCLOSED_PARENTHESIS = /SyntaxError:\s*['"]\(['"]\s+was never closed/i;
const PYTHON_LOCATION = /File\s+["']([^"']+)["'],\s+line\s+(\d+)/g;

function runMatchesContextualEvidence(
  offer: ClientContextualTutorOffer,
  files: readonly ProjectFile[],
  lastRun: RunResult | null | undefined,
): boolean {
  if (!lastRun?.stderr || !UNCLOSED_PARENTHESIS.test(lastRun.stderr)) return false;
  const locations = [...lastRun.stderr.matchAll(PYTHON_LOCATION)];
  const location = locations.at(-1);
  if (!location || Number.parseInt(location[2], 10) !== offer.evidence.line) return false;
  const normalized = location[1].replaceAll("\\", "/");
  if (
    normalized !== offer.evidence.path &&
    !normalized.endsWith(`/${offer.evidence.path}`)
  ) return false;
  const file = files.find((candidate) => candidate.path === offer.evidence.path);
  if (!file) return false;
  return offer.evidence.line <= file.content.split("\n").length + 1;
}

/**
 * Resolve a learner-accepted 1C offer against server-authored lesson moves.
 * The browser may nominate current evidence, but it cannot author the teaching
 * move, raise the scaffold level, select hidden completion data, or turn raw
 * stderr into instructions.
 */
export async function resolveCanonicalContextualTutorOffer(
  actorId: string,
  identity: ClientLessonIdentity,
  offer: ClientContextualTutorOffer,
  files: readonly ProjectFile[],
  lastRun: RunResult | null | undefined,
  evidenceOptions: EvidenceOptions = {},
): Promise<ContextualTutorOffer | null> {
  const lesson = await getTutorLessonSnapshot(
    identity.courseId,
    identity.lessonId,
    identity.exerciseId,
  );
  if (!lesson || lesson.exerciseId || !lesson.assistanceMoves) return null;
  const move = lesson.assistanceMoves.moves.find(
    (candidate) => candidate.id === offer.moveId,
  );
  if (
    !move ||
    move.trigger.errorCode !== offer.evidence.code ||
    offer.scaffoldLevel > move.maxScaffoldLevel ||
    !runMatchesContextualEvidence(offer, files, lastRun) ||
    !verifyContextualEvidenceToken(
      offer.evidenceToken,
      actorId,
      {
        courseId: identity.courseId,
        lessonId: identity.lessonId,
        contextEpoch: offer.contextEpoch,
        projectRevision: offer.projectRevision,
      },
      files,
      lastRun,
      evidenceOptions,
    )
  ) return null;
  return {
    contextVersion: 0,
    contextEpoch: offer.contextEpoch,
    projectRevision: offer.projectRevision,
    moveId: move.id,
    evidence: {
      ...offer.evidence,
      label: "Syntax error",
    },
    scaffoldLevel: offer.scaffoldLevel,
    authoredQuestion: move.question,
  };
}

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
    exerciseId: lesson.exerciseId ?? null,
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
    exerciseId: lesson.exerciseId ?? null,
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
