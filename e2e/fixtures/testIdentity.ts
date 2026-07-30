import type { SupabaseClient, User } from "@supabase/supabase-js";

const TEST_DOMAIN = "codetutor.test";
const MAX_LIST_PAGES = 50;
const MAX_EMAIL_LOCAL_PART = 64;
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type TestUserIdentity = Pick<User, "id" | "email">;

export type TeardownReport = {
  scanned: number;
  matched: number;
  deleted: number;
  foreignSkipped: number;
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
  if (typeof email !== "string") return false;
  const separator = email.lastIndexOf("@");
  if (separator < 1 || email.indexOf("@") !== separator) return false;
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const safeSuffix = requireCurrentRunSuffix(suffix);
  return (
    domain === TEST_DOMAIN &&
    localPart.startsWith("e2e-") &&
    localPart.endsWith(`-${safeSuffix.length}-${safeSuffix}`)
  );
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
