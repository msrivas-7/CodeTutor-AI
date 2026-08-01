import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { config } from "../../config.js";
import type { AIAskParams, TutorStage } from "./provider.js";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
const SIGNING_DOMAIN = "codetutor:tutor-progress:v1";

interface TokenPayload {
  v: 1;
  k: number;
  actor: string;
  task: string;
  stage: "approach";
  exp: number;
}

export interface TutorProgressKeyring {
  currentVersion: number;
  keys: ReadonlyMap<number, string>;
}

interface ProgressIdentity {
  actorId: string;
  taskScope: string;
}

interface ProgressOptions {
  nowMs?: number;
  keyring?: TutorProgressKeyring;
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === TOKEN_VERSION &&
    Number.isInteger(payload.k) &&
    typeof payload.actor === "string" &&
    typeof payload.task === "string" &&
    payload.stage === "approach" &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp)
  );
}

function activeKeyring(): TutorProgressKeyring {
  return {
    currentVersion: config.byokCurrentVersion,
    keys: config.byokEncryptionKeys,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function signingKey(version: number, keyring: TutorProgressKeyring): Buffer {
  const encoded = keyring.keys.get(version);
  if (!encoded) throw new Error(`tutor progress signing key v${version} is unavailable`);
  const master = Buffer.from(encoded, "base64");
  if (master.length !== 32) {
    throw new Error(`tutor progress signing key v${version} must decode to 32 bytes`);
  }
  // Domain separation prevents a tutor token signature from being useful as
  // a BYOK encryption primitive even though both derive from the same rotated
  // deployment keyring.
  return createHmac("sha256", master).update(SIGNING_DOMAIN, "utf8").digest();
}

function sign(payload: string, version: number, keyring: TutorProgressKeyring): Buffer {
  return createHmac("sha256", signingKey(version, keyring))
    .update(payload, "utf8")
    .digest();
}

/**
 * Stable server-side task scope. Guided tasks bind to canonical catalog
 * identity. Editor mode binds to the active file plus the project path set;
 * code edits do not restart the gate, while switching projects/files does.
 */
export function tutorTaskScope(
  params: Pick<AIAskParams, "lessonContext" | "activeFile" | "files" | "language">,
): string {
  if (params.lessonContext) {
    const exercise = params.lessonContext.exerciseId ?? "lesson";
    return `guided:${params.lessonContext.courseId}/${params.lessonContext.lessonId}/${exercise}`;
  }
  const paths = [...new Set(params.files.map((file) => file.path))].sort();
  return `editor:${params.language ?? "unknown"}:${params.activeFile ?? "none"}:${paths.join("|")}`;
}

/** Mint proof only after a first tutor response completed successfully. */
export function mintTutorProgressToken(
  identity: ProgressIdentity,
  options: ProgressOptions = {},
): string {
  if (!identity.actorId || !identity.taskScope) {
    throw new TypeError("tutor progress identity must be non-empty");
  }
  const keyring = options.keyring ?? activeKeyring();
  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    k: keyring.currentVersion,
    actor: digest(identity.actorId),
    task: digest(identity.taskScope),
    stage: "approach",
    exp: (options.nowMs ?? Date.now()) + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, payload.k, keyring).toString("base64url")}`;
}

/**
 * Invalid or absent proof deliberately returns the restrictive stage instead
 * of exposing why verification failed.
 */
export function resolveTutorStage(
  token: string | null | undefined,
  identity: ProgressIdentity,
  options: ProgressOptions = {},
): TutorStage {
  if (!token || token.length > 1_024 || !identity.actorId || !identity.taskScope) {
    return "clarify";
  }
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) return "clarify";

  let parsed: unknown;
  let provided: Buffer;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    provided = Buffer.from(signature, "base64url");
  } catch {
    return "clarify";
  }
  if (!isTokenPayload(parsed)) return "clarify";
  const payload = parsed;
  if (
    payload.exp <= (options.nowMs ?? Date.now()) ||
    payload.actor !== digest(identity.actorId) ||
    payload.task !== digest(identity.taskScope)
  ) {
    return "clarify";
  }

  try {
    const expected = sign(encoded, payload.k, options.keyring ?? activeKeyring());
    if (provided.length !== expected.length) return "clarify";
    return timingSafeEqual(provided, expected) ? "approach" : "clarify";
  } catch {
    return "clarify";
  }
}
