import { create } from "zustand";

// Tiny banner-state store for surfacing localStorage failures. When a
// `localStorage.setItem` call throws QuotaExceededError (quota hit, private
// window in Safari, etc.), progress is silently lost on refresh — which is a
// much worse failure than a visible warning. The banner component reads this
// store and shows a dismissible notice so the learner knows something is up.
interface StorageState {
  quotaExceeded: boolean;
  noteQuotaExceeded: () => void;
  dismiss: () => void;
}

export const useStorageStore = create<StorageState>((set) => ({
  quotaExceeded: false,
  noteQuotaExceeded: () => set({ quotaExceeded: true }),
  dismiss: () => set({ quotaExceeded: false }),
}));

// Non-React entry point so util code (saveJson in progressStore, layoutPrefs,
// etc.) can flip the flag without having to import a React hook.
export function noteStorageQuotaError(err: unknown): void {
  // Name sniff is more reliable than instanceof across browsers + Jest.
  const name = err instanceof Error ? err.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    useStorageStore.getState().noteQuotaExceeded();
  }
}
