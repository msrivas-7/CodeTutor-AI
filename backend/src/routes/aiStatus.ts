// Phase 20-P4: three endpoints the frontend polls around the free tier.
//
//   GET    /api/user/ai-status            — what source + how much remains
//   POST   /api/user/ai-exhaustion-click  — increment the CTA-click counter
//   POST   /api/user/paid-access-interest — structured willingness-to-pay
//   DELETE /api/user/paid-access-interest — user-initiated withdrawal
//
// All four live under the /api/user mount in index.ts, which already wires
// csrfGuard + authMiddleware + mutationLimit. No body is required on any of
// the mutating endpoints — outcomes/ids are small enough to be URL params,
// but we put them in the JSON body to stay consistent with the rest of the
// API surface.
//
// Round 5 hardening:
//   - DELETE /paid-access-interest lets a user withdraw their own signal
//     ("clicked by mistake" / "changed my mind"). The Settings UI renders
//     an "Interest recorded — Remove" line once the row exists, so there
//     is always a user-visible recovery path.
//
// Round 6 reversal:
//   - Denylisted users CAN click the paid-interest CTA. Round 5 had 403'd
//     the POST on the theory that banned accounts pollute the lead table;
//     operator decided a willingness-to-pay signal from a past abuser is
//     actually a strong lead and shouldn't be silently discarded. We just
//     flag the row (`denylisted_at_click=true`) so the operator can see the
//     context when reviewing. UI shows the CTA for `reason==='denylisted'`
//     again; see TutorSetupWarning.

import { Router } from "express";
import { z } from "zod";
import { resolveAICredential } from "../services/ai/credential.js";
import { isDenylisted } from "../db/denylist.js";
import {
  deletePaidAccessInterest,
  upsertPaidAccessInterest,
} from "../db/paidAccessInterest.js";
import { getAIStatusPrefs } from "../db/preferences.js";
import { aiExhaustionCtaClicks } from "../services/metrics.js";

export const aiStatusRouter = Router();

aiStatusRouter.get("/ai-status", async (req, res, next) => {
  try {
    const userId = req.userId!;
    // P-M7: single PK lookup on user_preferences returns both the decrypted
    // BYOK key (if any) and the paid-interest presence flag. We then hand
    // the prefetched key to resolveAICredential so it skips its own
    // getOpenAIKey round-trip. Net: two user_preferences reads on every
    // /ai-status poll collapse into one.
    const prefs = await getAIStatusPrefs(userId);
    const cred = await resolveAICredential(userId, prefs.openaiKey);
    const shownInterest = prefs.hasShownPaidInterest;
    if (cred.source === "byok") {
      return res.json({
        source: "byok",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: shownInterest,
      });
    }
    if (cred.source === "platform") {
      return res.json({
        source: "platform",
        remainingToday: cred.remainingToday,
        capToday: cred.capToday,
        resetAtUtc: cred.resetAtUtc.toISOString(),
        hasShownPaidInterest: shownInterest,
      });
    }
    // source === "none"
    return res.json({
      source: "none",
      reason: cred.reason,
      remainingToday: null,
      capToday: null,
      resetAtUtc: cred.resetAtUtc ? cred.resetAtUtc.toISOString() : null,
      hasShownPaidInterest: shownInterest,
    });
  } catch (err) {
    next(err);
  }
});

const clickBody = z.object({
  outcome: z.enum(["dismissed", "clicked_byok", "clicked_paid_interest"]),
});

aiStatusRouter.post("/ai-exhaustion-click", async (req, res) => {
  const parsed = clickBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "outcome required" });
  }
  // `denylisted` label is "na" for dismissed/clicked_byok — those paths
  // don't depend on the user's denylist state and we don't want to pay a
  // PK lookup on every dismiss. The paid-interest path below passes the
  // real yes/no.
  aiExhaustionCtaClicks.inc({ outcome: parsed.data.outcome, denylisted: "na" });
  res.status(204).end();
});

aiStatusRouter.post("/paid-access-interest", async (req, res, next) => {
  try {
    const userId = req.userId!;
    // Flag denylisted-at-click so the operator can distinguish "banned-user
    // lead" from "clean-user lead" at review time without a JOIN.
    //
    // Round 8: bypass the 60 s cache on this specific path. Monotonic-OR on
    // the column means a stale `denylisted=yes` sticks forever on the row,
    // and a stale `denylisted=no` can misclassify a freshly-banned lead as
    // clean for that row's lifetime. Paid-interest clicks are rare (gated by
    // mutationLimit + "one signal per user" UX), so the extra PK lookup is
    // a worthy trade for getting the row's `denylisted_at_click` right the
    // first time. The cache is still used on the hot path (/api/ai/ask).
    const denylistedAtClick = await isDenylisted(userId, { bypassCache: true });
    await upsertPaidAccessInterest(userId, { denylistedAtClick });
    aiExhaustionCtaClicks.inc({
      outcome: "clicked_paid_interest",
      denylisted: denylistedAtClick ? "yes" : "no",
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

aiStatusRouter.delete("/paid-access-interest", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await deletePaidAccessInterest(userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
