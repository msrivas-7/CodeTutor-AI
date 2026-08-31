import postgres, { type Sql, type TransactionSql } from "postgres";
import { config } from "../config.js";

// Phase 18b: one postgres.js connection pool shared across all db/* modules.
// Lazy init so unit tests that don't touch the DB never open a connection.
// DATABASE_URL points at the Supabase transaction pooler (port 6543) for the
// current environment — see config.ts + docs/DEVELOPMENT.md.

let pool: Sql | null = null;

export function db(): Sql {
  if (pool) return pool;
  const url = config.databaseUrl;
  if (!url) {
    throw new Error(
      "[db] DATABASE_URL is not set; assertConfigValid() should have caught " +
        "this at boot. Check your env file.",
    );
  }
  pool = postgres(url, {
    // Production defaults to the calibrated 25-connection ceiling. Highly
    // parallel E2E runs lower this per isolated backend so their aggregate
    // cannot exhaust the shared Supabase transaction-pooler client limit.
    max: config.databasePoolMax,
    idle_timeout: 30,
    connect_timeout: 10,
    // Supabase's transaction pooler (port 6543) recycles connections between
    // transactions and does not support prepared statements. Without this
    // flag we see "prepared statement does not exist" errors under load.
    prepare: false,
    // Let application errors bubble as postgres.PostgresError so route
    // handlers can translate them to HTTP codes (unique_violation → 409, etc).
    onnotice: () => {},
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  if (!pool) return;
  await pool.end({ timeout: 5 });
  pool = null;
}

// Test-only: lets specs reset the pool between runs.
export function __resetDbForTests(): void {
  pool = null;
}

// Phase 26 (audit C-3): RLS-as-defense wrapper for user-data queries.
//
// Today the backend connects with a service-role-equivalent role — RLS
// policies on user-data tables (user_preferences, course_progress,
// lesson_progress, editor_project, …) are bypassed by that role. A bug
// in a route handler that forgets the `WHERE user_id = req.userId`
// guard would silently return any user's data.
//
// This wrapper makes RLS the SECOND line of defense for user-scoped
// queries. Inside the transaction:
//   1. SET LOCAL ROLE authenticated  — drops to the role PostgREST uses
//      for JWT-authed requests; BYPASSRLS is no longer in effect.
//   2. SET LOCAL request.jwt.claims = '{"sub": "<userId>"}' — provides
//      the JWT-claim GUC that Supabase's `auth.uid()` reads. Existing
//      RLS policies are written as `auth.uid() = user_id`, so they now
//      filter rows correctly.
// Outside the transaction, the connection returns to its original
// (service-role) state — cross-user reads (admin lists, denylist
// lookups, BYOK decrypt for one user from a service-role context) keep
// working without changes.
//
// Defense-in-depth: a route-handler bug that drops or mangles the
// userId scope inside the wrapper now returns 0 rows instead of leaking
// data. SQL injection inside a wrapped query is RLS-bounded too.
//
// Limitation: a leaked DATABASE_URL still grants full power because
// the underlying connection is still service-role. That's a separate,
// bigger refactor (separate connection authenticated as `app_user`)
// tracked for a future phase. This change closes the higher-frequency
// route-handler-bug threat at much lower risk.
//
// Usage:
//   const rows = await withRlsContext(userId, async (tx) => {
//     return tx`SELECT * FROM user_preferences WHERE user_id = ${userId}`;
//   });
// The redundant `WHERE user_id = ${userId}` is intentional — defense
// in depth, AND it lets a query plan use the user_id index.
export async function withRlsContext<T>(
  userId: string,
  fn: (tx: TransactionSql<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  if (!userId) {
    throw new Error("[db] withRlsContext requires a non-empty userId");
  }
  const sql = db();
  const claims = JSON.stringify({ sub: userId });
  // postgres-js's `sql.begin` unwraps Promise types in its return; we
  // wrap the result to give callers a clean `Promise<T>` regardless of
  // the inner shape. Cast is safe — the inner fn returns Promise<T>.
  const result = await sql.begin(async (tx) => {
    // set_config(name, value, is_local=true) is the function form of
    // `SET LOCAL <name> = <value>`. The function form takes parameters,
    // which `SET LOCAL` (a statement) doesn't — so we use it for both
    // role and claims to keep the binding parameterized.
    await tx`SELECT set_config('role', 'authenticated', true)`;
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return await fn(tx);
  });
  return result as T;
}
