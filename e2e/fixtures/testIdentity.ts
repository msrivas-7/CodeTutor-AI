import type { SupabaseClient, User } from "@supabase/supabase-js";

const TEST_DOMAIN = "codetutor.test";
const MAX_LIST_PAGES = 50;
const MAX_EMAIL_LOCAL_PART = 64;
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MIN_ABANDONED_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ABANDONED_DELETES = 100;
const CI_RUN_SUFFIX =
  /^(?:shard-[1-6]|cross-browser-(?:firefox|webkit)|security)-run\d+-attempt\d+$/;
const JANITOR_LEADER_SUFFIX = /^shard-1-run\d+-attempt\d+$/;

export type TestUserIdentity = Pick<User, "id" | "email">;

export type TeardownReport = {
  scanned: number;
  matched: number;
  deleted: number;
  foreignSkipped: number;
};

export type AbandonedReapReport = {
  scanned: number;
  eligible: number;
  deleted: number;
  truncated: boolean;
};

export function requireCurrentRunSuffix(
  suffix = process.env.E2E_USER_SUFFIX,
): string {
  if (!suffix || !SAFE_SEGMENT.test(suffix)) {
    throw new Error(
      "Test-user deletion refused: E2E_USER_SUFFIX must be a non-empty safe run namespace",
    );
  }
  return suffix;
}

function normalizeIdentitySegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(
      `${label} must contain only letters, digits, dot, underscore, or dash`,
    );
  }
  return value;
}

export function buildCurrentRunTestEmail(
  identity: string,
  suffix = requireCurrentRunSuffix(),
): string {
  const safeIdentity = normalizeIdentitySegment(identity, "Test identity");
  const safeSuffix = requireCurrentRunSuffix(suffix);
  const namespaceMarker = `${safeSuffix.length}-${safeSuffix}`;
  const identityBudget = MAX_EMAIL_LOCAL_PART - `e2e--${namespaceMarker}`.length;
  if (identityBudget < 1) {
    throw new Error("E2E_USER_SUFFIX is too long to form a valid test email");
  }
  const localPart = `e2e-${safeIdentity.slice(0, identityBudget)}-${namespaceMarker}`;
  return `${localPart}@${TEST_DOMAIN}`;
}

export function buildWorkerTestEmail(
  workerIndex: number,
  suffix = requireCurrentRunSuffix(),
): string {
  if (!Number.isSafeInteger(workerIndex) || workerIndex < 0) {
    throw new Error("Worker index must be a non-negative integer");
  }
  return buildCurrentRunTestEmail(`w${workerIndex}`, suffix);
}

export function isCurrentRunTestEmail(
  email: string | null | undefined,
  suffix = requireCurrentRunSuffix(),
): boolean {
  const safeSuffix = requireCurrentRunSuffix(suffix);
  return extractTestRunSuffix(email) === safeSuffix;
}

export function extractTestRunSuffix(
  email: string | null | undefined,
): string | null {
  if (typeof email !== "string") return null;
  const separator = email.lastIndexOf("@");
  if (separator < 1 || email.indexOf("@") !== separator) return null;
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (domain !== TEST_DOMAIN || !localPart.startsWith("e2e-")) return null;

  const marker = /-(\d+)-/g;
  const matches: string[] = [];
  for (
    let match = marker.exec(localPart);
    match;
    match = marker.exec(localPart)
  ) {
    const suffix = localPart.slice(match.index + match[0].length);
    const identity = localPart.slice("e2e-".length, match.index);
    if (
      identity.length > 0 &&
      Number(match[1]) === suffix.length &&
      SAFE_SEGMENT.test(suffix)
    ) {
      matches.push(suffix);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function isRecognizedCiRunSuffix(suffix: string): boolean {
  return SAFE_SEGMENT.test(suffix) && CI_RUN_SUFFIX.test(suffix);
}

export function shouldReapAbandonedCiUsers(
  suffix = requireCurrentRunSuffix(),
): boolean {
  return JANITOR_LEADER_SUFFIX.test(requireCurrentRunSuffix(suffix));
}

export function assertCurrentRunTestIdentity(
  user: TestUserIdentity,
  suffix = requireCurrentRunSuffix(),
): void {
  if (!user.id || !isCurrentRunTestEmail(user.email, suffix)) {
    throw new Error(
      `Test-user deletion refused: identity is outside the current run namespace (${suffix})`,
    );
  }
}

export async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error(`Test-user listing exceeded ${MAX_LIST_PAGES} pages`);
}

export async function deleteCurrentRunTestUser(
  admin: SupabaseClient,
  user: TestUserIdentity,
  suffix = requireCurrentRunSuffix(),
): Promise<void> {
  assertCurrentRunTestIdentity(user, suffix);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw error;
}

export async function teardownCurrentRunTestUsers(
  admin: SupabaseClient,
  suffix = requireCurrentRunSuffix(),
): Promise<TeardownReport> {
  const safeSuffix = requireCurrentRunSuffix(suffix);
  const users = await listAllUsers(admin);
  const victims = users.filter((user) =>
    isCurrentRunTestEmail(user.email, safeSuffix),
  );

  for (const user of victims) {
    await deleteCurrentRunTestUser(admin, user, safeSuffix);
  }

  return {
    scanned: users.length,
    matched: victims.length,
    deleted: victims.length,
    foreignSkipped: users.length - victims.length,
  };
}

export async function reapAbandonedCiTestUsers(
  admin: SupabaseClient,
  options: {
    now?: Date;
    minimumAgeMs?: number;
    maxDeletes?: number;
  } = {},
): Promise<AbandonedReapReport> {
  const now = options.now ?? new Date();
  const minimumAgeMs = options.minimumAgeMs ?? MIN_ABANDONED_AGE_MS;
  const maxDeletes = options.maxDeletes ?? MAX_ABANDONED_DELETES;
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Abandoned-user cleanup refused: now must be a valid date");
  }
  if (
    !Number.isSafeInteger(minimumAgeMs) ||
    minimumAgeMs < MIN_ABANDONED_AGE_MS
  ) {
    throw new Error(
      "Abandoned-user cleanup refused: minimum age must be at least 24 hours",
    );
  }
  if (
    !Number.isSafeInteger(maxDeletes) ||
    maxDeletes < 1 ||
    maxDeletes > MAX_ABANDONED_DELETES
  ) {
    throw new Error(
      `Abandoned-user cleanup refused: maxDeletes must be between 1 and ${MAX_ABANDONED_DELETES}`,
    );
  }

  const users = await listAllUsers(admin);
  const eligible = users.filter((user) => {
    const suffix = extractTestRunSuffix(user.email);
    const createdAt = Date.parse(user.created_at);
    return (
      suffix !== null &&
      isRecognizedCiRunSuffix(suffix) &&
      Number.isFinite(createdAt) &&
      now.getTime() - createdAt >= minimumAgeMs
    );
  });
  const victims = eligible.slice(0, maxDeletes);

  for (const user of victims) {
    const suffix = extractTestRunSuffix(user.email);
    if (!suffix || !isRecognizedCiRunSuffix(suffix)) {
      throw new Error(
        "Abandoned-user cleanup refused: identity changed during selection",
      );
    }
    await deleteCurrentRunTestUser(admin, user, suffix);
  }

  return {
    scanned: users.length,
    eligible: eligible.length,
    deleted: victims.length,
    truncated: eligible.length > victims.length,
  };
}
