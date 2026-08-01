// Phase A — A2 (device contract): magic-link invites for the
// phone→laptop graduation handoff.
//
// After a phone learner completes lesson 1, the PhoneGraduationDialog
// prompts them to send themselves an email containing a magic link.
// Opening the link on a laptop lands on `/start?invite=<token>`, which
// pre-fills the signup email and re-stashes the lesson-1 code so the
// learner continues from where they left off.
//
// Data invariants:
//   - The raw email is NEVER stored. The DB row carries `email_hash`
//     (sha256 + static label, see ipHash.ts:hashEmail), which is also
//     the index for the per-email-per-24h rate cap.
//   - Tokens are 12-char Crockford-style (a–z minus l/o + 2–9), 60 bits
//     of entropy. Collision-retry inside the INSERT path absorbs the
//     rare clash (same shape as share tokens). DB-level CHECK
//     `^[a-z2-9]{12}$` catches any drift.
//   - 24h TTL by default (capped at 7d at the DB layer). Single-use:
//     `redeemed_at` flips on first open; subsequent opens 410 cleanly.
//   - The TTL sweep migration `20260507040000_phase_a_ttl_sweep.sql`
//     deletes redeemed/expired rows older than 24h post-expiry.
//
// RLS is deny-all-by-default (migration line 75). All access goes
// through the service-role pool used by `db()`.

import { randomBytes } from "node:crypto";
import { db } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

// 12-char base32 (Crockford-style: a–z minus l/o, plus 2–9). Same
// alphabet as share tokens — keeping the shape uniform across all
// learner-facing tokens means the URL aesthetics stay consistent and
// any token-shape regex can be shared. Migration enforces the literal
// pattern at the DB layer; the application generator must match.
export const INVITE_TOKEN_LENGTH = 12;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 chars; minus l, o, 0, 1

export function generateInviteToken(): string {
  // 256 % 32 === 0, so plain modulo is unbiased.
  const bytes = randomBytes(INVITE_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < INVITE_TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
}

export interface AnonLaptopInvite {
  id: string;
  token: string;
  emailHash: string;
  ipHash: string;
  code: string;
  name: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

interface InviteRow {
  id: string;
  token: string;
  email_hash: string;
  ip_hash: string;
  code: string;
  name: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
}

function rowToInvite(row: InviteRow): AnonLaptopInvite {
  return {
    id: row.id,
    token: row.token,
    emailHash: row.email_hash,
    ipHash: row.ip_hash,
    code: row.code,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
  };
}

export interface CreateInviteInput {
  emailHash: string;
  ipHash: string;
  code: string;
  name: string | null;
  // TTL in milliseconds. Defaults to 24h; capped at 7d by the DB
  // CHECK constraint (anon_laptop_invites_expires_in_future).
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Insert a new invite row with a freshly-generated token. On the
 * extremely rare token collision (UNIQUE violation on `token`), retry
 * up to 5 times. Returns the created row.
 */
export async function insertAnonLaptopInvite(
  input: CreateInviteInput,
): Promise<AnonLaptopInvite> {
  const sql = db();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateInviteToken();
    try {
      const rows = await sql<InviteRow[]>`
        INSERT INTO public.anon_laptop_invites (
          token, email_hash, ip_hash, code, name, expires_at
        )
        VALUES (
          ${token},
          ${input.emailHash},
          ${input.ipHash},
          ${input.code},
          ${input.name},
          NOW() + (${ttlMs}::bigint || ' milliseconds')::interval
        )
        RETURNING id, token, email_hash, ip_hash, code, name,
                  created_at, expires_at, redeemed_at
      `;
      return rowToInvite(rows[0]!);
    } catch (err) {
      // Postgres unique-violation code 23505. Retry with a new token.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(
    500,
    "anon laptop invite token generation: collision retry limit exhausted",
  );
}

/**
 * Look up an invite by its token. Returns null when no row exists. Does
 * NOT filter by expiry or redemption — caller decides how to treat
 * stale/redeemed rows (typically: 410 Gone with a "this link expired,
 * try again from your phone" message).
 */
export async function getAnonLaptopInviteByToken(
  token: string,
): Promise<AnonLaptopInvite | null> {
  const sql = db();
  const rows = await sql<InviteRow[]>`
    SELECT id, token, email_hash, ip_hash, code, name,
           created_at, expires_at, redeemed_at
      FROM public.anon_laptop_invites
     WHERE token = ${token}
     LIMIT 1
  `;
  return rows[0] ? rowToInvite(rows[0]) : null;
}

/**
 * Atomically flip `redeemed_at` to NOW() on first redemption. Returns
 * true if the row transitioned from unredeemed → redeemed; false if it
 * was already redeemed. Caller should treat false as "single-use link
 * already used."
 */
export async function markAnonLaptopInviteRedeemed(
  token: string,
): Promise<boolean> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    UPDATE public.anon_laptop_invites
       SET redeemed_at = NOW()
     WHERE token = ${token}
       AND redeemed_at IS NULL
     RETURNING id
  `;
  return rows.length > 0;
}

export type InviteQuotaScope = "ip" | "email";

export interface ReserveInviteResult {
  ok: boolean;
  /** Set when ok=false — which cap rejected the request. */
  scope?: InviteQuotaScope;
  /** Set when ok=true. */
  invite?: AnonLaptopInvite;
}

/**
 * Atomically enforce both daily caps and create the invite.
 *
 * The pre-review shape was count → check → count → check → insert across
 * five separate statements. Concurrent requests for the same IP (or the
 * same email) each observed the same pre-insert counts, all passed the
 * check, and all inserted — so a burst could send far more than the
 * advertised 3-per-IP / 1-per-email, turning an unauthenticated endpoint
 * into a mail-spam amplifier.
 *
 * Fix mirrors the established pattern in usageLedger's
 * `countPlatformQuestionsOnIpTodayLocked`: do the whole read-decide-write
 * inside one transaction guarded by `pg_advisory_xact_lock`, so
 * same-key requests serialize and each sees its predecessor's row.
 *
 * Two locks are taken (ip, then email) in a FIXED order. Ordering is what
 * prevents deadlock: two requests that share an IP but differ in email —
 * or vice versa — would otherwise be able to grab the two locks in
 * opposite orders and wait on each other. Distinct namespaces via
 * `hashtext('inv:ip:'||…)` keep these from colliding with the AI ledger's
 * advisory locks, which key on the bare ip_hash.
 */
export async function reserveAndCreateInvite(args: {
  emailHash: string;
  ipHash: string;
  code: string;
  name: string | null;
  windowMs: number;
  perIpCap: number;
  perEmailCap: number;
  ttlMs?: number;
}): Promise<ReserveInviteResult> {
  const sql = db();
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS;
  return (await sql.begin(async (tx) => {
    // Fixed lock order: ip then email. See doc comment.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`inv:ip:${args.ipHash}`})::bigint)`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`inv:em:${args.emailHash}`})::bigint)`;

    const ipRows = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM public.anon_laptop_invites
       WHERE ip_hash = ${args.ipHash}
         AND created_at > NOW() - (${args.windowMs}::bigint || ' milliseconds')::interval
    `;
    if ((ipRows[0]?.count ?? 0) >= args.perIpCap) {
      return { ok: false, scope: "ip" as const };
    }

    const emailRows = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM public.anon_laptop_invites
       WHERE email_hash = ${args.emailHash}
         AND created_at > NOW() - (${args.windowMs}::bigint || ' milliseconds')::interval
    `;
    if ((emailRows[0]?.count ?? 0) >= args.perEmailCap) {
      return { ok: false, scope: "email" as const };
    }

    // Token-collision retry stays inside the same transaction so the
    // quota we just reserved can't be lost between check and insert.
    // Each attempt runs in its own SAVEPOINT: a 23505 marks the whole
    // transaction aborted in Postgres, so without one the retry would
    // die with 25P02 ("current transaction is aborted") instead of
    // trying a fresh token.
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = generateInviteToken();
      try {
        const rows = (await tx.savepoint(
          async (sp) => await sp<InviteRow[]>`
            INSERT INTO public.anon_laptop_invites (
              token, email_hash, ip_hash, code, name, expires_at
            )
            VALUES (
              ${token},
              ${args.emailHash},
              ${args.ipHash},
              ${args.code},
              ${args.name},
              NOW() + (${ttlMs}::bigint || ' milliseconds')::interval
            )
            RETURNING id, token, email_hash, ip_hash, code, name,
                      created_at, expires_at, redeemed_at
          `,
        )) as unknown as InviteRow[];
        return { ok: true, invite: rowToInvite(rows[0]!) };
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new HttpError(
      500,
      "anon laptop invite token generation: collision retry limit exhausted",
    );
  })) as ReserveInviteResult;
}

/**
 * Count rows for a given ip_hash created within the last `windowMs`.
 * Used by the route handler to enforce the per-IP cap (3 sends / 24h).
 */
export async function countRecentInvitesByIp(
  ipHash: string,
  windowMs: number,
): Promise<number> {
  const sql = db();
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM public.anon_laptop_invites
     WHERE ip_hash = ${ipHash}
       AND created_at > NOW() - (${windowMs}::bigint || ' milliseconds')::interval
  `;
  return rows[0]?.count ?? 0;
}

/**
 * Count rows for a given email_hash created within the last `windowMs`.
 * Used by the route handler to enforce the per-email cap (1 send / 24h).
 */
export async function countRecentInvitesByEmail(
  emailHash: string,
  windowMs: number,
): Promise<number> {
  const sql = db();
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM public.anon_laptop_invites
     WHERE email_hash = ${emailHash}
       AND created_at > NOW() - (${windowMs}::bigint || ' milliseconds')::interval
  `;
  return rows[0]?.count ?? 0;
}
