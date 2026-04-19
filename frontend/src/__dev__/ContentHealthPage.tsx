// Dev-only content health dashboard.
//
// Gated on import.meta.env.DEV. Mounted at /dev/content when enabled.
//
// For every lesson in every course discovered via /courses/<id>/course.json,
// surfaces the signals an author needs to see at a glance:
//   - order / minutes
//   - completion-rule mix
//   - teaches vs. uses concept counts
//   - whether a golden solution is reachable under public/
//   - concept-graph warnings for that lesson (duplicate-teach, missing, overlap)
//
// Data is fetched at runtime from the same static files the app already
// serves — no backend needed. This page is stripped from production bundles
// by Vite dead-code elimination on the import.meta.env.DEV guard.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Course, LessonMeta, CompletionRule } from "../features/learning/types";
import {
  buildConceptGraph,
  type ConceptGraphIssue,
} from "../features/learning/content/conceptGraph";
import { listAllCourses } from "../features/learning/content/courseLoader";
import { LANGUAGE_ENTRYPOINT, LANGUAGE_LABEL } from "../types";

interface LessonHealth {
  meta: LessonMeta;
  hasSolution: boolean;
  hasContent: boolean;
  issues: ConceptGraphIssue[];
}

interface CourseHealth {
  course: Course;
  lessons: LessonHealth[];
  loadErrors: string[];
}

async function fetchLesson(
  courseId: string,
  lessonId: string,
): Promise<LessonMeta | null> {
  const r = await fetch(`/courses/${courseId}/lessons/${lessonId}/lesson.json`);
  if (!r.ok) return null;
  return r.json();
}

async function hasFile(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return false;
    // The dev server serves index.html for missing paths — guard against that.
    const text = (await r.text()).trimStart();
    return text.length > 0 && !text.startsWith("<!");
  } catch {
    return false;
  }
}

async function loadHealth(course: Course): Promise<CourseHealth> {
  const loadErrors: string[] = [];
  const metas: LessonMeta[] = [];
  for (const lessonId of course.lessonOrder) {
    const meta = await fetchLesson(course.id, lessonId);
    if (!meta) {
      loadErrors.push(`lesson.json missing: ${lessonId}`);
      continue;
    }
    metas.push(meta);
  }

  const graphInput = new Map<string, LessonMeta>();
  for (const m of metas) graphInput.set(m.id, m);
  const graph = buildConceptGraph(course, graphInput);
  const issuesByLesson = new Map<string, ConceptGraphIssue[]>();
  for (const issue of graph.issues) {
    const arr = issuesByLesson.get(issue.lessonId) ?? [];
    arr.push(issue);
    issuesByLesson.set(issue.lessonId, arr);
  }

  const lessons: LessonHealth[] = await Promise.all(
    metas.map(async (meta) => {
      const entry = LANGUAGE_ENTRYPOINT[meta.language];
      const [hasSolution, hasContent] = await Promise.all([
        hasFile(`/courses/${course.id}/lessons/${meta.id}/solution/${entry}`),
        hasFile(`/courses/${course.id}/lessons/${meta.id}/content.md`),
      ]);
      return {
        meta,
        hasSolution,
        hasContent,
        issues: issuesByLesson.get(meta.id) ?? [],
      };
    }),
  );

  return { course, lessons, loadErrors };
}

function ruleSummary(rules: CompletionRule[]): string {
  const counts = new Map<string, number>();
  for (const r of rules) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, v]) => (v > 1 ? `${k}×${v}` : k))
    .join(" + ");
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-success/10 text-success"
      : tone === "warn"
        ? "bg-warn/15 text-warn"
        : "bg-danger/10 text-danger";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export default function ContentHealthPage() {
  const [courses, setCourses] = useState<CourseHealth[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = await listAllCourses();
        const results = await Promise.all(all.map(loadHealth));
        setCourses(results);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    if (!courses) return null;
    let lessons = 0;
    let solutions = 0;
    let issues = 0;
    for (const c of courses) {
      lessons += c.lessons.length;
      solutions += c.lessons.filter((l) => l.hasSolution).length;
      issues += c.lessons.reduce((n, l) => n + l.issues.length, 0);
    }
    return { lessons, solutions, issues };
  }, [courses]);

  return (
    <div className="min-h-full bg-bg px-6 py-6 text-sm text-ink">
      <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Content health</h1>
          <p className="text-xs text-muted">
            Dev-only view. Read-only; does not ship to production.
          </p>
        </div>
        <Link
          to="/learn"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-ink"
        >
          ← Back to Learning
        </Link>
      </header>

      {loading && <div className="text-muted">Loading content…</div>}
      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          Failed to load content health: {error}
        </div>
      )}

      {courses && totals && (
        <div className="mb-4 flex gap-3 text-xs text-muted">
          <span>
            <strong className="text-ink">{totals.lessons}</strong> lesson(s)
          </span>
          <span>
            <strong className="text-ink">{totals.solutions}</strong> with golden solution
          </span>
          <span>
            <strong className="text-ink">{totals.issues}</strong> concept-graph issue(s)
          </span>
        </div>
      )}

      {courses?.map((c) => (
        <section key={c.course.id} className="mb-8">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <span>{c.course.title}</span>
            {c.course.internal && <Pill tone="warn">internal</Pill>}
          </h2>
          {c.loadErrors.length > 0 && (
            <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
              {c.loadErrors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-elevated text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Lesson</th>
                  <th className="px-3 py-2 font-medium">Language</th>
                  <th className="px-3 py-2 font-medium">Min</th>
                  <th className="px-3 py-2 font-medium">Rules</th>
                  <th className="px-3 py-2 font-medium">Teaches</th>
                  <th className="px-3 py-2 font-medium">Uses</th>
                  <th className="px-3 py-2 font-medium">Content</th>
                  <th className="px-3 py-2 font-medium">Solution</th>
                  <th className="px-3 py-2 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {c.lessons.map((l) => (
                  <tr key={l.meta.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-muted">{l.meta.order}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{l.meta.title}</div>
                      <div className="text-[10px] text-muted">{l.meta.id}</div>
                    </td>
                    <td className="px-3 py-2 text-muted">{LANGUAGE_LABEL[l.meta.language]}</td>
                    <td className="px-3 py-2 text-muted">{l.meta.estimatedMinutes}</td>
                    <td className="px-3 py-2 text-muted">
                      {ruleSummary(l.meta.completionRules)}
                    </td>
                    <td className="px-3 py-2">
                      {l.meta.teachesConceptTags.length === 0 ? (
                        <Pill tone="warn">none</Pill>
                      ) : (
                        <span className="text-muted">
                          {l.meta.teachesConceptTags.length}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {l.meta.usesConceptTags.length}
                    </td>
                    <td className="px-3 py-2">
                      {l.hasContent ? (
                        <Pill tone="ok">ok</Pill>
                      ) : (
                        <Pill tone="error">missing</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {l.hasSolution ? (
                        <Pill tone="ok">present</Pill>
                      ) : (
                        <Pill tone="error">missing</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {l.issues.length === 0 ? (
                        <Pill tone="ok">clean</Pill>
                      ) : (
                        <div className="space-y-0.5">
                          {l.issues.map((issue, i) => (
                            <div
                              key={i}
                              className="text-[10px] text-warn"
                              title={issue.message}
                            >
                              {issue.kind}: {issue.tag}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}
