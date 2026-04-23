import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./authStore";
import { AuthLoader } from "./AuthLoader";

// Route guard. Reads auth state from the store:
//  - `loading` (initial hydration): render AuthLoader so we don't flash
//    `/login` to a user whose session is about to hydrate from
//    localStorage. The same component is reused by HydrationGate so the
//    two phases look like one continuous loader.
//  - No user once loading is done: redirect to `/login` and stash the
//    original location in router state so the login page can bounce back
//    after a successful sign-in.
//  - Signed in: render the protected subtree.
export function RequireAuth({ children }: { children: ReactNode }) {
  const loading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (loading) {
    // Indeterminate progress here — we don't know how long Supabase's
    // session restore will take. HydrationGate takes over with a
    // determinate bar as soon as `loading` flips false. Skip the
    // MIN_VISIBLE_MS floor under automation so e2e specs don't each
    // eat the full reveal window.
    const isAutomated =
      typeof navigator !== "undefined" && navigator.webdriver === true;
    return (
      <AuthLoader
        testId="require-auth-loader"
        label="Welcome back"
        enforceMinDuration={!isAutomated}
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
