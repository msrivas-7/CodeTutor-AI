import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion"; // still used on the landing cards
import { WelcomeOverlay } from "../components/WelcomeOverlay";
import { UserMenu } from "../components/UserMenu";
import { FeedbackButton } from "../components/FeedbackButton";
import { AmbientGlyphField } from "../components/AmbientGlyphField";
import { StaggerReveal, StaggerItem } from "../components/StaggerReveal";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProgressStore } from "../features/learning/stores/progressStore";
import { listPublicCourses, loadAllLessonMetas } from "../features/learning/content/courseLoader";
import { ResumeLearningCard } from "../features/learning/components/ResumeLearningCard";
import type { Course, CourseProgress, LessonMeta } from "../features/learning/types";

interface ResumeTarget {
  course: Course;
  progress: CourseProgress;
  nextLesson: LessonMeta | null;
}

export default function StartPage() {
  const nav = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const welcomeDone = usePreferencesStore((s) => s.welcomeDone);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);

  useEffect(() => {
    if (!welcomeDone) {
      const t = setTimeout(() => setShowWelcome(true), 300);
      return () => clearTimeout(t);
    }
  }, [welcomeDone]);
  const headerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLButtonElement>(null);
  const guidedRef = useRef<HTMLButtonElement>(null);

  // Pick the most-recently-updated, not-yet-completed course id from the
  // already-hydrated progress store. HydrationGate guarantees this map is
  // populated before StartPage renders. Completed courses fall through so
  // returning learners who just finished Python still get the cold 2-card
  // grid rather than a redundant "Resume Python" where everything is done.
  const resumeCourseId = useMemo(() => {
    let bestId: string | null = null;
    let bestTs = 0;
    for (const [id, p] of Object.entries(courseProgressMap)) {
      if (!p || p.status === "completed" || !p.updatedAt) continue;
      const t = new Date(p.updatedAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (t > bestTs) {
        bestTs = t;
        bestId = id;
      }
    }
    return bestId;
  }, [courseProgressMap]);

  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);
  useEffect(() => {
    if (!resumeCourseId) {
      setResumeTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [courses, lessons] = await Promise.all([
          listPublicCourses(),
          loadAllLessonMetas(resumeCourseId),
        ]);
        if (cancelled) return;
        const course = courses.find((c) => c.id === resumeCourseId);
        const progress = courseProgressMap[resumeCourseId];
        if (!course || !progress) {
          setResumeTarget(null);
          return;
        }
        const nextLesson =
          lessons.find((l) => !progress.completedLessonIds.includes(l.id)) ??
          null;
        setResumeTarget({ course, progress, nextLesson });
      } catch {
        if (!cancelled) setResumeTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeCourseId, courseProgressMap]);

  return (
    <div className="relative flex h-full flex-col bg-bg text-ink">
      <AmbientGlyphField />
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
        <FeedbackButton />
        <UserMenu />
      </div>
      <StaggerReveal className="flex flex-1 flex-col items-center justify-center px-6">
        <StaggerItem>
          <div ref={headerRef} className="mb-10 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet text-lg font-bold text-bg shadow-glow">
              AI
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CodeTutor AI</h1>
            <p className="max-w-md text-center text-sm text-muted">
              Write code, run it in a sandbox, and learn with an AI tutor —
              all in the browser.
            </p>
          </div>
        </StaggerItem>

        {resumeTarget && resumeTarget.nextLesson && (
          <StaggerItem className="mb-6 w-full max-w-2xl">
            <ResumeLearningCard
              courseTitle={resumeTarget.course.title}
              progress={resumeTarget.progress}
              nextLesson={resumeTarget.nextLesson}
              onResume={() =>
                nav(
                  `/learn/course/${resumeTarget.course.id}/lesson/${resumeTarget.nextLesson!.id}`,
                )
              }
            />
          </StaggerItem>
        )}

        <StaggerItem className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <motion.button
            ref={editorRef}
            onClick={() => nav("/editor")}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent transition group-hover:bg-accent/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Open Editor</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Free-form coding workspace with 9 languages, sandboxed
                execution, and AI-powered help.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-accent transition sm:opacity-0 sm:group-hover:opacity-100">
              Launch editor →
            </span>
          </motion.button>

          <motion.button
            ref={guidedRef}
            onClick={() => nav("/learn")}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-violet/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/10 text-violet transition group-hover:bg-violet/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Guided Course</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Structured Python and JavaScript lessons for beginners. Track
                your progress and get lesson-aware AI guidance.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-violet transition sm:opacity-0 sm:group-hover:opacity-100">
              Start learning →
            </span>
          </motion.button>
        </StaggerItem>
      </StaggerReveal>

      <footer className="border-t border-border bg-panel/60 px-4 py-2 text-center text-[10px] text-faint">
        CodeTutor AI © 2026 Mehul Srivastava — All rights reserved
      </footer>

      {showWelcome && (
        <WelcomeOverlay
          refs={{ header: headerRef.current, editorCard: editorRef.current, guidedCard: guidedRef.current }}
          onDismiss={() => setShowWelcome(false)}
        />
      )}
    </div>
  );
}
