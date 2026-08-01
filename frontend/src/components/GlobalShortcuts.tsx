import { useEffect, useState } from "react";
import { useAIStore } from "../state/aiStore";
import { Modal } from "./Modal";
import { useFirstRunStore } from "../features/firstRun/useFirstRunStore";

// QA-L4 + M-12: single window-level keydown handler for app-wide shortcuts.
//
//   ⌘/Ctrl+K  → focus the tutor composer (M-12: works regardless of whether
//               Monaco holds focus; Monaco's own addCommand still fires when
//               it does, but this ensures the shortcut also works from the
//               tutor panel, the lesson sidebar, etc.)
//   ?         → open the shortcut cheatsheet (QA-L4). Ignored when the user
//               is actually typing (input / textarea / contenteditable /
//               Monaco) so typing "?" in the composer doesn't trigger it.
//   Esc       → close the cheatsheet when it's open; everything else keeps
//               its own Esc handling (SSE abort, dialog dismiss, etc.).
//
// Mounted once at the app root — there's no route that shouldn't have these.

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Monaco's hidden textarea lives inside `.monaco-editor .inputarea`.
  if (el.closest(".monaco-editor")) return true;
  return false;
}

export function GlobalShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const bumpFocusComposer = useAIStore((s) => s.bumpFocusComposer);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The opening cinematic owns the complete interaction layer. Do not
      // mount a hidden dialog or move focus into the obscured workspace.
      if (
        useFirstRunStore.getState().cinematicShowing ||
        document.querySelector("[data-first-run-cinematic]")
      ) {
        return;
      }
      // ⌘/Ctrl+K — focus the composer. Monaco has its own addCommand for the
      // same combo that fires when Monaco is focused (it captures first and
      // stops propagation to this handler in that case). This handler is the
      // fallback for every other surface.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        bumpFocusComposer();
        return;
      }

      // ? — open the cheatsheet. Require shift so it isn't fired by the bare
      // "/" key on layouts where shift is implicit.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bumpFocusComposer]);

  if (!helpOpen) return null;

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";

  const rows: { keys: string; label: string }[] = [
    { keys: `${mod} + Enter`, label: "Ask the tutor (send from composer) / Run code (in editor)" },
    { keys: `${mod} + K`, label: "Jump focus to the tutor composer" },
    { keys: "Esc", label: "Cancel an in-flight tutor response or close a dialog" },
    { keys: "?", label: "Show this cheatsheet" },
  ];

  return (
    <Modal
      onClose={() => setHelpOpen(false)}
      labelledBy="kbd-help-title"
      position="center"
      panelClassName="mx-4 w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl"
    >
      <div>
        <div className="flex items-start justify-between gap-4">
          <h2 id="kbd-help-title" className="text-lg font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setHelpOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-border/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <dl className="mt-3 space-y-3 text-base sm:text-body">
          {rows.map((r) => (
            <div key={r.keys} className="flex items-start gap-3">
              <dt className="min-w-[84px] shrink-0">
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-meta text-ink">
                  {r.keys}
                </kbd>
              </dt>
              <dd className="text-muted">{r.label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-meta text-muted">
          Press <kbd className="font-mono">Esc</kbd> or click outside to close.
        </p>
      </div>
    </Modal>
  );
}
