import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { StorageQuotaBanner } from "./components/StorageQuotaBanner";

const StartPage = lazy(() => import("./pages/StartPage"));
const EditorPage = lazy(() => import("./pages/EditorPage"));
const LearningDashboardPage = lazy(() => import("./features/learning/pages/LearningDashboardPage"));
const CourseOverviewPage = lazy(() => import("./features/learning/pages/CourseOverviewPage"));
const LessonPage = lazy(() => import("./features/learning/pages/LessonPage"));

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
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/learn" element={<LearningDashboardPage />} />
        <Route path="/learn/course/:courseId" element={<CourseOverviewPage />} />
        <Route path="/learn/course/:courseId/lesson/:lessonId" element={<LessonPage />} />
        {ContentHealthPage && (
          <Route path="/dev/content" element={<ContentHealthPage />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
