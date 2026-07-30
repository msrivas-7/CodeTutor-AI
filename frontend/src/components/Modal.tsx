import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  // ID of the heading element inside `children` that labels the dialog for
  // screen readers. Omit for alertdialog-style confirms where the entire body
  // is the announcement.
  labelledBy?: string;
  // ID of the element that further describes the dialog (body copy or subtitle)
  // for screen readers. Paired with labelledBy so SRs announce both the title
  // and the descriptive line on focus.
  describedBy?: string;
  // "alertdialog" is the right role for destructive confirms (Reset Lesson /
  // Reset Course) — it tells screen readers the dialog is interrupting with a
  // high-priority message that requires a response.
  role?: "dialog" | "alertdialog";
  // Tailwind classes for the inner panel. Callers own colour/size — the Modal
  // only owns the overlay + dismissal lifecycle.
  panelClassName?: string;
  // Layout of the overlay: "center" vertically centres the panel (confirms),
  // "top" anchors near the top of the viewport (Settings).
  position?: "center" | "top" | "bottom";
  // Stacking layer for the backdrop. Default 50 covers normal modals.
  // Higher values are reserved for surfaces that need to overlay
  // already-fullscreen takeovers — e.g. the ShareDialog opening
  // FROM the LessonCompletePanel (which sits at z-[55]).
  zIndex?: number;
}

// Shared modal wrapper. Owns Esc-to-close, backdrop-click-to-close, portal,
// focus-on-mount, and focus-restore-on-unmount so every modal in the product
// behaves the same — previously SettingsModal had Esc but the confirm dialogs
// didn't, and none restored focus when closed.
export function Modal({
  onClose,
  children,
  labelledBy,
  describedBy,
  role = "dialog",
  panelClassName = "w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl",
  position = "top",
  zIndex = 50,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Cinema Kit Continuity Pass — modal exit animation. Existing
  // callers do `{open && <Modal onClose={() => setOpen(false)}>}`,
  // which means the parent unmounts us instantly when their state
  // flips. AnimatePresence at the parent level would fix this, but
  // refactoring every caller (~7 sites) is too much surface area.
  // Instead: Modal intercepts its OWN close paths (Esc, backdrop
  // click). It flips a local `exiting` flag, plays the reverse
  // entrance animation via AnimatePresence, then calls the real
  // onClose. Parent code is unchanged.
  //
  // Edge: if a caller dismisses the modal via state OUTSIDE its
  // onClose (e.g. SettingsPanel's Save button flipping the parent's
  // showSettings to false directly), we skip the exit animation —
  // those paths still pop out cold. Most product modals close via
  // user-initiated dismiss, so this covers the visible majority.
  const [exiting, setExiting] = useState(false);
  const closeWithExit = useCallback(() => {
    if (exiting) return;
    setExiting(true);
  }, [exiting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const layers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-modal-layer]"),
      );
      const topLayer = layers.reduce<HTMLElement | null>((top, candidate) => {
        if (!top) return candidate;
        const topZ = Number(top.dataset.modalLayer) || 0;
        const candidateZ = Number(candidate.dataset.modalLayer) || 0;
        return candidateZ >= topZ ? candidate : top;
      }, null);
      if (topLayer === backdropRef.current) closeWithExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeWithExit]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();
    return () => {
      // Stacked-dialog teardown also removes `inert` from the lower layer.
      // Defer restoration until all effect cleanups have run so focus does
      // not target an element that is still inert for this cleanup tick.
      queueMicrotask(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
    };
  }, []);

  // Make the rest of the document genuinely non-interactive while a modal is
  // open. The focus trap protects keyboard navigation, but without `inert`
  // assistive technology and scripted focus could still reach the workspace
  // behind the backdrop. This also composes for stacked modals: a share dialog
  // temporarily inerts the completion dialog beneath it, then restores that
  // layer when it closes while the completion dialog keeps the app inert.
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;

    const siblings = Array.from(document.body.children).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node !== backdrop,
    );
    const previous = siblings.map((node) => ({
      node,
      inert: node.inert,
      ariaHidden: node.getAttribute("aria-hidden"),
    }));

    for (const node of siblings) {
      node.inert = true;
      node.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const state of previous) {
        state.node.inert = state.inert;
        if (state.ariaHidden === null) state.node.removeAttribute("aria-hidden");
        else state.node.setAttribute("aria-hidden", state.ariaHidden);
      }
    };
  }, []);

  // Phase 20-P1: Tab focus trap. Modal.tsx focused first element on mount but
  // Tab could escape to the page behind (Settings, Reset Lesson, language
  // switch), which is both a WCAG failure and a confusing UX — the backdrop
  // swallows clicks but not keystrokes. Wrap focus back to the first/last
  // focusable inside the panel when the user Tabs past the edge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const layers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-modal-layer]"),
      );
      const topLayer = layers.reduce<HTMLElement | null>((top, candidate) => {
        if (!top) return candidate;
        return (Number(candidate.dataset.modalLayer) || 0) >=
          (Number(top.dataset.modalLayer) || 0)
          ? candidate
          : top;
      }, null);
      if (topLayer !== backdropRef.current) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const overlayPos =
    position === "center"
      ? "items-center justify-center"
      : position === "bottom"
        ? "items-end justify-center sm:items-center"
        : "items-start justify-center pt-[10vh]";

  // Honor prefers-reduced-motion — skip the scale/translate entrance
  // and fall back to a pure opacity fade. framer-motion's hook returns
  // true when the OS flag is set.
  const reduce = useReducedMotion();
  const panelInitial = reduce
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.96, y: 4 };
  const panelAnimate = { opacity: 1, scale: 1, y: 0 };
  const panelTransition = {
    duration: reduce ? 0.12 : 0.18,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  // AnimatePresence wraps the conditional. When `exiting` flips
  // true, framer plays the exit variants on both backdrop and panel,
  // then onExitComplete fires the real parent onClose — which
  // unmounts us. The reduced-motion exit collapses to a 100 ms
  // opacity drop so motion-sensitive users still see a brief
  // dissolve instead of an abrupt vanish.
  const panelExit = reduce
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.96, y: 4 };

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {!exiting && (
        <motion.div
          ref={backdropRef}
          key="backdrop"
          data-modal-layer={zIndex}
          className={`fixed inset-0 flex ${overlayPos} bg-black/50 backdrop-blur-sm`}
          style={{ zIndex }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduce ? 0.1 : 0.16 } }}
          transition={{ duration: 0.18 }}
          onClick={(e) => {
            if (e.target === backdropRef.current) closeWithExit();
          }}
        >
          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            tabIndex={-1}
            className={panelClassName}
            initial={panelInitial}
            animate={panelAnimate}
            exit={{
              ...panelExit,
              transition: { duration: reduce ? 0.1 : 0.16, ease: panelTransition.ease },
            }}
            transition={panelTransition}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
