// Phase 26 (audit SRE F7.1): daily invariant validator.
//
// Drift between two canonical-but-redundant data sources is the leading
// edge of a class of bugs the existing alert rules can't detect:
//   - admin_audit_log says "demoted user X" but auth.users.app_metadata
//     still carries role=admin (the Supabase Custom Access Token hook
//     failed silently)
//   - user_ai_costs.lifetime_cost_usd disagrees with SUM(ai_usage_ledger)
//     for the same user (a denorm write was lost or a ledger insert
//     committed without updating the denorm)
//
// Each invariant is checked by querying both source-of-truth and
// derived-state, comparing, and emitting a structured log line per
// violation. The line is the alert hook — `evt:invariant_drift` lands
// in Log Analytics; a scheduled-query rule (added separately in
// alerts.bicep) pages on >0 within 24h.
//
// Why daily, not realtime: drift detection is forensics. The bug that
// caused the drift has already happened by the time we look; alerting
// faster wouldn't speed up remediation. A single 04:00 UTC run is
// cheap (~3 queries), surfaces drift within 24h, and avoids blowing
// up Log Analytics ingestion with non-events.
//
// Observability shape: structured logs (not metrics) because the
// per-violation context (which user, which invariant, magnitude) is
// what makes triage tractable. A Counter with cardinality=1 doesn't
// help.

import { db } from "../../db/client.js";

const TOLERANCE_USD = 0.01; // matches the existing budget watcher floor

interface DriftFinding {
  invariant: string;
  userId: string | null;
  expected: unknown;
  actual: unknown;
  delta?: number;
}

/**
 * Check 1 — admin role mirror.
 *
 * `public.user_roles` is the authoritative table (admin writes go here).
 * `auth.users.raw_app_meta_data->>'role'` is set by the Custom Access
 * Token hook on every JWT mint. They MUST agree — drift means a hook
 * failure or a manual edit that bypassed the hook.
 *
 * We check: every user_roles row with role='admin' has the matching
 * app_metadata claim, AND every auth.users with role=admin in
 * app_metadata has a corresponding user_roles row.
 */
async function checkAdminRoleMirror(): Promise<DriftFinding[]> {
  const sql = db();
  const rows = await sql<
    Array<{
      user_id: string;
      in_user_roles: boolean;
      in_app_metadata: boolean;
    }>
  >`
    WITH a AS (
      SELECT user_id FROM public.user_roles WHERE role = 'admin'
    ),
    b AS (
      SELECT id AS user_id
        FROM auth.users
       WHERE raw_app_meta_data->>'role' = 'admin'
    )
    SELECT
      COALESCE(a.user_id, b.user_id) AS user_id,
      a.user_id IS NOT NULL AS in_user_roles,
      b.user_id IS NOT NULL AS in_app_metadata
      FROM a FULL OUTER JOIN b ON a.user_id = b.user_id
     WHERE (a.user_id IS NULL) <> (b.user_id IS NULL)
  `;
  return rows.map((r) => ({
    invariant: "admin_role_mirror",
    userId: r.user_id,
    expected: r.in_user_roles ? "in both" : "in app_metadata only",
    actual: {
      user_roles: r.in_user_roles,
      app_metadata: r.in_app_metadata,
    },
  }));
}

/**
 * Check 2 — platform-AI cost denorm vs ledger.
 *
 * `user_ai_costs.lifetime_cost_usd` is the denorm read by the
 * resolver's lifetime-cap gate (hot path; can't sum the ledger per
 * request). It's written by `recordPlatformCost` after every billable
 * call. `ai_usage_ledger` rows are the source of truth — sum them per
 * user and compare to the denorm.
 *
 * Drift > $0.01 means either (a) a ledger insert committed but the
 * denorm update failed (free-tier user gets infinite life until restart),
 * or (b) a manual fixup left them out of sync. Both warrant a manual
 * look.
 */
async function checkAiCostDenorm(): Promise<DriftFinding[]> {
  const sql = db();
  const rows = await sql<
    Array<{
      user_id: string;
      denorm_usd: string | null;
      ledger_usd: string | null;
    }>
  >`
    WITH ledger AS (
      SELECT user_id, COALESCE(SUM(cost_usd), 0) AS total
        FROM public.ai_usage_ledger
       WHERE funding_source = 'platform'
       GROUP BY user_id
    ),
    denorm AS (
      SELECT user_id, lifetime_cost_usd FROM public.user_ai_costs
    )
    SELECT
      COALESCE(d.user_id, l.user_id) AS user_id,
      d.lifetime_cost_usd::text     AS denorm_usd,
      l.total::text                 AS ledger_usd
      FROM denorm d FULL OUTER JOIN ledger l ON d.user_id = l.user_id
     WHERE ABS(COALESCE(d.lifetime_cost_usd, 0) - COALESCE(l.total, 0)) > ${TOLERANCE_USD}
  `;
  return rows.map((r) => {
    const denorm = Number(r.denorm_usd ?? 0);
    const ledger = Number(r.ledger_usd ?? 0);
    return {
      invariant: "ai_cost_denorm",
      userId: r.user_id,
      expected: ledger,
      actual: denorm,
      delta: denorm - ledger,
    };
  });
}

export async function runInvariantValidatorOnce(): Promise<{
  findings: DriftFinding[];
  errors: string[];
}> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  for (const [name, fn] of [
    ["admin_role_mirror", checkAdminRoleMirror],
    ["ai_cost_denorm", checkAiCostDenorm],
  ] as const) {
    try {
      const result = await fn();
      findings.push(...result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
      console.error(
        JSON.stringify({
          level: "error",
          evt: "invariant_validator_check_failed",
          invariant: name,
          err: msg,
          t: new Date().toISOString(),
        }),
      );
    }
  }
  for (const f of findings) {
    console.warn(
      JSON.stringify({
        level: "warn",
        evt: "invariant_drift",
        invariant: f.invariant,
        userId: f.userId,
        expected: f.expected,
        actual: f.actual,
        delta: f.delta ?? null,
        t: new Date().toISOString(),
      }),
    );
  }
  console.info(
    JSON.stringify({
      level: "info",
      evt: "invariant_validator_run",
      findings: findings.length,
      errors: errors.length,
      t: new Date().toISOString(),
    }),
  );
  return { findings, errors };
}

let intervalHandle: NodeJS.Timeout | null = null;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule the validator to run once on boot (so a manual restart can
 * trigger a check) and then every 24 hours. Each tick is fire-and-forget;
 * errors are logged but never crash the process.
 */
export function startInvariantValidator(): void {
  if (intervalHandle) return;
  // Boot-time run: 60s after startup so the boot sequence settles first.
  setTimeout(() => {
    void runInvariantValidatorOnce().catch((err) => {
      console.error(
        `[invariant-validator] boot-time run failed: ${(err as Error).message}`,
      );
    });
  }, 60_000).unref?.();
  intervalHandle = setInterval(() => {
    void runInvariantValidatorOnce().catch((err) => {
      console.error(
        `[invariant-validator] scheduled run failed: ${(err as Error).message}`,
      );
    });
  }, ONE_DAY_MS);
  intervalHandle.unref?.();
}

export function stopInvariantValidator(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
