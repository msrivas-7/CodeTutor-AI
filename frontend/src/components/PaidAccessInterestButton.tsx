import { useState } from "react";
import { api } from "../api/client";
import { useAIStatus } from "../state/useAIStatus";

// Phase 20-P4: a paying customer is a paying customer regardless of whether
// they're on BYOK, the free tier, or locked out — so we surface a way to
// express interest everywhere. Two contextual render sites today:
//   - ExhaustionCard       (free-tier users at 0/30 today)
//   - TutorSetupWarning    (blocked states: paused, denylisted, provider-down)
//
// Phase 24A: Settings has its own inline banner at the top of the modal
// (`PaidInterestBanner` in SettingsPanel.tsx) — a slimmer always-on
// surface that doesn't reuse this component because the visual treatment
// is different. Each click everywhere flows through the same POST
// /api/user/paid-access-interest upsert; `click_count` bumps so multi-
// surface clicks still land as a single row for the operator to follow up on.

interface PaidAccessInterestButtonProps {
  // Optional tone override so this button blends with warn-palette surfaces
  // (ExhaustionCard, TutorSetupWarning) or the neutral Settings surface.
  tone?: "warn" | "neutral";
  // Optional prompt copy above the button. Settings gets its own lead-in;
  // contextual surfaces leave this off.
  leadIn?: string;
}

export function PaidAccessInterestButton({
  tone = "neutral",
  leadIn,
}: PaidAccessInterestButtonProps) {
  const { status, refetch } = useAIStatus();
  const [state, setState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");

  // One paying-signal per user is enough — once any surface has recorded
  // interest, every other mounted instance hides itself after the next
  // ai-status refetch. `state==="submitted"` keeps the local acknowledgement
  // visible until the component unmounts / the hook broadcasts the update.
  if (status?.hasShownPaidInterest && state !== "submitted") {
    return null;
  }

  const handleClick = async () => {
    if (state === "submitting" || state === "submitted") return;
    setState("submitting");
    try {
      await api.submitPaidAccessInterest();
      setState("submitted");
      refetch();
    } catch {
      setState("error");
    }
  };

  const btnCls =
    tone === "warn"
      ? "rounded-md border border-warn/40 bg-bg/40 px-2.5 py-1 text-[11px] font-semibold text-warn transition hover:bg-bg/70 disabled:cursor-not-allowed disabled:opacity-60"
      : "rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:bg-elevated/80 disabled:cursor-not-allowed disabled:opacity-60";
  const leadCls = tone === "warn" ? "text-[11px] text-warn/80" : "text-[11px] text-muted";
  const ackCls = tone === "warn" ? "text-[11px] text-warn/90" : "text-[11px] text-muted";

  return (
    <div className="flex flex-col gap-1.5">
      {leadIn && <p className={leadCls}>{leadIn}</p>}
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "submitting" || state === "submitted"}
        className={btnCls}
      >
        {state === "submitted"
          ? "Interest recorded"
          : state === "submitting"
            ? "Sending…"
            : state === "error"
              ? "Try again"
              : "Register interest in a paid plan"}
      </button>
      {state === "submitted" && (
        <p role="status" aria-live="polite" className={ackCls}>
          Thanks — we've recorded your interest.
        </p>
      )}
    </div>
  );
}
