import { useSessionStore } from "../state/sessionStore";

const LABEL: Record<string, string> = {
  idle: "Idle",
  starting: "Starting…",
  active: "Active",
  reconnecting: "Reconnecting…",
  error: "Error",
  ended: "Ended",
};

const DOT: Record<string, string> = {
  idle: "bg-faint",
  starting: "bg-warn animate-pulseDot",
  active: "bg-success",
  reconnecting: "bg-warn animate-pulseDot",
  error: "bg-danger",
  ended: "bg-faint",
};

// Reduced to a single colored dot — full session status is duplicated verbatim
// in the bottom StatusBar, so the header doesn't need the label + border box.
// The dot itself is enough signal at a glance; hover for the exact phase.
export function StatusBadge() {
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  const label = LABEL[phase] ?? phase;
  const tooltip = error ? `${label} — ${error}` : label;

  return (
    <span
      role="status"
      aria-label={`Session: ${tooltip}`}
      title={tooltip}
      className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[phase] ?? DOT.idle} ring-1 ring-border/40`}
    />
  );
}
