// Phase 20-P4: upsert for paid_access_interest. The signal loop is: click →
// POST /api/user/paid-access-interest → this upsert → operator SELECTs and
// reaches out. No emails, no Stripe, no waitlist form.
//
// email + display_name are sourced server-side from auth.users, never from
// the client — no spoofing surface.
//
// P-M7 (adversarial audit, bucket 4b): the "has the user ever clicked?"
// presence flag lives on public.user_preferences.paid_access_shown_at now
// so /ai-status can read BYOK state + presence in a single PK lookup. This
// table still holds the columns the operator queries for lead triage
// (email, display_name, click_count, last_clicked_at, denylisted_at_click)
// — the denorm is additive, not a replacement. Writes here and the
// user_preferences update below run inside a single transaction so the
// durable record + hot-path flag never disagree.

import { db } from "./client.js";

export async function upsertPaidAccessInterest(
  userId: string,
  opts: { denylistedAtClick?: boolean } = {},
): Promise<{ clickCount: number }> {
  const sql = db();
  const rows = await sql<
    Array<{ email: string | null; display_name: string | null }>
  >`
    SELECT email,
           COALESCE(
             raw_user_meta_data->>'display_name',
             raw_user_meta_data->>'full_name',
             raw_user_meta_data->>'name'
           ) AS display_name
      FROM auth.users
     WHERE id = ${userId}
  `;
  const row = rows[0];
  if (!row || !row.email) {
    throw new Error(`[paidAccessInterest] no email on auth.users for user=${userId}`);
  }
  // `denylisted_at_click` is monotonic-once-true: set on INSERT and OR'd on
  // UPDATE so that a user denylisted-then-un-denylisted doesn't lose the
  // banned-lead signal on their next click. The column answers "was this
  // user ever denylisted at the moment of a click?" — exactly the signal the
  // operator uses to triage clean leads vs. banned-but-willing ones.
  const denylistedAtClick = opts.denylistedAtClick === true;
  const clickCount = await sql.begin(async (tx) => {
    const result = await tx<Array<{ click_count: number }>>`
      INSERT INTO public.paid_access_interest
        (user_id, email, display_name, denylisted_at_click)
      VALUES (${userId}, ${row.email}, ${row.display_name}, ${denylistedAtClick})
      ON CONFLICT (user_id) DO UPDATE
        SET last_clicked_at     = now(),
            click_count         = public.paid_access_interest.click_count + 1,
            email               = EXCLUDED.email,
            display_name        = EXCLUDED.display_name,
            denylisted_at_click = public.paid_access_interest.denylisted_at_click
                                  OR EXCLUDED.denylisted_at_click
      RETURNING click_count
    `;
    // Mirror the presence flag onto user_preferences so /ai-status can read
    // it in the same PK lookup as the BYOK cipher. COALESCE preserves the
    // earliest click timestamp — "when did they first click?" is the signal
    // the hot path cares about, not "when did they most recently click?"
    // (the durable table above holds last_clicked_at for operator triage).
    await tx`
      INSERT INTO public.user_preferences (user_id, paid_access_shown_at)
      VALUES (${userId}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET paid_access_shown_at =
              COALESCE(public.user_preferences.paid_access_shown_at, now()),
            updated_at = now()
    `;
    return result[0]?.click_count ?? 1;
  });
  return { clickCount };
}

// User-initiated "I clicked by mistake / changed my mind." Deletes the row
// and clears the user_preferences flag so the CTA re-appears on the next
// ai-status refetch. Operator-initiated deletes (raw SQL against
// paid_access_interest only) won't clear the denorm — operator runbook
// should include the user_preferences update if the intent is "let this
// user see the CTA again."
export async function deletePaidAccessInterest(userId: string): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM public.paid_access_interest WHERE user_id = ${userId}
    `;
    await tx`
      UPDATE public.user_preferences
         SET paid_access_shown_at = NULL,
             updated_at = now()
       WHERE user_id = ${userId}
    `;
  });
}
