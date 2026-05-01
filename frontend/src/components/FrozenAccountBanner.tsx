import { usePreferencesStore } from "../state/preferencesStore";
import { useAuthStore } from "../auth/authStore";

// Phase 25: account-suspended banner.
//
// Renders a sticky red bar at the top of every authed page when the user's
// preferences row indicates `accountFrozen=true`. Sign-out is the only
// affordance — frozen users can read their own profile and contact
// support but can't create sessions, run code, or hit platform AI.
//
// Why no reason text: the operator-typed freeze reason is intended for
// the audit trail, not for user-facing copy. Surfacing it verbatim
// risks leaking detection heuristics, ticket IDs, reporter names, and
// internal slang. Industry pattern (GitHub / Twitter / Stripe) is to
// show a generic suspension notice + a contact path. The full reason
// stays server-side in `ai_platform_denylist.frozen_reason` for the
// admin's records.
//
// Hidden until preferences hydrate so a non-frozen user doesn't see a
// flash of red on slow networks.

export function FrozenAccountBanner() {
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const frozen = usePreferencesStore((s) => s.accountFrozen);
  const signOut = useAuthStore((s) => s.signOut);

  if (!hydrated || !frozen) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/15 px-4 py-2 text-[12px] text-danger"
    >
      <div className="flex flex-col">
        <strong className="font-semibold">
          Your account has been suspended.
        </strong>
        <span className="text-[11px] text-danger/80">
          Please contact support to discuss reinstatement.
        </span>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md border border-danger/60 bg-danger/10 px-3 py-1 text-[11px] font-semibold text-danger hover:bg-danger/20"
      >
        Sign out
      </button>
    </div>
  );
}
