import { motion } from "framer-motion";
import type { Course, CourseProgress } from "../types";

interface CourseCardProps {
  course: Course;
  progress: CourseProgress | null;
  lessonCount: number;
  onOpen: () => void;
}

export function CourseCard({ course, progress, lessonCount, onOpen }: CourseCardProps) {
  const completedCount = progress?.completedLessonIds.length ?? 0;
  const pct = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0;
  const status = progress?.status ?? "not_started";

  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ y: -6, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left transition-[border-color,box-shadow] hover:border-violet/50 hover:shadow-glow"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/10 text-violet transition group-hover:bg-violet/20">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>

      <div className="w-full">
        <h3 className="text-base font-semibold">{course.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{course.description}</p>
      </div>

      <div className="mt-auto flex w-full items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-violet transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-medium text-muted">
          {completedCount}/{lessonCount}
        </span>
      </div>

      <span className="text-[11px] font-medium text-violet transition sm:opacity-0 sm:group-hover:opacity-100">
        {status === "not_started" ? "Start course →" : status === "completed" ? "Review →" : "Continue →"}
      </span>
    </motion.button>
  );
}
