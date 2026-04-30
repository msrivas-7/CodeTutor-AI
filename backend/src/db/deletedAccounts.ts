import { db } from "./client.js";

// Phase 23 P1 #6: account-deletion audit trail. See migration
// 20260430020000_deleted_accounts.sql for the storage shape + retention
// posture. Written BEFORE auth.admin.deleteUser() so even a half-failed
// cascade leaves proof of intent.
//
// Pure insert; caller owns the hashing (uses the existing hashUserId
// helper so the userId field is correlatable with request logs).

export type DeletionReason =
  | "self_service"
  | "operator_mod"
  | "fraud_prevention"
  | (string & {});

export interface InsertDeletedAccountArgs {
  /** HMAC-hashed user id (per `hashUserId` in services/crypto/logHash.ts).
   *  Never the plaintext UUID — the row outlives auth.users. */
  userIdHashed: string;
  /** Plaintext email at deletion time. Pairs with deleted_at as the
   *  support-ticket key for "I deleted my account on X but…" lookups. */
  email: string;
  reason?: DeletionReason;
}

export async function insertDeletedAccount(
  args: InsertDeletedAccountArgs,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.deleted_accounts (user_id_hashed, email, reason)
    VALUES (${args.userIdHashed}, ${args.email}, ${args.reason ?? "self_service"})
  `;
}
