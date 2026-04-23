import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";
import { StorageQuotaBanner } from "./components/StorageQuotaBanner";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { RequireAuth } from "./auth/RequireAuth";
import { HydrationGate } from "./auth/HydrationGate";

const StartPage = lazy(() => import("./pages/StartPage"));
const EditorPage = lazy(() => import("./pages/EditorPage"));
const LearningDashboardPage = lazy(() => import("./features/learning/pages/LearningDashboardPage"));
const CourseOverviewPage = lazy(() => import("./features/learning/pages/CourseOverviewPage"));
const LessonPage = lazy(() => import("./features/learning/pages/LessonPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));

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
function AuthedLayout() {
  return (
    <RequireAuth>
      <HydrationGate>
        <Outlet />
      </HydrationGate>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <StorageQuotaBanner />
      <GlobalShortcuts />
      <Routes>
        {/* Public auth routes — no layout wrapper, no RequireAuth. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Protected routes nested under AuthedLayout. RequireAuth +
            HydrationGate persist across navigations via this layout
            route; only the <Outlet /> content re-mounts (with animated
            enter/exit transitions). */}
        <Route element={<AuthedLayout />}>
          <Route path="/" element={<StartPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/learn" element={<LearningDashboardPage />} />
          <Route path="/learn/course/:courseId" element={<CourseOverviewPage />} />
          <Route path="/learn/course/:courseId/lesson/:lessonId" element={<LessonPage />} />
          {ContentHealthPage && (
            <Route path="/dev/content" element={<ContentHealthPage />} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
