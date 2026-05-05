import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type SavedTutorMessage, type SavedTutorScope } from "../../../api/client";

// Phase 21A: per-scope saved-tutor-messages hook.
//
// Scope tuple semantics (mirror server):
//   (null, null, null)            — standalone /editor view
//   (course, lesson, null)        — lesson view (not practice)
//   (course, lesson, exercise)    — specific practice exercise
//
// No-flash load: a per-scope cache (`scopeCache`, module-scoped) keeps the
// most-recent successful fetch around so re-entering a previously-seen
// scope renders saved messages from first paint instead of a fade-in
// after the GET resolves. The accordion is "furniture already in the
// room"; the live history below is what fades in.
//
// Optimistic save: starring an in-history message immediately updates
// `savedIds` so the bookmark fills before the round-trip; failure
// reverts and surfaces an error.

interface ScopeCacheEntry {
  messages: SavedTutorMessage[];
  fetchedAt: number;
}

const scopeCache = new Map<string, ScopeCacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

export function __resetSavedScopeCacheForTests(): void {
  scopeCache.clear();
}

function scopeKey(s: SavedTutorScope): string {
  return `${s.courseId ?? ""}|${s.lessonId ?? ""}|${s.exerciseId ?? ""}`;
}

export interface SaveArgs {
  messageId: string;
  content: string;
  sections?: Record<string, unknown> | null;
  model?: string | null;
}

export interface UseSavedTutorMessagesResult {
  savedIds: Set<string>;
  savedMessages: SavedTutorMessage[];
  loading: boolean;
  error: string | null;
  save: (msg: SaveArgs) => Promise<void>;
  unsave: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Read+write hook for saved tutor messages, scoped by (courseId, lessonId,
 * exerciseId). Pass null in all three for the editor scope. The hook never
 * sets `loading = true` while a previous-scope's data is still rendering;
 * the new scope's data simply replaces the prior on resolve.
 *
 * Phase 27-v2.1: `mode === "anon"` short-circuits all reads and writes —
 * the underlying endpoints require an authenticated user, and an anon
 * caller should never trigger a 401 just by mounting GuidedTutorPanel.
 * Returns the same empty-but-callable shape; save/unsave become no-ops.
 */
export function useSavedTutorMessages(
  scope: SavedTutorScope,
  mode: "authed" | "anon" = "authed",
): UseSavedTutorMessagesResult {
  const isAnon = mode === "anon";
  const key = scopeKey(scope);
  const cached = isAnon ? undefined : scopeCache.get(key);

  // Seed from cache so first paint already has the rows. If the cache is
  // empty (first-ever entry into this scope), `savedMessages` starts as
  // []; the load fills it after the GET resolves. Either way the accordion
  // chrome can decide to render itself based on the array length.
  const [savedMessages, setSavedMessages] = useState<SavedTutorMessage[]>(
    cached?.messages ?? [],
  );
  const [loading, setLoading] = useState<boolean>(!cached);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref of the in-flight scope so a stale response from a prior
  // scope can be ignored if the user toggled to a new one mid-fetch.
  const activeKeyRef = useRef<string>(key);
  activeKeyRef.current = key;

  const refetch = useCallback(async () => {
    if (isAnon) return;
    const myKey = key;
    setError(null);
    if (!cached) setLoading(true);
    try {
      const r = await api.listSavedTutorMessages(scope);
      if (activeKeyRef.current !== myKey) return; // scope changed mid-flight
      scopeCache.set(myKey, { messages: r.messages, fetchedAt: Date.now() });
      setSavedMessages(r.messages);
    } catch (e) {
      if (activeKeyRef.current !== myKey) return;
      setError(e instanceof Error ? e.message : "Failed to load saved messages");
    } finally {
      if (activeKeyRef.current === myKey) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isAnon]);

  // Refetch when scope changes. Stale cache entries past TTL are still
  // shown immediately (no flash), but a refresh fires in the background.
  useEffect(() => {
    if (isAnon) return;
    setSavedMessages(scopeCache.get(key)?.messages ?? []);
    const c = scopeCache.get(key);
    const stale = !c || Date.now() - c.fetchedAt > CACHE_TTL_MS;
    if (stale) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isAnon]);

  const savedIds = useMemo(() => {
    return new Set(savedMessages.map((m) => m.messageId));
  }, [savedMessages]);

  const save = useCallback(
    async (msg: SaveArgs) => {
      if (isAnon) return;
      // Optimistic: insert a placeholder row with a generated client id so
      // the bookmark fills immediately. Replace with the server row on
      // resolve; revert on failure.
      const optimistic: SavedTutorMessage = {
        id: `optimistic-${msg.messageId}`,
        courseId: scope.courseId,
        lessonId: scope.lessonId,
        exerciseId: scope.exerciseId,
        messageId: msg.messageId,
        role: "assistant",
        content: msg.content,
        sections: msg.sections ?? null,
        model: msg.model ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSavedMessages((prev) =>
        prev.some((m) => m.messageId === msg.messageId) ? prev : [optimistic, ...prev],
      );
      try {
        const r = await api.saveTutorMessage({
          messageId: msg.messageId,
          courseId: scope.courseId,
          lessonId: scope.lessonId,
          exerciseId: scope.exerciseId,
          content: msg.content,
          sections: msg.sections ?? null,
          model: msg.model ?? null,
        });
        setSavedMessages((prev) => {
          const next = prev.map((m) => (m.messageId === msg.messageId ? r.saved : m));
          // Refresh the cache so the next mount of this scope shows the
          // server-blessed row, not the optimistic placeholder.
          scopeCache.set(key, { messages: next, fetchedAt: Date.now() });
          return next;
        });
      } catch (e) {
        // Revert optimistic insert.
        setSavedMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(e instanceof Error ? e.message : "Failed to save");
        throw e;
      }
    },
    [key, scope.courseId, scope.lessonId, scope.exerciseId, isAnon],
  );

  const unsave = useCallback(
    async (id: string) => {
      if (isAnon) return;
      const prev = savedMessages;
      const next = prev.filter((m) => m.id !== id);
      setSavedMessages(next);
      scopeCache.set(key, { messages: next, fetchedAt: Date.now() });
      try {
        await api.deleteSavedTutorMessage(id);
      } catch (e) {
        setSavedMessages(prev);
        scopeCache.set(key, { messages: prev, fetchedAt: Date.now() });
        setError(e instanceof Error ? e.message : "Failed to remove");
        throw e;
      }
    },
    [savedMessages, key, isAnon],
  );

  return { savedIds, savedMessages, loading, error, save, unsave, refetch };
}
