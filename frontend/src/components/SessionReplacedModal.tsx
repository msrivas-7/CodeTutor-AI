import { useSessionStore } from "../state/sessionStore";
import { Modal } from "./Modal";

// QA-H3: surfaced when a rebind returned a *different* sessionId than we
// requested — i.e. the backend refused our stored id (owner-mismatch defence
// or similar) and gave us a fresh one. Any in-flight session-scoped fetch
// against the old id has already been aborted by the api client; this modal
// gates the learner on an explicit acknowledgement before they keep typing
// against what looks like the same workspace but is materially a new
// container with a different id.
//
// Distinct from SessionRestartBanner (same-id, reused=false — runner memory
// reset but id stable) because the user-facing consequence is stronger:
// anything that carried the old id in localStorage or URL state is wrong,
// so we shouldn't let it slip by as a dismissible banner at the top.
export function SessionReplacedModal() {
  const sessionReplaced = useSessionStore((s) => s.sessionReplaced);
  const setSessionReplaced = useSessionStore((s) => s.setSessionReplaced);

  if (!sessionReplaced) return null;

  return (
    <Modal
      onClose={() => setSessionReplaced(false)}
      role="alertdialog"
      labelledBy="session-replaced-title"
      position="center"
      panelClassName="w-full max-w-md rounded-xl border border-warn/40 bg-panel p-6 shadow-xl"
    >
      <h2
        id="session-replaced-title"
        className="text-base font-semibold text-ink"
      >
        Workspace reassigned
      </h2>
      <p className="mt-3 text-sm text-faint">
        Your previous code runner couldn't be reused, so we assigned you a
        fresh one. Your saved code is untouched — the next Run will spin up
        the new runner.
      </p>
      <div className="mt-5 flex justify-end">
        <button
          onClick={() => setSessionReplaced(false)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
