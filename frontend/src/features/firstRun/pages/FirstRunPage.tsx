import { FirstRunGreeting } from "../FirstRunGreeting";

// Route target for /welcome. Sits under AuthedLayout so RequireAuth +
// HydrationGate have already resolved before mount — the greeting can
// assume user.user_metadata + preferences are populated.
//
// Kept as a tiny shell so the greeting + all its choreography stay
// centralized in FirstRunGreeting → CinematicGreeting. This page exists
// only so /welcome has something to mount.
export default function FirstRunPage() {
  return <FirstRunGreeting />;
}
