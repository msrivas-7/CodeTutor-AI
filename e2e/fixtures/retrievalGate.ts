import type { Page } from "@playwright/test";
import { getWorkerUser } from "./auth";

// Phase A — A1/A7: helpers for the retrieval-check gate's persistence key.
//
// The key is scoped to the LEARNER, not just (course, lesson). Keyed on the
// pair alone, one person answering the check on a shared browser would
// satisfy the gate for every later account and every anonymous visitor on
// that device — skipping the pedagogy beat and inflating the Phase A Q2
// exit metric with passes nobody earned.
//
// Storage differs by path, and that difference is deliberate:
//   authed → localStorage, scoped by userId. A returning learner shouldn't
//            re-prove a check they already passed.
//   anon   → sessionStorage, scoped by the literal "anon". Anonymous
//            visitors share no stable identity, so a session boundary is
//            the only honest isolation available; the next person on the
//            device answers it themselves.
//
// Anon specs seed the key inline next to their sibling sessionStorage
// flags (it's a static string). The authed helper lives here because the
// key embeds the worker's user id, which only the auth fixture knows.

export function retrievalKey(
  scope: string,
  courseId: string,
  lessonId: string,
): string {
  return `ui:lesson:retrievalPassed:${scope}:${courseId}:${lessonId}`;
}

/**
 * Seed a passed retrieval check for the AUTHED path (localStorage, keyed
 * by the worker's user id). Must be called with the same workerIndex the
 * auth fixture logged in as, or the key won't match what LessonPage reads.
 */
export async function seedAuthedRetrievalPass(
  page: Page,
  workerIndex: number,
  courseId = "python-fundamentals",
  lessonId = "hello-world",
): Promise<void> {
  const { userId } = await getWorkerUser(workerIndex);
  const key = retrievalKey(userId, courseId, lessonId);
  await page.addInitScript((k) => {
    window.localStorage.setItem(k as string, "1");
  }, key);
}
