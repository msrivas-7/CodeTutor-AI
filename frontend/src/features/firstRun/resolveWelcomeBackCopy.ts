import type { CourseProgress, LessonMeta, LessonProgress } from "../learning/types";

// Welcome-back hero + subtitle copy. One helper, tested in isolation,
// so the overlay component stays a dumb renderer. Four branches,
// first match wins — ordering encodes priority:
//   1. Something in-flight → pick up there
//   2. Freshly finished a course → celebrate forward
//   3. Has progress, nothing in-flight → dashboard wait
//   4. Never touched anything → invitation
//
// The hero line swaps at >7-day absence to a softer "Good to see you
// again" — a small, high-value detail that makes the app feel like
// it noticed you were gone.

export interface WelcomeBackCopy {
  hero: string;
  subtitle: string;
}

export interface WelcomeBackContext {
  firstName: string;
  now?: Date;
  lastWelcomeBackAt: string | null;
  // Keyed by courseId → CourseProgress, same shape as useProgressStore.
  courseProgressMap: Record<string, CourseProgress>;
  // Keyed by `${courseId}/${lessonId}` — matches progressStore.
  lessonProgressMap: Record<string, LessonProgress>;
  // Keyed by courseId → the course's title + lesson list. Used to
  // label the in-progress subtitle with a human lesson name instead
  // of an id.
  courseCatalog?: Record<
    string,
    { title: string; lessons: readonly Pick<LessonMeta, "id" | "title" | "order">[] }
  >;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function resolveWelcomeBackCopy(ctx: WelcomeBackContext): WelcomeBackCopy {
  const now = (ctx.now ?? new Date()).getTime();
  const longAbsence =
    ctx.lastWelcomeBackAt !== null &&
    now - Date.parse(ctx.lastWelcomeBackAt) > SEVEN_DAYS_MS;
  const hero = longAbsence
    ? `Good to see you again, ${ctx.firstName}.`
    : `Welcome back, ${ctx.firstName}.`;

  // Branch 1: an in-progress lesson anywhere. Prefer the most recently
  // updated one — a learner who bounces between two lessons should
  // land at whichever they touched last.
  const inProgress = Object.values(ctx.lessonProgressMap)
    .filter((l) => l.status === "in_progress")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  if (inProgress) {
    const course = ctx.courseCatalog?.[inProgress.courseId];
    const lesson = course?.lessons.find((l) => l.id === inProgress.lessonId);
    if (lesson) {
      return {
        hero,
        subtitle: `Picking up at Lesson ${lesson.order}: ${lesson.title}.`,
      };
    }
    return { hero, subtitle: "Picking up where you left off." };
  }

  // Branch 2: a course completed in the last 24 hours — recency filter
  // so we don't congratulate someone weeks after the fact.
  const completedRecently = Object.values(ctx.courseProgressMap)
    .filter(
      (c) =>
        c.status === "completed" &&
        c.completedAt &&
        now - Date.parse(c.completedAt) < 24 * 60 * 60 * 1000,
    )
    .sort(
      (a, b) => Date.parse(b.completedAt ?? "0") - Date.parse(a.completedAt ?? "0"),
    )[0];
  if (completedRecently) {
    const course = ctx.courseCatalog?.[completedRecently.courseId];
    const title = course?.title ?? "that course";
    return {
      hero,
      subtitle: `Nice work on ${title} — ready for what's next?`,
    };
  }

  // Branch 3: has progress, nothing in-flight — quiet, low-pressure.
  const hasAnyProgress = Object.values(ctx.courseProgressMap).some(
    (c) => c.status !== "not_started",
  );
  if (hasAnyProgress) {
    return { hero, subtitle: "Your dashboard is waiting." };
  }

  // Branch 4: a returning user with zero progress (rare — maybe they
  // signed up months ago and only today opened a lesson). Invite
  // without pressure.
  return { hero, subtitle: "Let's start something today." };
}
