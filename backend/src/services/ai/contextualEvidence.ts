import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";
import { hasUniqueProjectFilePaths } from "../../schema/projectFiles.js";
import type { ProjectFile, RunResult } from "./provider.js";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 15 * 60 * 1_000;
const SIGNING_DOMAIN = "codetutor:contextual-evidence:v1";
const EPISODE_CLAIM_DOMAIN = "codetutor:contextual-episode-claim:v1";

export interface ContextualRunIdentity {
  courseId: string;
  lessonId: string;
  contextEpoch: string;
  projectRevision: number;
}

interface EvidencePayload extends ContextualRunIdentity {
  v: 1;
  k: number;
  actor: string;
  files: string;
  result: string;
  episode: string;
  exp: number;
}

export interface ContextualEvidenceKeyring {
  currentVersion: number;
  keys: ReadonlyMap<number, string>;
}

export interface EvidenceOptions {
  nowMs?: number;
  keyring?: ContextualEvidenceKeyring;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

/** Stable hex claim key; the raw signed token is never persisted. */
export function digestContextualEvidenceToken(token: string): string {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) {
    throw new Error("invalid contextual evidence token");
  }
  // Hash the signed bytes, not their textual base64url representation. Node's
  // decoder intentionally accepts padded and whitespace-bearing aliases; the
  // database replay claim must collapse every such alias to one identity.
  return createHash("sha256")
    .update(Buffer.from(encoded, "base64url"))
    .update(Buffer.from([0]))
    .update(Buffer.from(signature, "base64url"))
    .digest("hex");
}

/**
 * Stable database claim for the server-signed error episode. Unlike a token
 * digest, this identity is shared by every receipt minted for the same actor,
 * canonical lesson, and normalized server error. Client-owned epoch/revision
 * fields are validated but deliberately excluded from replay identity, so
 * changing them cannot manufacture a fresh spending boundary.
 */
export function digestContextualEvidenceEpisode(
  token: string,
  actorId: string,
  identity: ContextualRunIdentity,
  options: EvidenceOptions = {},
): string | null {
  const payload = readVerifiedEvidencePayload(token, options);
  if (
    !payload ||
    payload.actor !== digest(actorId) ||
    payload.courseId !== identity.courseId ||
    payload.lessonId !== identity.lessonId ||
    payload.contextEpoch !== identity.contextEpoch ||
    payload.projectRevision !== identity.projectRevision
  ) return null;
  return createHash("sha256").update(JSON.stringify({
    domain: EPISODE_CLAIM_DOMAIN,
    actor: payload.actor,
    courseId: payload.courseId,
    lessonId: payload.lessonId,
    episode: payload.episode,
  }), "utf8").digest("hex");
}

export function digestProjectFiles(files: readonly ProjectFile[]): string {
  return digest(JSON.stringify(
    [...files]
      .map(({ path, content }) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ));
}

function digestRunResult(result: RunResult): string {
  return digest(JSON.stringify({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    errorType: result.errorType,
    durationMs: result.durationMs,
    stage: result.stage,
  }));
}

function digestRunEpisode(result: RunResult): string {
  const locations = [...result.stderr.matchAll(/File\s+["']([^"']+)["'],\s+line\s+(\d+)/g)];
  const location = locations.at(-1);
  const terminalError = result.stderr
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => /(?:Error|Exception):/.test(line));
  if (!location || !terminalError) return digestRunResult(result);
  return digest(JSON.stringify({
    stage: result.stage,
    errorType: result.errorType,
    path: location[1].replaceAll("\\", "/"),
    line: Number.parseInt(location[2], 10),
    error: terminalError.trim(),
  }));
}

function activeKeyring(): ContextualEvidenceKeyring {
  return {
    currentVersion: config.byokCurrentVersion,
    keys: config.byokEncryptionKeys,
  };
}

function signingKey(version: number, keyring: ContextualEvidenceKeyring): Buffer {
  const encoded = keyring.keys.get(version);
  if (!encoded) throw new Error(`contextual evidence signing key v${version} is unavailable`);
  const master = Buffer.from(encoded, "base64");
  if (master.length !== 32) {
    throw new Error(`contextual evidence signing key v${version} must decode to 32 bytes`);
  }
  return createHmac("sha256", master).update(SIGNING_DOMAIN, "utf8").digest();
}

function sign(encoded: string, version: number, keyring: ContextualEvidenceKeyring): Buffer {
  return createHmac("sha256", signingKey(version, keyring)).update(encoded, "utf8").digest();
}

function isPayload(value: unknown): value is EvidencePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return p.v === TOKEN_VERSION &&
    Number.isInteger(p.k) &&
    typeof p.actor === "string" &&
    typeof p.courseId === "string" &&
    typeof p.lessonId === "string" &&
    typeof p.contextEpoch === "string" &&
    Number.isInteger(p.projectRevision) &&
    typeof p.files === "string" &&
    typeof p.result === "string" &&
    typeof p.episode === "string" &&
    typeof p.exp === "number" &&
    Number.isFinite(p.exp);
}

export function mintContextualEvidenceToken(
  actorId: string,
  identity: ContextualRunIdentity,
  files: readonly ProjectFile[],
  result: RunResult,
  options: EvidenceOptions = {},
): string {
  if (!hasUniqueProjectFilePaths(files)) {
    throw new Error("contextual evidence files require unique paths");
  }
  const keyring = options.keyring ?? activeKeyring();
  const payload: EvidencePayload = {
    v: TOKEN_VERSION,
    k: keyring.currentVersion,
    actor: digest(actorId),
    ...identity,
    files: digestProjectFiles(files),
    result: digestRunResult(result),
    episode: digestRunEpisode(result),
    exp: (options.nowMs ?? Date.now()) + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, payload.k, keyring).toString("base64url")}`;
}

function readVerifiedEvidencePayload(
  token: string,
  options: EvidenceOptions,
): EvidencePayload | null {
  if (!token || token.length > 4_096) return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) return null;
  let parsed: unknown;
  let provided: Buffer;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    Buffer.from(encoded, "base64url").toString("base64url") !== encoded ||
    provided.toString("base64url") !== signature ||
    !isPayload(parsed)
  ) return null;
  const keyring = options.keyring ?? activeKeyring();
  let expected: Buffer;
  try {
    expected = sign(encoded, parsed.k, keyring);
  } catch {
    return null;
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected) ||
    parsed.exp <= (options.nowMs ?? Date.now())
  ) return null;
  return parsed;
}

/**
 * Prove the authored repeated-error threshold with a stateless chain of
 * server-signed run receipts. Revisions must increase, every receipt must
 * belong to the same actor/lesson/error episode, and the latest receipt must
 * be the one submitted as the current offer.
 */
export function verifyContextualEvidenceAttemptChain(
  tokens: readonly string[],
  currentToken: string,
  actorId: string,
  identity: ContextualRunIdentity,
  minAttempts: number,
  options: EvidenceOptions = {},
): boolean {
  if (
    !Number.isSafeInteger(minAttempts) ||
    minAttempts < 1 ||
    tokens.length < minAttempts ||
    tokens.length > 10 ||
    tokens.at(-1) !== currentToken
  ) return false;
  const payloads = tokens.map((token) => readVerifiedEvidencePayload(token, options));
  if (payloads.some((payload) => payload === null)) return false;
  const verified = payloads as EvidencePayload[];
  const expectedActor = digest(actorId);
  const episode = verified[0]?.episode;
  const seenFiles = new Set<string>();
  let previousRevision = -1;
  for (const payload of verified) {
    if (
      payload.actor !== expectedActor ||
      payload.courseId !== identity.courseId ||
      payload.lessonId !== identity.lessonId ||
      payload.contextEpoch !== identity.contextEpoch ||
      payload.episode !== episode ||
      seenFiles.has(payload.files) ||
      payload.projectRevision <= previousRevision
    ) return false;
    seenFiles.add(payload.files);
    previousRevision = payload.projectRevision;
  }
  return previousRevision === identity.projectRevision;
}

export function verifyContextualEvidenceToken(
  token: string | null | undefined,
  actorId: string,
  identity: ContextualRunIdentity,
  files: readonly ProjectFile[],
  result: RunResult | null | undefined,
  options: EvidenceOptions = {},
): boolean {
  if (
    !token ||
    token.length > 4_096 ||
    !result ||
    !hasUniqueProjectFilePaths(files)
  ) return false;
  const parsed = readVerifiedEvidencePayload(token, options);
  return parsed !== null &&
    parsed.actor === digest(actorId) &&
    parsed.courseId === identity.courseId &&
    parsed.lessonId === identity.lessonId &&
    parsed.contextEpoch === identity.contextEpoch &&
    parsed.projectRevision === identity.projectRevision &&
    parsed.files === digestProjectFiles(files) &&
    parsed.result === digestRunResult(result);
}
