import { createHmac, timingSafeEqual } from "node:crypto";

export const SHARE_PREVIEW_AUTH_VERSION = "codetutor-share-preview-v1";
export const SHARE_PREVIEW_AUTH_HEADERS = {
  keyId: "x-codetutor-preview-key-id",
  timestamp: "x-codetutor-preview-timestamp",
  nonce: "x-codetutor-preview-nonce",
  signature: "x-codetutor-preview-signature",
} as const;

export interface SharePreviewAuthKey {
  id: string;
  /** Exactly 32 random bytes, encoded with standard base64. */
  secret: string;
}

export interface SharePreviewAuthInput {
  method: string;
  canonicalPath: string;
  headers: Record<string, string | undefined>;
}

export type SharePreviewAuthFailure =
  | "malformed"
  | "bad_signature"
  | "stale"
  | "replayed";

export type SharePreviewAuthResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: SharePreviewAuthFailure };

const KEY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const TIMESTAMP_RE = /^\d{10}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_BYTES = 32;

export function canonicalSharePreviewRequest(input: {
  method: string;
  canonicalPath: string;
  timestamp: string;
  nonce: string;
  keyId: string;
}): string {
  return [
    SHARE_PREVIEW_AUTH_VERSION,
    input.method.toUpperCase(),
    input.canonicalPath,
    input.timestamp,
    input.nonce,
    input.keyId,
  ].join("\n");
}

function decodeSecret(secret: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
    throw new Error("share-preview HMAC secret must be canonical base64");
  }
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `share-preview HMAC secret must decode to exactly 32 bytes (got ${decoded.length})`,
    );
  }
  return decoded;
}

export function signSharePreviewRequest(input: {
  method: string;
  canonicalPath: string;
  timestamp: string;
  nonce: string;
  keyId: string;
  secret: string;
}): string {
  return createHmac("sha256", decodeSecret(input.secret))
    .update(canonicalSharePreviewRequest(input), "utf8")
    .digest("base64url");
}

export function createSharePreviewAuthenticator(options: {
  keys: readonly SharePreviewAuthKey[];
  now?: () => number;
  maxSkewMs?: number;
  nonceCacheMax?: number;
}) {
  const now = options.now ?? Date.now;
  const maxSkewMs = options.maxSkewMs ?? 30_000;
  const nonceCacheMax = options.nonceCacheMax ?? 10_000;
  if (!Number.isFinite(maxSkewMs) || maxSkewMs <= 0) {
    throw new Error("share-preview maxSkewMs must be positive");
  }
  if (!Number.isInteger(nonceCacheMax) || nonceCacheMax <= 0) {
    throw new Error("share-preview nonceCacheMax must be a positive integer");
  }

  const keys = new Map<string, Buffer>();
  for (const key of options.keys) {
    if (!KEY_ID_RE.test(key.id)) {
      throw new Error(`invalid share-preview key id: ${key.id}`);
    }
    if (keys.has(key.id)) {
      throw new Error(`duplicate share-preview key id: ${key.id}`);
    }
    keys.set(key.id, decodeSecret(key.secret));
  }

  // A per-process replay cache is sufficient for today's single backend
  // replica. The ADR explicitly requires a shared nonce store before this
  // route can be scaled to multiple active replicas.
  const seenNonces = new Map<string, number>();
  const dummyKey = Buffer.alloc(32);

  function pruneNonces(at: number): void {
    for (const [key, expiresAt] of seenNonces) {
      if (expiresAt < at) seenNonces.delete(key);
    }
    if (seenNonces.size < nonceCacheMax) return;
    const target = Math.max(1, Math.ceil(nonceCacheMax / 10));
    let removed = 0;
    for (const key of seenNonces.keys()) {
      seenNonces.delete(key);
      removed += 1;
      if (removed >= target) break;
    }
  }

  return {
    configured: keys.size > 0,
    verify(input: SharePreviewAuthInput): SharePreviewAuthResult {
      const keyId = input.headers[SHARE_PREVIEW_AUTH_HEADERS.keyId] ?? "";
      const timestamp =
        input.headers[SHARE_PREVIEW_AUTH_HEADERS.timestamp] ?? "";
      const nonce = input.headers[SHARE_PREVIEW_AUTH_HEADERS.nonce] ?? "";
      const signature =
        input.headers[SHARE_PREVIEW_AUTH_HEADERS.signature] ?? "";

      const shapeValid =
        input.method.toUpperCase() === "GET" &&
        KEY_ID_RE.test(keyId) &&
        TIMESTAMP_RE.test(timestamp) &&
        NONCE_RE.test(nonce) &&
        SIGNATURE_RE.test(signature);

      // Always calculate and compare one HMAC, including for unknown keys or
      // malformed signatures. This keeps the privileged endpoint from
      // becoming a useful key-id or signature-shape timing oracle.
      const expected = createHmac("sha256", keys.get(keyId) ?? dummyKey)
        .update(
          canonicalSharePreviewRequest({
            method: input.method,
            canonicalPath: input.canonicalPath,
            timestamp,
            nonce,
            keyId,
          }),
          "utf8",
        )
        .digest();
      let candidate = Buffer.alloc(SIGNATURE_BYTES);
      if (SIGNATURE_RE.test(signature)) {
        const decoded = Buffer.from(signature, "base64url");
        if (decoded.length === SIGNATURE_BYTES) candidate = decoded;
      }
      const signatureMatches = timingSafeEqual(expected, candidate);

      if (!shapeValid) return { ok: false, reason: "malformed" };
      if (!keys.has(keyId) || !signatureMatches) {
        return { ok: false, reason: "bad_signature" };
      }

      const at = now();
      const requestedAt = Number(timestamp) * 1000;
      if (!Number.isSafeInteger(requestedAt) || Math.abs(at - requestedAt) > maxSkewMs) {
        return { ok: false, reason: "stale" };
      }

      pruneNonces(at);
      const replayKey = `${keyId}:${nonce}`;
      const replayExpiry = seenNonces.get(replayKey);
      if (replayExpiry !== undefined && replayExpiry >= at) {
        return { ok: false, reason: "replayed" };
      }
      // Retain the nonce through the signed request's exact inclusive validity
      // boundary. A future-dated request can otherwise outlive a cache entry
      // based only on when this process first observed it.
      seenNonces.set(replayKey, requestedAt + maxSkewMs);
      return { ok: true, keyId };
    },
  };
}
