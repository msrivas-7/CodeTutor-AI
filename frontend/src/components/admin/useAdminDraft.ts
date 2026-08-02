import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

const PREFIX = "codetutor.admin.draft.v1.";

/**
 * Keeps unfinished operator input in the current browser tab. Drafts never
 * cross tabs or devices, and callers explicitly clear them after a successful
 * mutation or an intentional discard.
 */
export function useAdminDraft<T>(key: string, initial: T) {
  const storageKey = `${PREFIX}${key}`;
  const restoredRef = useRef(false);
  const dirtyRef = useRef(false);
  const [draft, setDraftState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return initial;
      restoredRef.current = true;
      dirtyRef.current = true;
      return JSON.parse(raw) as T;
    } catch {
      window.sessionStorage.removeItem(storageKey);
      return initial;
    }
  });
  const [hasDraft, setHasDraft] = useState(restoredRef.current);

  useEffect(() => {
    if (dirtyRef.current) {
      window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    }
  }, [draft, storageKey]);

  const setDraft: Dispatch<SetStateAction<T>> = useCallback((next) => {
    dirtyRef.current = true;
    setHasDraft(true);
    setDraftState(next);
  }, []);

  const clear = useCallback(() => {
    window.sessionStorage.removeItem(storageKey);
    restoredRef.current = false;
    dirtyRef.current = false;
    setHasDraft(false);
    setDraftState(initial);
  }, [initial, storageKey]);

  return { draft, setDraft, clear, hasDraft, restored: restoredRef.current };
}
