import { describe, expect, it } from "vitest";
import {
  EVAL_SAMPLING_STORAGE_KEY,
  clearStoredEvalSamplingConsent,
  createEvalSamplingSubjectToken,
  enableEvalSampling,
  markEvalSamplingDeletionPending,
  readStoredEvalSamplingConsent,
} from "./evalSamplingConsent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("anonymous eval sampling consent", () => {
  it("creates a canonical 256-bit base64url token", () => {
    const token = createEvalSamplingSubjectToken((bytes) => {
      bytes.fill(255);
      return bytes;
    });
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is off by default and persists only after explicit enable", () => {
    const storage = memoryStorage();
    expect(readStoredEvalSamplingConsent(storage)).toBeNull();
    const enabled = enableEvalSampling(storage, () => "a".repeat(43));
    expect(enabled).toEqual({
      version: 1,
      subjectToken: "a".repeat(43),
      enabled: true,
      deletionPending: false,
    });
    expect(storage.getItem(EVAL_SAMPLING_STORAGE_KEY)).not.toBeNull();
  });

  it("turns sharing off before deletion completes and retains retry authority", () => {
    const storage = memoryStorage();
    enableEvalSampling(storage, () => "b".repeat(43));
    const pending = markEvalSamplingDeletionPending(storage);
    expect(pending?.enabled).toBe(false);
    expect(pending?.deletionPending).toBe(true);
    expect(pending?.subjectToken).toBe("b".repeat(43));
    expect(clearStoredEvalSamplingConsent(storage)).toBe(true);
    expect(readStoredEvalSamplingConsent(storage)).toBeNull();
  });

  it("rejects malformed or stale storage", () => {
    const storage = memoryStorage();
    storage.setItem(EVAL_SAMPLING_STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(readStoredEvalSamplingConsent(storage)).toBeNull();
  });
});
