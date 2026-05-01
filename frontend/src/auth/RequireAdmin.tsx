import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "./authStore";
import { AuthLoader } from "./AuthLoader";

// Phase 25: route guard for /admin/*. Mirrors RequireAuth but layers an
// `isAdmin()` check on top. Server enforces the same gate on every
// /api/admin/* call (adminGuard middleware reads the user_roles table on
// every request) — this client-side check is purely for UI visibility,
// so a forged JWT can't grant data access even if it bypasses this guard.
//
// Non-admins land on /start (not /login). RequireAuth is composed via
// the AuthedLayout that wraps this; we trust the user is already authed
// by the time RequireAdmin renders.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const loading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin());

  if (loading) {
    return <AuthLoader testId="require-admin-loader" label="Loading admin" />;
  }
  if (!user || !isAdmin) {
    return <Navigate to="/start" replace />;
  }
  return <>{children}</>;
}
