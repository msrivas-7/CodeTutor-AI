import { Modal } from "../../../components/Modal";

// Phase 22F2A — B6: soft-warning confirm when a learner clicks a course whose
// `prerequisiteCourseIds` aren't fully completed. The user is never blocked —
// the modal is an interrupt, not a gate. They can route to the prereq course
// or continue into the chosen course; either way they always have the choice.
//
// This sits between the dashboard click and react-router navigate. The
// dashboard owns "is the prereq met"; this component owns the copy + a11y.
// Always shown when prereqs are unmet; "don't show again" is intentionally
// out of scope until we see whether it becomes nag-y at any meaningful user
// volume (zero today; revisit post-launch).

interface CoursePrereqWarningModalProps {
  /** Title of the course the user clicked (e.g. "Python Intermediate"). */
  targetCourseTitle: string;
  /** Title of the FIRST incomplete prerequisite course. The modal references
   *  this by name; the rest of the (potentially longer) prereq list isn't
   *  surfaced because picking one off the queue is a clearer mental model
   *  than a checklist for a soft warning. */
  prereqCourseTitle: string;
  /** Caller closes the modal. Lifecycle is owned by the parent — this
   *  component does not mutate any global state. */
  onClose: () => void;
  /** User chose to continue into the target course anyway. Caller routes
   *  to /learn/course/<targetId>. */
  onContinue: () => void;
  /** User chose to go to the prerequisite course. Caller routes to
   *  /learn/course/<prereqId> (or its first incomplete lesson). */
  onGoToPrereq: () => void;
}

export function CoursePrereqWarningModal({
  targetCourseTitle,
  prereqCourseTitle,
  onClose,
  onContinue,
  onGoToPrereq,
}: CoursePrereqWarningModalProps) {
  return (
    <Modal
      onClose={onClose}
      role="alertdialog"
      labelledBy="course-prereq-warning-title"
      describedBy="course-prereq-warning-body"
      position="center"
      panelClassName="mx-4 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="course-prereq-warning-title"
          className="text-lg font-semibold text-ink"
        >
          Heads up
        </h2>
        <p
          id="course-prereq-warning-body"
          className="text-base leading-relaxed text-ink/90 sm:text-body"
        >
          {targetCourseTitle} assumes you&rsquo;ve completed{" "}
          <span className="font-semibold text-ink">{prereqCourseTitle}</span>.
          You can continue if you&rsquo;d like &mdash; but it&rsquo;ll move
          faster than starting from the basics.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onGoToPrereq}
            className="min-h-11 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Take me to {prereqCourseTitle}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-ink/80 underline-offset-4 transition hover:bg-elevated hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Continue to {targetCourseTitle}
          </button>
        </div>
      </div>
    </Modal>
  );
}
