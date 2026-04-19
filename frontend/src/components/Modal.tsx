import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  // ID of the heading element inside `children` that labels the dialog for
  // screen readers. Omit for alertdialog-style confirms where the entire body
  // is the announcement.
  labelledBy?: string;
  // "alertdialog" is the right role for destructive confirms (Reset Lesson /
  // Reset Course) — it tells screen readers the dialog is interrupting with a
  // high-priority message that requires a response.
  role?: "dialog" | "alertdialog";
  // Tailwind classes for the inner panel. Callers own colour/size — the Modal
  // only owns the overlay + dismissal lifecycle.
  panelClassName?: string;
  // Layout of the overlay: "center" vertically centres the panel (confirms),
  // "top" anchors near the top of the viewport (Settings).
  position?: "center" | "top";
}

// Shared modal wrapper. Owns Esc-to-close, backdrop-click-to-close, portal,
// focus-on-mount, and focus-restore-on-unmount so every modal in the product
// behaves the same — previously SettingsModal had Esc but the confirm dialogs
// didn't, and none restored focus when closed.
export function Modal({
  onClose,
  children,
  labelledBy,
  role = "dialog",
  panelClassName = "w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl",
  position = "top",
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panelRef.current)?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const overlayPos = position === "center" ? "items-center justify-center" : "items-start justify-center pt-[10vh]";

  return createPortal(
    <div
      ref={backdropRef}
      className={`fixed inset-0 z-50 flex ${overlayPos} bg-black/50 backdrop-blur-sm`}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
