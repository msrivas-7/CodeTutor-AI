// Global keyboard-shortcut listener. Mounted once at the app root in
// main.tsx, inside an import.meta.env.DEV guard. Stripped from prod builds.
//
// Shortcut: Cmd/Ctrl + Shift + Alt + D toggles dev mode on/off.
//   - ON: captures the real snapshot, shows a toast.
//   - OFF: exits any active profile, restores real snapshot, reloads.
//
// We use a capture-phase listener on window so the shortcut works even when
// focus is inside the Monaco editor or another input — Monaco would
// otherwise swallow keydown events.

import { useEffect, useState } from "react";
import { useDevModeStore } from "./devModeStore";

function isToggleShortcut(e: KeyboardEvent): boolean {
  // Use e.code (physical key) instead of e.key — on Mac, holding Option
  // transforms e.key into a unicode symbol (Option+D → ∂, Shift+Option+D → Î),
  // so e.key would never equal "d" for this shortcut.
  if (e.code !== "KeyD") return false;
  if (!e.shiftKey || !e.altKey) return false;
  return e.metaKey || e.ctrlKey;
}

export function DevShortcut() {
  const { enabled, toggleDevMode } = useDevModeStore();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isToggleShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const willEnable = !enabled;
      toggleDevMode();
      setToast(willEnable ? "Dev mode enabled — open Settings to pick a profile" : "Dev mode disabled");
      setTimeout(() => setToast(null), 2500);
    };
    // capture=true so we win against Monaco and other editors that grab keydown
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as AddEventListenerOptions);
  }, [enabled, toggleDevMode]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-violet/40 bg-violet/15 px-3 py-1.5 text-[11px] font-medium text-violet backdrop-blur"
    >
      {toast}
    </div>
  );
}
