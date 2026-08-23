import type { LessonMeta } from "../types";

function formatTitleList(titles: readonly string[]) {
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(", ")}, and ${titles.at(-1)}`;
}

export function savedProgressRecoveryMessage({
  lessons,
  savedButLockedLessons,
  completedIds,
}: {
  lessons: readonly LessonMeta[];
  savedButLockedLessons: readonly LessonMeta[];
  completedIds: readonly string[];
}) {
  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const unmetPrerequisiteIds = [
    ...new Set(
      savedButLockedLessons.flatMap((lesson) =>
        lesson.prerequisiteLessonIds.filter((id) => !completedIds.includes(id)),
      ),
    ),
  ];
  const prerequisiteTitles = unmetPrerequisiteIds
    .map((id) => lessonsById.get(id)?.title)
    .filter((title): title is string => Boolean(title));
  const recoveryTarget =
    savedButLockedLessons.length === 1
      ? "the saved lesson and its practice"
      : `${savedButLockedLessons.length} saved lessons and their practice`;

  if (prerequisiteTitles.length > 0) {
    return `Recomplete ${formatTitleList(prerequisiteTitles)} to reopen ${recoveryTarget}.`;
  }
  return `Recomplete the missing prerequisites to reopen ${recoveryTarget}.`;
}
