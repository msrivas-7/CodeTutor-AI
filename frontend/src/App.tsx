import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { initAuth } from "./auth/authStore";
import { StorageQuotaBanner } from "./components/StorageQuotaBanner";
import { FrozenAccountBanner } from "./components/FrozenAccountBanner";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { InviteCapture } from "./features/anon/InviteCapture";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireAdmin } from "./auth/RequireAdmin";
import { HydrationGate } from "./auth/HydrationGate";
import { WelcomeBackOverlay } from "./features/firstRun/WelcomeBackOverlay";
const MarketingPage = lazy(() => import("./pages/MarketingPage"));
const WhyNotChatGPTPage = lazy(() => import("./pages/WhyNotChatGPTPage"));
const StartPage = lazy(() => import("./pages/StartPage"));
const EditorPage = lazy(() => import("./pages/EditorPage"));
const LearningDashboardPage = lazy(() => import("./features/learning/pages/LearningDashboardPage"));
const CourseOverviewPage = lazy(() => import("./features/learning/pages/CourseOverviewPage"));
const LessonPage = lazy(() => import("./features/learning/pages/LessonPage"));
const AnonLessonPage = lazy(() => import("./features/learning/pages/AnonLessonPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const FirstRunPage = lazy(() => import("./features/firstRun/pages/FirstRunPage"));
const SharePage = lazy(() => import("./features/share/pages/SharePage"));
const TrustPage = lazy(() => import("./pages/TrustPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const OverviewSection = lazy(() =>
  import("./components/admin/OverviewSection").then((module) => ({
    default: module.OverviewSection,
  })),
);
const SessionsSection = lazy(() =>
  import("./components/admin/SessionsSection").then((module) => ({
    default: module.SessionsSection,
  })),
);
const UsersSection = lazy(() =>
  import("./components/admin/UsersSection").then((module) => ({
    default: module.UsersSection,
  })),
);
const ProjectCapsSection = lazy(() =>
  import("./components/admin/ProjectCapsSection").then((module) => ({
    default: module.ProjectCapsSection,
  })),
);
const EmailLogSection = lazy(() =>
  import("./components/admin/EmailLogSection").then((module) => ({
    default: module.EmailLogSection,
  })),
);
const AuditLogSection = lazy(() =>
  import("./components/admin/AuditLogSection").then((module) => ({
    default: module.AuditLogSection,
  })),
);
const AnonSection = lazy(() =>
  import("./components/admin/AnonSection").then((module) => ({
    default: module.AnonSection,
  })),
);

// Dev-only /dev/content dashboard. Guarded by import.meta.env.DEV so the
// import (and its transitive deps) are stripped from prod bundles.
const ContentHealthPage = import.meta.env.DEV
  ? lazy(() => import("./__dev__/ContentHealthPage"))
  : null;

function Loading() {
  return (
    <div className="flex h-full items-center justify-center bg-bg text-muted">
      <span className="skeleton h-4 w-32 rounded" />
    </div>
  );
}

// Layout route wrapping RequireAuth + HydrationGate — both stay mounted
// across navigations so the AuthLoader doesn't re-run on every route
// change. No page-level transition animation: the shared bg-bg
// background bridges route changes naturally, and each page reveals
// itself via content-level stagger-ins on mount. That way the top
// chrome (headers, toolbars) doesn't warp during nav — only the
// content below it animates in.
//
// An earlier Cinema Kit pass tried wrapping Outlet in AnimatePresence
// with a pathname-keyed motion.div for a blur-resolve crossfade. The
// mount/unmount pattern meant the outgoing route's subtree stayed
// live during its exit animation — Monaco editors, running
// typewriters, and scripted streams all kept executing on the old
// LessonPage while the new one was mounting, producing visible
// "double-typing" and render flicker. The crossfade was rolled back.
// Route transitions at the framework level are the wrong layer for
// this product's cinematic grammar; the kit lives on compound
// moments (RingPulse on Run/Check) and return surfaces (FilmGrain
// on ResumeLearningCard, streak pill on CourseOverview) instead.
function AuthedLayout() {
  return (
    <RequireAuth>
      <HydrationGate>
        <FrozenAccountBanner />
        <Outlet />
        {/* Mounted alongside every authenticated route. Renders null
            unless the trigger rule in useWelcomeBack says fire — so
            deep links to lessons don't pay any render cost. The
            overlay is z:60 and covers the page during its 2.4 s
            cinematic before dismissing itself. */}
        <WelcomeBackOverlay />
      </HydrationGate>
    </RequireAuth>
  );
}

// Phase 22C: `/` ALWAYS renders the marketing page, regardless of auth
// state. This matches the Linear / Stripe / Vercel pattern — the
// marketing surface is part of the brand experience, not auth-gated.
// Logged-in users are signaled via the nav: the "Sign in" link in
// MarketingNav becomes "Dashboard" (→ /start) when a session is
// active. They retain the option to view the marketing page itself
// without being bounced.

export default function App() {
  // Direct full-app loads start auth in main.tsx. This second idempotent call
  // covers client navigation from the lightweight public shell into an auth,
  // anonymous lesson, or workspace route without waiting on its deferred
  // marketing bootstrap timer.
  useEffect(() => initAuth(), []);

  return (
    <Suspense fallback={<Loading />}>
      <StorageQuotaBanner />
      <GlobalShortcuts />
      <InviteCapture />
      <Routes>
        {/* Phase 22C: `/` is the public marketing page for everyone.
            No auth gate; logged-in users see the same page with a
            nav-level "Dashboard" affordance instead of "Sign in". */}
        <Route path="/" element={<MarketingPage />} />

        {/* Phase A — A7 (competitive-intel): public positioning page.
            Answers the honest "why not just ChatGPT?" question in the
            open, including where ChatGPT wins. */}
        <Route path="/why-not-chatgpt" element={<WhyNotChatGPTPage />} />
        <Route path="/privacy" element={<TrustPage />} />
        <Route path="/terms" element={<TrustPage />} />
        <Route path="/support" element={<TrustPage />} />

        {/* Public auth routes — no layout wrapper, no RequireAuth. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Phase 21C: public share route. No auth, no layout chrome —
            the cinematic page owns the full viewport. The 12-char token
            is server-generated; the SharePage component handles
            invalid-token / revoked / load-failed states. */}
        <Route path="/s/:token" element={<SharePage />} />

        {/* Phase 27 §3a: anonymous lesson 1 route. No auth, no layout
            chrome — the page handles its own header. Hard-locked to
            python-fundamentals/hello-world via an internal allowlist;
            any other (courseId, lessonId) redirects to /. Sits OUTSIDE
            the AuthedLayout block so RequireAuth never gates this
            path. */}
        <Route
          path="/try/lesson/:courseId/:lessonId"
          element={<AnonLessonPage />}
        />

        {/* Protected routes nested under AuthedLayout. RequireAuth +
            HydrationGate persist across navigations via this layout
            route; only the <Outlet /> content re-mounts. */}
        <Route element={<AuthedLayout />}>
          {/* Phase 22C: in-product home moved from `/` to `/start`. */}
          <Route path="/start" element={<StartPage />} />
          <Route path="/welcome" element={<FirstRunPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/learn" element={<LearningDashboardPage />} />
          <Route path="/learn/course/:courseId" element={<CourseOverviewPage />} />
          <Route path="/learn/course/:courseId/lesson/:lessonId" element={<LessonPage />} />
          {ContentHealthPage && (
            <Route path="/dev/content" element={<ContentHealthPage />} />
          )}
          {/* Phase 25: admin console at /admin/*. Nested routes for each
              section so links can be bookmarked/shared. RequireAdmin
              gates the whole subtree client-side; the backend's
              adminGuard middleware enforces server-side. */}
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          >
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<OverviewSection />} />
            <Route path="sessions" element={<SessionsSection />} />
            <Route path="users" element={<UsersSection />} />
            <Route path="project" element={<ProjectCapsSection />} />
            <Route path="email" element={<EmailLogSection />} />
            <Route path="audit" element={<AuditLogSection />} />
            <Route path="anon" element={<AnonSection />} />
          </Route>
          {/* Catch-all under the auth layout: send authed users to
              /start. Anonymous users get bounced to /login by RequireAuth
              before this rule matches. */}
          <Route path="*" element={<Navigate to="/start" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
