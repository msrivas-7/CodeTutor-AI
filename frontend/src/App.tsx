import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { StorageQuotaBanner } from "./components/StorageQuotaBanner";
import { FeedbackButton } from "./components/FeedbackButton";
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

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <StorageQuotaBanner />
      <FeedbackButton />
      <Routes>
        {/* Public auth routes. RequireAuth itself redirects here when
            an unauthenticated user tries to access a protected route. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Protected routes. RequireAuth redirects if signed out; HydrationGate
            then blocks render until preferences + progress have loaded from
            the server so components don't flash defaults for a frame. */}
        <Route path="/" element={<RequireAuth><HydrationGate><StartPage /></HydrationGate></RequireAuth>} />
        <Route path="/editor" element={<RequireAuth><HydrationGate><EditorPage /></HydrationGate></RequireAuth>} />
        <Route path="/learn" element={<RequireAuth><HydrationGate><LearningDashboardPage /></HydrationGate></RequireAuth>} />
        <Route path="/learn/course/:courseId" element={<RequireAuth><HydrationGate><CourseOverviewPage /></HydrationGate></RequireAuth>} />
        <Route path="/learn/course/:courseId/lesson/:lessonId" element={<RequireAuth><HydrationGate><LessonPage /></HydrationGate></RequireAuth>} />
        {ContentHealthPage && (
          <Route path="/dev/content" element={<RequireAuth><HydrationGate><ContentHealthPage /></HydrationGate></RequireAuth>} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
