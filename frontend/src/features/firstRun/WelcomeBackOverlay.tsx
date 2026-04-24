import { useEffect, useState } from "react";
import { CinematicGreeting } from "./CinematicGreeting";
import { useWelcomeBack } from "./useWelcomeBack";

// Always-mounted inside AuthedLayout. Renders null unless the trigger
// rule in useWelcomeBack says "fire." The overlay's render logic is
// intentionally trivial — all state + decision lives in the hook.
//
// Fires once per session via a local `hasRendered` latch: even if the
// shouldShow signal flickers (e.g., progress rehydrate mid-display), we
// keep rendering the same instance so the greeting doesn't reset
// partway through.
export function WelcomeBackOverlay() {
  const { shouldShow, firstName, copy, dismiss } = useWelcomeBack();
  const [active, setActive] = useState(false);

  // Latch: once shouldShow has been true this render-cycle, keep
  // rendering until the cinematic's onComplete fires. Prevents the
  // overlay from blinking out mid-reveal if hydration shifts a
  // dependency behind us.
  useEffect(() => {
    if (shouldShow && !active) setActive(true);
  }, [shouldShow, active]);

  if (!active || !copy) return null;

  const handleComplete = () => {
    dismiss();
    setActive(false);
  };

  return (
    <CinematicGreeting
      mode="minimal"
      firstName={firstName}
      heroLine={copy.hero}
      subtitle={copy.subtitle}
      onComplete={handleComplete}
      onSkip={handleComplete}
    />
  );
}
