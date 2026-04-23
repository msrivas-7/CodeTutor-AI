import { api } from "../api/client";
import { PaidAccessInterestButton } from "./PaidAccessInterestButton";

// Phase 20-P4: replaces the tutor input when the learner has used all free
// daily questions. Three CTAs — each one is a separate willingness-to-pay
// signal on the server side.

interface ExhaustionCardProps {
  resetAtUtc: string | null;
  onOpenSettings?: () => void;
  onDismiss: () => void;
}

export function formatReset(resetAtUtc: string | null): string {
  if (!resetAtUtc) return "at midnight UTC";
  const ms = Math.max(0, new Date(resetAtUtc).getTime() - Date.now());
  if (ms === 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `in ${minutes}m`;
  return `in ${hours}h ${minutes}m`;
}

export function ExhaustionCard({ resetAtUtc, onOpenSettings, onDismiss }: ExhaustionCardProps) {
  const handleByok = () => {
    void api.reportExhaustionClick("clicked_byok").catch(() => {});
    onOpenSettings?.();
  };

  const handleDismiss = () => {
    void api.reportExhaustionClick("dismissed").catch(() => {});
    onDismiss();
  };

  return (
    <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
      <div className="mb-1 font-semibold text-warn">
        You've used today's free tutor questions.
      </div>
      <p className="text-warn/90">
        Resets {formatReset(resetAtUtc)}. Want to keep going right now?
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <button
          onClick={handleByok}
          className="rounded-md bg-warn px-2.5 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-warn/90"
        >
          Add my OpenAI key for unlimited
        </button>
        <PaidAccessInterestButton tone="warn" />
        <button
          onClick={handleDismiss}
          className="text-[11px] text-warn/70 underline underline-offset-2 transition hover:text-warn"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
