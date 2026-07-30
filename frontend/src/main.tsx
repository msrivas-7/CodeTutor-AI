import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import PublicApp from "./PublicApp";
import "./index.css";
// Side-effect import: applies `data-theme` on <html> from the stored preference
// at module load. Routes that don't transitively import theme.ts (e.g. the
// standalone /dev/content dashboard) otherwise render in default dark.
import "./util/theme";
// Phase 18a: hydrate the Supabase auth store before React mounts so the
// initial render reads a stable `loading: true` → resolved state rather
// than flashing the login page to users with a persisted session.
const FullApp = lazy(() => import("./App"));

const PUBLIC_PATHS = new Set([
  "/",
  "/why-not-chatgpt",
  "/privacy",
  "/terms",
  "/support",
]);
const startsOnPublicSurface = PUBLIC_PATHS.has(window.location.pathname);

function Bootstrap() {
  useEffect(() => {
    const timer = setTimeout(
      () => {
        void import("./auth/authStore").then(({ initAuth }) => initAuth());
      },
      startsOnPublicSurface ? 5000 : 0,
    );
    return () => clearTimeout(timer);
  }, []);

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg text-muted">
          <span className="skeleton h-4 w-32 rounded" />
        </div>
      }
    >
      {startsOnPublicSurface ? <PublicApp /> : <FullApp />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Bootstrap />
    </BrowserRouter>
  </React.StrictMode>
);
