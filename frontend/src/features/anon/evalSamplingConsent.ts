export const EVAL_SAMPLING_CONSENT_VERSION = 1 as const;
export const EVAL_SAMPLING_STORAGE_KEY = "codetutor.aiEvalSamplingConsent.v1";

export interface StoredEvalSamplingConsent {
  version: typeof EVAL_SAMPLING_CONSENT_VERSION;
  subjectToken: string;
  enabled: boolean;
  deletionPending: boolean;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createEvalSamplingSubjectToken(
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    globalThis.crypto.getRandomValues(bytes),
): string {
  const bytes = fillRandom(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function readStoredEvalSamplingConsent(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): StoredEvalSamplingConsent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EVAL_SAMPLING_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredEvalSamplingConsent>;
    if (
      value.version !== EVAL_SAMPLING_CONSENT_VERSION ||
      typeof value.subjectToken !== "string" ||
      !TOKEN_RE.test(value.subjectToken) ||
      typeof value.enabled !== "boolean" ||
      typeof value.deletionPending !== "boolean"
    ) {
      return null;
    }
    return value as StoredEvalSamplingConsent;
  } catch {
    return null;
  }
}

function writeStoredEvalSamplingConsent(
  value: StoredEvalSamplingConsent,
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): StoredEvalSamplingConsent | null {
  if (!storage) return null;
  try {
    storage.setItem(EVAL_SAMPLING_STORAGE_KEY, JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
}

export function enableEvalSampling(
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage(),
  createToken: () => string = createEvalSamplingSubjectToken,
): StoredEvalSamplingConsent | null {
  const existing = readStoredEvalSamplingConsent(storage);
  return writeStoredEvalSamplingConsent(
    {
      version: EVAL_SAMPLING_CONSENT_VERSION,
      subjectToken: existing?.subjectToken ?? createToken(),
      enabled: true,
      deletionPending: false,
    },
    storage,
  );
}

export function markEvalSamplingDeletionPending(
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage(),
): StoredEvalSamplingConsent | null {
  const existing = readStoredEvalSamplingConsent(storage);
  if (!existing) return null;
  return writeStoredEvalSamplingConsent(
    { ...existing, enabled: false, deletionPending: true },
    storage,
  );
}

export function clearStoredEvalSamplingConsent(
  storage: Pick<Storage, "removeItem"> | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(EVAL_SAMPLING_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function evalSamplingConsentForRequest(): {
  version: typeof EVAL_SAMPLING_CONSENT_VERSION;
  subjectToken: string;
} | undefined {
  const stored = readStoredEvalSamplingConsent();
  if (!stored?.enabled || stored.deletionPending) return undefined;
  return {
    version: stored.version,
    subjectToken: stored.subjectToken,
  };
}

/** Include pending-deletion tokens so account handoff still establishes the
 * cascade relationship if the anonymous delete request was interrupted. */
export function evalSamplingSubjectTokenForHandoff(): string | undefined {
  return readStoredEvalSamplingConsent()?.subjectToken;
}
