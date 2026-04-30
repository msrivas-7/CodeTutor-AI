import { config } from "../../config.js";
import { insertEmailSentLog } from "../../db/emailSentLog.js";
import { sendEmail, type SendEmailOptions } from "./acsClient.js";
import { signUnsubscribeToken } from "./unsubscribeTokens.js";

// Phase 22D: streak re-engagement email — the "picking up where you left
// off" nudge sent by digestSweeper at 18:00 UTC daily to users whose
// streak slipped yesterday.
//
// The template is intentionally minimal: subject as a complete sentence,
// preheader as a quiet description, body with one CTA. Linear / Stripe
// register, not SaaS-y "DON'T BREAK YOUR STREAK!!" energy.
//
// Two render targets always produced together:
//   1. plaintext — the canonical body. Mail clients that don't render
//      HTML (or strip it) get a fully-functional message with a working
//      link.
//   2. HTML — same content, brand-aligned typography and one accent
//      gradient on the CTA. Inline styles only (every mail client
//      strips <style> blocks). Dark background + light text matches the
//      product's atmosphere; mail clients that force light mode will
//      invert via the `color-scheme` meta and `prefers-color-scheme`
//      media query.
//
// `buildStreakNudge` is a pure function for unit testing — gives back
// `{ subject, text, html, replyTo, displayName, headers }` ready to pass
// into the ACS client. `sendStreakNudge` is the side-effecting wrapper
// the digest sweeper calls.

const SUBJECT = "Picking up where you left off";
const PREHEADER = "A short lesson, when you've got the time.";
const FROM_LABEL_SIGNOFF = "— CodeTutor";

export interface StreakNudgeInput {
  /** Recipient email. Required. */
  email: string;
  /** Supabase user id — used to mint the unsubscribe token. */
  userId: string;
  /** First name for the salutation. Falls back to "there" if missing. */
  firstName: string | null;
  /** Current streak length. The body pluralizes ("1 day" vs "N days"). */
  currentStreak: number;
  /** The user's last touched course id, or null if they have no
   *  course_progress row yet. Drives the deep link. */
  lastCourseId: string | null;
  /** The user's last touched lesson id, or null. Combined with
   *  lastCourseId to form the resume URL. */
  lastLessonId: string | null;
}

export interface BuiltStreakNudge {
  subject: string;
  text: string;
  html: string;
  /** Reply-To address — replies route to the operator inbox via
   *  iCloud Custom Email Domain on msrivas.com. */
  replyTo: string;
  /** Friendly From display name. */
  displayName: string;
  /** Headers for inbox-side one-click unsubscribe. Gmail / Apple Mail /
   *  Yahoo render an "Unsubscribe" button when both are present. */
  headers: Record<string, string>;
  /** The fully-resolved CTA URL. Exposed so callers can log/audit it
   *  during smoke tests. */
  deepLink: string;
  /** The unsubscribe URL (matches `List-Unsubscribe` URL too). */
  unsubscribeUrl: string;
}

function pluralizeDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function appBaseUrl(): string {
  // corsOrigin is the SPA's public URL — `https://codetutor.msrivas.com`
  // in prod, `http://localhost:5173` in dev. Trim trailing slash so URL
  // composition below stays clean.
  return config.corsOrigin.replace(/\/+$/, "");
}

function buildDeepLink(courseId: string | null, lessonId: string | null): string {
  const base = appBaseUrl();
  if (courseId && lessonId) {
    // Use encodeURIComponent for both segments — course/lesson ids in the
    // catalog are slug-safe today, but the URL builder shouldn't trust
    // that invariant.
    return `${base}/learn/course/${encodeURIComponent(courseId)}/lesson/${encodeURIComponent(lessonId)}`;
  }
  // Fallback when the user has no course_progress (or last_lesson_id is
  // null): /start has the ResumeLearningCard which surfaces next-up.
  return `${base}/start`;
}

function buildUnsubscribeUrl(userId: string): string {
  const token = signUnsubscribeToken(userId);
  return `${appBaseUrl()}/api/email/unsubscribe?token=${token}`;
}

/**
 * Pure builder. Renders the email but doesn't send it. Call from unit
 * tests to assert template correctness across the matrix of inputs
 * (named/anon firstName, 1-day vs N-day streak, with/without deep link).
 */
export function buildStreakNudge(input: StreakNudgeInput): BuiltStreakNudge {
  const { firstName, currentStreak, userId, lastCourseId, lastLessonId } = input;
  const greetName = firstName && firstName.trim() !== "" ? firstName.trim() : "there";
  const days = pluralizeDays(currentStreak);
  const deepLink = buildDeepLink(lastCourseId, lastLessonId);
  const unsubscribeUrl = buildUnsubscribeUrl(userId);
  const replyTo = config.email.streakNudgeReplyTo;
  const displayName = config.email.streakNudgeFromName;

  // Plaintext is the canonical body. Mail clients that strip HTML get a
  // fully working email with a working link. Two trailing newlines
  // between paragraphs keeps the "quiet" pacing in clients that
  // collapse single newlines.
  const text = [
    `Hi ${greetName},`,
    "",
    `You're ${days} in, and yesterday slipped past. Happens.`,
    "",
    "Five quiet minutes tonight, when you've got them:",
    "",
    `  Pick it up: ${deepLink}`,
    "",
    "The streak is a small thing. The work is here when you are.",
    "",
    FROM_LABEL_SIGNOFF,
    "",
    "—",
    "You're getting this because streak nudges are on in your CodeTutor",
    "settings. Turn them off any time:",
    unsubscribeUrl,
    "",
    `Questions? Reply to this email — ${replyTo}`,
    "",
  ].join("\n");

  // HTML body — single column, 600px max, dark surface. Inline styles
  // only. The hidden preheader span at the top sets the inbox-preview
  // text without showing in the rendered body.
  const html = renderHtml({
    greetName,
    days,
    deepLink,
    unsubscribeUrl,
    replyTo,
  });

  return {
    subject: SUBJECT,
    text,
    html,
    replyTo,
    displayName,
    headers: {
      // RFC 8058 — modern mail clients render an inbox "Unsubscribe"
      // button when both are present. The Post variant signals
      // one-click unsubscribe is supported (route accepts GET; clients
      // that POST will hit the same handler). v1 just supports GET; the
      // header alone improves Gmail's deliverability scoring.
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    deepLink,
    unsubscribeUrl,
  };
}

/**
 * Render the HTML body. Kept as a separate function so the template is
 * easy to find at a glance. Inline styles only — `<style>` blocks are
 * stripped by Gmail and several mobile clients.
 *
 * The dark theme matches the product's atmosphere. `color-scheme: dark`
 * + `prefers-color-scheme: dark` media query in the meta tells modern
 * clients (Apple Mail, Gmail iOS) not to force-invert the colors. Some
 * older Outlook builds will still invert; the brand is dark-first but
 * the plaintext fallback covers that audience.
 */
function renderHtml(args: {
  greetName: string;
  days: string;
  deepLink: string;
  unsubscribeUrl: string;
  replyTo: string;
}): string {
  const { greetName, days, deepLink, unsubscribeUrl, replyTo } = args;
  // Body styles — inline-friendly. System font stacks (Inter/SF/Roboto
  // for body, Charter/Georgia for the salutation) — no web-fonts in
  // mail because client support is unreliable.
  const bodyFont =
    "'Inter','-apple-system','BlinkMacSystemFont','Segoe UI','Roboto','Helvetica Neue',Arial,sans-serif";
  const serifFont =
    "'Charter','Georgia','Times New Roman',serif";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0e22;color:#e6ecf5;-webkit-font-smoothing:antialiased;">
  <!-- Hidden preheader: shows as the inbox-preview line beside the subject -->
  <span style="display:none;font-size:1px;color:#0a0e22;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(PREHEADER)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0e22;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:24px 8px 8px 8px;font-family:${serifFont};font-size:18px;line-height:1.5;color:#e6ecf5;">
              Hi ${escapeHtml(greetName)},
            </td>
          </tr>
          <tr>
            <td style="padding:8px 8px 8px 8px;font-family:${bodyFont};font-size:15px;line-height:1.65;color:#e6ecf5;">
              You're ${escapeHtml(days)} in, and yesterday slipped past. Happens.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px 8px 8px;font-family:${bodyFont};font-size:15px;line-height:1.65;color:#e6ecf5;">
              Five quiet minutes tonight, when you've got them:
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 8px 24px 8px;">
              <a href="${escapeAttr(deepLink)}"
                 style="display:inline-block;padding:14px 28px;border-radius:9999px;
                        background-image:linear-gradient(90deg,#38bdf8 0%,#7dd3fc 50%,#c084fc 100%);
                        background-color:#38bdf8;
                        color:#0a0e22;text-decoration:none;
                        font-family:${bodyFont};font-size:15px;font-weight:600;letter-spacing:-0.005em;">
                Pick it up &rarr;
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 8px 24px 8px;font-family:${bodyFont};font-size:15px;line-height:1.65;color:#e6ecf5;">
              The streak is a small thing. The work is here when you are.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 8px 32px 8px;font-family:${serifFont};font-size:15px;line-height:1.5;color:#e6ecf5;">
              ${escapeHtml(FROM_LABEL_SIGNOFF)}
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #1f2937;padding:20px 8px 6px 8px;font-family:${bodyFont};font-size:12px;line-height:1.6;color:#94a3b8;">You're getting this because streak nudges are on in your CodeTutor settings. <a href="${escapeAttr(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Turn them off</a>.</td>
          </tr>
          <tr>
            <td style="padding:6px 8px 24px 8px;font-family:${bodyFont};font-size:12px;line-height:1.6;color:#94a3b8;">Questions? Just reply &mdash; <a href="mailto:${escapeAttr(replyTo)}" style="color:#94a3b8;text-decoration:underline;">${escapeHtml(replyTo)}</a></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Minimal HTML escaping for substituted values. Conservative — escapes
// the five XML metacharacters. Substituted values come from auth.users
// metadata + course/lesson ids, so user-controlled `firstName` is the
// only realistic XSS vector. We escape it anyway.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Conservative attribute escape — also escapes the same set, so it's
// safe to use in `href="…"` and `value="…"` slots. Distinct from
// escapeHtml only by intent (not by behavior); both are XSS-safe.
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Side-effecting wrapper. Builds the email and sends via ACS. Returns
 * the operationId from ACS for log correlation; throws on send failure
 * (caller decides whether to retry — digestSweeper does NOT retry on
 * the same day because tomorrow's cron will catch the user again).
 */
export async function sendStreakNudge(
  input: StreakNudgeInput,
): Promise<{ id: string; deepLink: string; unsubscribeUrl: string }> {
  const built = buildStreakNudge(input);
  // Don't pass displayName to ACS — our verified domain rejects the
  // RFC-5322 `Name <addr>` form on senderAddress with a "Request body
  // validation error. See property 'senderAddress'". The friendly From
  // name shows up in inboxes via the domain's ACS-side display-name
  // config anyway. `built.displayName` is still exposed on the builder
  // result for tests + future use if friendly-from-on-senderAddress is
  // ever enabled at the resource level.
  const opts: SendEmailOptions = {
    to: input.email,
    subject: built.subject,
    text: built.text,
    html: built.html,
    replyTo: built.replyTo,
    headers: built.headers,
  };
  const { id } = await sendEmail(opts);

  // Phase 23 P1 #10: operator outbox. Persist a copy of what we shipped
  // so we can audit later (ACS doesn't expose body content; the verified
  // sender domain isn't a real mailbox). Log failure is non-fatal — the
  // user already got the email; we'd rather have a missing audit row
  // than throw on a successful send.
  try {
    await insertEmailSentLog({
      userId: input.userId,
      kind: "streak_nudge",
      toEmail: input.email,
      subject: built.subject,
      textBody: built.text,
      htmlBody: built.html,
      acsOpId: id,
    });
  } catch (err) {
    console.error(
      `[streakNudge] email_sent_log insert failed for ${input.userId}: ${(err as Error).message}`,
    );
  }

  return { id, deepLink: built.deepLink, unsubscribeUrl: built.unsubscribeUrl };
}
