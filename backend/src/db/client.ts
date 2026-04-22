import postgres, { type Sql } from "postgres";
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
    // P-H5: bumped 10 → 25 to match the Supabase Pro pooler's per-client
    // budget (the pooler accepts ~200 client conns across the project, so
    // 25 per backend replica leaves plenty of headroom while removing the
    // queue-behind-DB stall we'd hit when ~11 concurrent asks + lesson
    // heartbeats + sessionManager reads competed for a 10-slot pool.
    max: 25,
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
