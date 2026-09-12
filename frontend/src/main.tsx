import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import PublicApp from "./PublicApp";
import { PublicThemeSync } from "./features/marketing/public/PublicThemeSync";
import { PublicMotionWorld } from "./features/marketing/public/PublicMotionWorld";
import { RouteLoading } from "./features/marketing/public/RouteLoading";
import {
  shouldDeferAuthHydration,
  shouldUsePublicApp,
} from "./features/marketing/public/publicBootstrap";
import "./index.css";
// Side-effect import: applies `data-theme` on <html> from the stored preference
// at module load. Routes that don't transitively import theme.ts (e.g. the
// standalone /dev/content dashboard) otherwise render in default dark.
import "./util/theme";
import { captureDistributionAttribution } from "./features/distribution/attribution";
import { installPreloadErrorRecovery } from "./preloadRecovery";
// Phase 18a: hydrate the Supabase auth store before React mounts so the
// initial render reads a stable `loading: true` → resolved state rather
// than flashing the login page to users with a persisted session.
const FullApp = lazy(() => import("./App"));

// A tab left open across a deployment can still reference lazy chunks that the
// new release replaced. Recover that version skew before it becomes a blank UI.
installPreloadErrorRecovery();

// Release B4: capture a bounded first-touch channel before any route can fire
// funnel telemetry. This also removes the acquisition parameters from the
// address bar while preserving unrelated query flags.
captureDistributionAttribution();

const initialPathname = window.location.pathname;
const startsOnPublicSurface = shouldUsePublicApp(initialPathname);

function Bootstrap() {
  const { pathname } = useLocation();
  const deferAuthHydration = shouldDeferAuthHydration(pathname);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        void import("./auth/authStore").then(({ initAuth }) => initAuth());
      },
      startsOnPublicSurface && deferAuthHydration ? 5000 : 0,
    );
    return () => clearTimeout(timer);
  }, [deferAuthHydration]);

  return (
    <Suspense
      fallback={<RouteLoading fullHeight />}
    >
      {startsOnPublicSurface ? <PublicApp /> : <FullApp />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PublicThemeSync />
      <PublicMotionWorld><Bootstrap /></PublicMotionWorld>
    </BrowserRouter>
  </React.StrictMode>
);
