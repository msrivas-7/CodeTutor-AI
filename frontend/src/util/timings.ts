// Tiny home for durations that are referenced across multiple files. Values
// used once stay at their callsite — centralizing those would obscure more
// than it clarifies.
//
// Add here only when the same number shows up in 2+ places AND they're
// semantically the same thing (changing one should change the others).

// Delay before the first-run spotlight tour auto-opens. Long enough to let
// the page's own paint settle so the anchor rects are stable; short enough
// that it feels like the app is offering help, not lagging.
export const COACH_AUTO_OPEN_MS = 600;

// How long the one-off "resumed your saved code" toast stays up before it
// fades. Used by the lesson-resume indicator in LessonPage.
export const RESUME_TOAST_MS = 3000;
