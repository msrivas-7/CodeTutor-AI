// Phase A — A2 (device contract): magic-link graduation handoff.
//
// POST /api/anon/laptop-link
//   Body: { email, code, name? }
//   Side effect: writes a row in `anon_laptop_invites` with email_hash
//     (NOT the raw email), generates a 12-char Crockford-style token,
//     and emails the magic link `${corsOrigin}/start?invite=<token>`
//     to the user.
//   Response: { ok: true, url } — the same URL is also embedded in the
//     email; returning it in the response unblocks the QR-fallback path
//     (the PhoneGraduationDialog renders a scannable QR after submit so
//     a learner can hop devices without waiting for email delivery).
//   On kill-switch flipped: 503 ANON_LAPTOP_INVITE_DISABLED. Frontend
//     falls back to the existing wall flow.
//   On rate-limit hit: 429 with a structured error code + a hint about
//     when the cap resets.
//
// Privacy invariants:
//   - Raw email NEVER lands on disk. The DB row carries email_hash; the
//     ACS sender call is the only place the raw email transits and it
//     is not logged.
//   - Code is capped at 4KB (matches the share-card snippet limit and
//     the DB CHECK constraint).
//   - Token is the only credential — collision-retry inside the DB
//     layer; 60-bit entropy + DB CHECK make brute-force impractical.

import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  getAnonLaptopInviteByToken,
  markAnonLaptopInviteRedeemed,
  reserveAndCreateInvite,
} from "../db/anonLaptopInvites.js";
import { isAnonLaptopInviteDisabled } from "../services/share/killSwitches.js";
import { hashClientIp, hashEmail } from "../services/ai/ipHash.js";
import {
  EmailNotConfiguredError,
  sendEmail,
} from "../services/email/acsClient.js";

// Structured-log emitter — same shape as observability samplers in this
// repo (`{"level":"warn","evt":"…",…}`). Stays inline here so this route
// has no extra module dependencies and matches the codebase's existing
// "JSON.stringify into console" convention.
function logEvent(level: "warn" | "error", payload: Record<string, unknown>): void {
  const fn = level === "error" ? console.error : console.warn;
  fn(JSON.stringify({ level, ...payload }));
}

// 24 hours in milliseconds — both the per-IP / per-email rate window
// AND the invite TTL. Keeping them aligned means a learner who hits the
// per-email cap at hour 23:59 has a fresh window the moment their last
// invite expires.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Per-IP cap: 3 sends / 24h. Allows a learner who fat-fingers their
// email (typo, wrong domain) to retry twice while still bounding the
// abuse surface — an attacker enumerating email addresses gets 3
// attempts then 24h of throttle.
const PER_IP_CAP = 3;

// Per-email cap: 1 send / 24h. Stops mail-relay abuse — a single
// receiving inbox can only be used once per window even from rotated IPs.
const PER_EMAIL_CAP = 1;

const bodySchema = z
  .object({
    // Loose RFC 5322 — accept anything that looks email-shaped.
    // ACS will reject non-deliverable addresses on send.
    email: z
      .string()
      .min(3)
      .max(254)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be email-shaped"),
    // The lesson-1 code the learner just typed. The DB CHECK is
    // `octet_length(code) <= 4096` — BYTES — so validating with Zod's
    // `.max()` (UTF-16 code units) would let ~2k multibyte characters
    // through here and then fail the insert with a constraint
    // violation, surfacing as a 500 instead of a bounded 400. Measure
    // the same way the constraint does.
    code: z
      .string()
      .min(1)
      .refine((s) => Buffer.byteLength(s, "utf8") <= 4096, {
        message: "code must be at most 4096 bytes",
      }),
    // Optional parsed-from-code name (extractNameFromCode result).
    name: z.string().min(1).max(80).optional().nullable(),
  })
  .strict();

export const anonLaptopInviteRouter = Router();

anonLaptopInviteRouter.post("/laptop-link", async (req, res, next) => {
  try {
    if (await isAnonLaptopInviteDisabled()) {
      return res.status(503).json({ error: "ANON_LAPTOP_INVITE_DISABLED" });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_BODY",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }
    const { email, code, name } = parsed.data;

    // Hash before any DB read or write so the raw email never lives in
    // route-local state longer than the moment of the ACS call below.
    const emailHash = hashEmail(email);
    const ipHash = hashClientIp(req.ip ?? "");

    // Both daily caps + the insert happen in ONE advisory-locked
    // transaction. Doing them as separate reads let a concurrent burst
    // for the same IP/email each observe the same pre-insert count,
    // pass the check, and insert — blowing past the advertised
    // 3-per-IP / 1-per-email and turning this unauthenticated route
    // into a mail-spam amplifier. See reserveAndCreateInvite.
    const reservation = await reserveAndCreateInvite({
      emailHash,
      ipHash,
      code,
      name: name ?? null,
      windowMs: ONE_DAY_MS,
      perIpCap: PER_IP_CAP,
      perEmailCap: PER_EMAIL_CAP,
      ttlMs: ONE_DAY_MS,
    });
    if (!reservation.ok || !reservation.invite) {
      return res.status(429).json({
        error: "ANON_LAPTOP_INVITE_RATE_LIMITED",
        scope: reservation.scope ?? "ip",
        retryAfterHours: 24,
      });
    }
    const invite = reservation.invite;

    const baseUrl = config.corsOrigin.replace(/\/+$/, "");
    const url = `${baseUrl}/start?invite=${encodeURIComponent(invite.token)}`;

    // Send the email. Failures here do NOT roll back the invite row —
    // the token is already valid for 24h and the user can re-trigger
    // a send (which reuses the per-email cap window). We log so an
    // operator can correlate "user got the email but the response
    // was 500" → ACS issue.
    try {
      await sendEmail({
        to: email,
        subject: "Open lesson 2 on your laptop",
        text: buildPlainTextEmail(url, name ?? null),
        html: buildHtmlEmail(url, name ?? null),
        displayName: "CodeTutor",
      });
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        // Dev/test: the row exists, the URL works — surface a 200 so
        // the local dev flow doesn't 500 just because ACS isn't wired.
        logEvent("warn", {
          evt: "anon_laptop_invite_dev_no_email",
          emailHash,
          token: invite.token,
        });
      } else {
        logEvent("error", {
          evt: "anon_laptop_invite_email_failed",
          emailHash,
          token: invite.token,
          err: (err as Error)?.message,
        });
        // Don't 500 — the link IS valid. The learner can scan the QR
        // (which is rendered from the response URL) or paste the URL
        // manually. Surfacing the failure as a soft warning lets the
        // frontend offer a "didn't get the email? Try again or use
        // QR" affordance.
        return res.status(200).json({
          ok: true,
          url,
          warn: "EMAIL_SEND_FAILED",
        });
      }
    }

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/anon/laptop-link/redeem — single-use redemption.
//
// The /start page calls this with the token from `?invite=<token>` to
// fetch the lesson-1 code + name (so it can re-stash both before
// forwarding to signup). The DB-level UPDATE flips redeemed_at
// atomically, so concurrent calls only ever see one success.
//
// Response shapes:
//   200 { code, name | null }       — success, single-use redemption
//   404 { error: "INVITE_NOT_FOUND" } — bad token (typo, never existed)
//   410 { error: "INVITE_EXPIRED" }  — past expires_at
//   410 { error: "INVITE_USED" }     — already redeemed (replay attempt)
//   503 { error: "ANON_LAPTOP_INVITE_DISABLED" } — kill switch
//
// We do NOT return the raw email or email_hash — the privacy invariant
// holds end-to-end. The user types their email again on signup (they
// just sent it to themselves moments ago, so it's fresh in memory).
// ---------------------------------------------------------------------------

const redeemBodySchema = z
  .object({
    token: z.string().regex(/^[a-z2-9]{12}$/, "must be a 12-char token"),
  })
  .strict();

anonLaptopInviteRouter.post("/laptop-link/redeem", async (req, res, next) => {
  try {
    if (await isAnonLaptopInviteDisabled()) {
      return res.status(503).json({ error: "ANON_LAPTOP_INVITE_DISABLED" });
    }

    const parsed = redeemBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }
    const { token } = parsed.data;

    const invite = await getAnonLaptopInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ error: "INVITE_NOT_FOUND" });
    }
    if (invite.redeemedAt !== null) {
      return res.status(410).json({ error: "INVITE_USED" });
    }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: "INVITE_EXPIRED" });
    }

    const flipped = await markAnonLaptopInviteRedeemed(token);
    if (!flipped) {
      // Race: another concurrent redeem won. From the client's POV
      // this is identical to "already used."
      return res.status(410).json({ error: "INVITE_USED" });
    }

    return res.status(200).json({
      code: invite.code,
      name: invite.name,
    });
  } catch (err) {
    next(err);
  }
});

function buildPlainTextEmail(url: string, name: string | null): string {
  const greeting = name ? `Hey ${name},` : "Hey,";
  return [
    greeting,
    "",
    "Lesson 2 needs more screen — open this on your laptop and pick up",
    "right where you left off:",
    "",
    url,
    "",
    "This link expires in 24 hours and works exactly once. If you need",
    "another, head back to the lesson on your phone and tap 'Send link'",
    "again.",
    "",
    "— CodeTutor",
  ].join("\n");
}

function buildHtmlEmail(url: string, name: string | null): string {
  const greeting = name ? `Hey ${escapeHtml(name)},` : "Hey,";
  // Plain HTML — no logo / fancy template. The point of the email is
  // the link; everything else is overhead. ACS will inline plaintext
  // automatically as the multipart fallback.
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;">
  <p>${greeting}</p>
  <p>Lesson 2 needs more screen — open this on your laptop and pick up right where you left off:</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Continue on laptop →</a></p>
  <p style="color:#666;font-size:13px;">Or paste this URL: <code style="background:#f5f5f5;padding:2px 4px;border-radius:3px;">${escapeHtml(url)}</code></p>
  <p style="color:#666;font-size:13px;">This link expires in 24 hours and works exactly once. If you need another, head back to the lesson on your phone and tap "Send link" again.</p>
  <p style="color:#666;font-size:13px;">— CodeTutor</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
