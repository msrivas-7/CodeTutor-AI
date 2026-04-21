import { lazy, Suspense, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../../api/client";
import { buildDiagnostics } from "../../../components/FeedbackModal";

// Phase 20-P1 follow-up: contextual feedback chip shown on LessonCompletePanel.
// The persistent Feedback button in the header remains the "I have a complaint
// right now" escape hatch; this chip harvests the quieter "that was confusing
// but I wouldn't have clicked Feedback on my own" signal at peak context.
//
// Phase 20-P2 upgrade: the mood click now ALSO fires a fire-and-forget POST
// that persists a mood-only row — so we never drop the learner's signal when
// they click 😊/😐/😕 but don't type a follow-up. The modal still opens as
// an optional "want to say more?" step; if they do send one, that's a
// second row (correlated via user_id + lesson_id + time, good enough for
// triage without a join table). If the mood POST fails we swallow the
// error: a chip click shouldn't spam a toast, and the modal follow-up is
// itself a retry surface.
//
// The chip shows on EVERY lesson-complete render — even re-completions and
// subsequent lessons in the same tab. After a learner submits on a given
// completion we collapse the chip so the post-submit panel doesn't re-prompt
// them with "How was this lesson?"; next completion remounts and asks again.
// This is deliberate: different lessons surface different issues, and an
// already-completed lesson attempted again means the learner came back to it,
// which is itself useful signal.

const FeedbackModalLazy = lazy(() =>
  import("../../../components/FeedbackModal").then((m) => ({ default: m.FeedbackModal })),
);

export type LessonFeedbackMood = "good" | "okay" | "bad";

// Exported so a unit test can pin the mood→category mapping: mis-mapping
// 😕 to "other" would drown the bug signal in generic traffic.
export const LESSON_FEEDBACK_MOODS: Array<{
  mood: LessonFeedbackMood;
  emoji: string;
  label: string;
  category: "other" | "bug";
}> = [
  { mood: "good", emoji: "😊", label: "This lesson was good", category: "other" },
  { mood: "okay", emoji: "😐", label: "This lesson was okay", category: "other" },
  { mood: "bad", emoji: "😕", label: "This lesson was confusing", category: "bug" },
];

interface LessonFeedbackChipProps {
  lessonId: string;
  lessonTitle: string;
}

export function LessonFeedbackChip({ lessonId, lessonTitle }: LessonFeedbackChipProps) {
  const location = useLocation();
  const [hidden, setHidden] = useState(false);
  const [openMood, setOpenMood] = useState<LessonFeedbackMood | null>(null);
  // Tracks that the mood-only POST already fired for this chip render so
  // React StrictMode's double-invoke doesn't double-insert in dev.
  const firedMoodRef = useRef(false);
  // Tracks a successful submit within this component's lifetime so close
  // collapses the chip (prevents the same panel re-prompting after Thanks).
  const submittedRef = useRef(false);

  if (hidden) return null;

  const selected = LESSON_FEEDBACK_MOODS.find((m) => m.mood === openMood);

  function handleMoodClick(mood: LessonFeedbackMood, category: "bug" | "other") {
    setOpenMood(mood);
    if (firedMoodRef.current) return;
    firedMoodRef.current = true;
    // Fire-and-forget: the UI must not block on the network, and a failure
    // is acceptable because the modal follow-up can still capture a note.
    // Keep lessonId distinct from the diagnostics blob (it's a first-class
    // column on feedback) so triage can group mood rows by lesson without
    // parsing jsonb.
    const diagnostics = buildDiagnostics(location.pathname) as unknown as Record<
      string,
      string
    >;
    void api
      .submitFeedback({
        body: "",
        category,
        mood,
        lessonId,
        diagnostics,
      })
      .then(() => {
        submittedRef.current = true;
      })
      .catch(() => {
        // Swallow — see component header. Don't toast here.
      });
  }

  function handleSubmitted() {
    submittedRef.current = true;
  }

  function handleClose() {
    // Collapsing the chip after a successful submit prevents the post-submit
    // panel from immediately re-prompting "How was this lesson?" — a jarring
    // UX after the Thanks state. Next lesson-complete remounts fresh.
    if (submittedRef.current) {
      setHidden(true);
    }
    setOpenMood(null);
  }

  return (
    <>
      <div
        className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2"
        data-testid="lesson-feedback-chip"
      >
        <span className="text-[11px] font-medium text-muted">How was this lesson?</span>
        <div className="flex gap-1" role="group" aria-label="Lesson feedback">
          {LESSON_FEEDBACK_MOODS.map(({ mood, emoji, label, category }) => (
            <button
              key={mood}
              type="button"
              onClick={() => handleMoodClick(mood, category)}
              aria-label={label}
              data-testid={`lesson-feedback-${mood}`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-panel/80 text-base transition hover:border-accent/40 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <Suspense fallback={null}>
          <FeedbackModalLazy
            onClose={handleClose}
            onSubmitted={handleSubmitted}
            initialCategory={selected.category}
            initialBody={`Lesson: ${lessonTitle}\n\n`}
          />
        </Suspense>
      )}
    </>
  );
}
