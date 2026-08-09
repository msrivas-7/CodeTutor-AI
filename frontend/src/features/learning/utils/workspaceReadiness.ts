export interface EditorReadinessOwnership {
  chatContextKey: string | null;
  courseId: string | undefined;
  lessonId: string | undefined;
  loading: boolean;
  loadedLessonId: string | undefined;
  initializedFor: string | null;
  projectContext: string | null;
}

/**
 * Monaco may acknowledge a context only after the loader and project store
 * both own that exact lesson/practice identity. This prevents same-named files
 * from the previous lesson from satisfying the new context's readiness check.
 */
export function resolveEditorReadinessKey({
  chatContextKey,
  courseId,
  lessonId,
  loading,
  loadedLessonId,
  initializedFor,
  projectContext,
}: EditorReadinessOwnership): string | null {
  if (
    !chatContextKey ||
    !courseId ||
    !lessonId ||
    loading ||
    loadedLessonId !== lessonId ||
    initializedFor !== `${courseId}/${lessonId}` ||
    projectContext !== chatContextKey
  ) {
    return null;
  }
  return chatContextKey;
}
