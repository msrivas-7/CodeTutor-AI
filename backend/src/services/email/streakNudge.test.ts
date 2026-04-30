import { describe, expect, it, beforeEach, vi } from "vitest";

// Phase 22D: streak-nudge template contract tests.
//
// `buildStreakNudge` is a pure function — given the same input, returns
// the same { subject, text, html, headers, replyTo, displayName,
// deepLink, unsubscribeUrl }. Tests mock config so URL-derived fields
// don't depend on env, and cover:
//   - canonical subject/preheader stay locked
//   - pluralization (1 day vs N days)
//   - firstName fallback to "there" for missing/blank names
//   - deep link computed from course+lesson when present, else /start
//   - URL encoding of slug-safe-but-untrusted ids
//   - List-Unsubscribe + List-Unsubscribe-Post headers present
//   - HTML escaping defends against a hostile firstName
//   - sendStreakNudge passes the right shape to acsClient

vi.mock("../../config.js", () => ({
  config: {
    corsOrigin: "https://codetutor.test",
    email: {
      acsConnectionString: "endpoint=x;accesskey=y",
      acsSenderEmail: "noreply@mail.codetutor.test",
      operatorAlertEmail: "ops@codetutor.test",
      unsubscribeSecret: "test-secret-streak-nudge",
      streakNudgeFromName: "CodeTutor",
      streakNudgeReplyTo: "support@codetutor.test",
      streakNudgeDisabled: false,
    },
  },
}));

const mockSendEmail = vi.fn();
vi.mock("./acsClient.js", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// Phase 23 P1 #10: stub the operator-outbox DB write so unit tests don't
// hit a real Postgres. Failure of this insert is non-fatal in production
// (logged + swallowed) but the test mock should resolve cleanly so we
// can also assert callers pass the expected shape on the happy path.
const mockInsertEmailSentLog = vi.fn();
vi.mock("../../db/emailSentLog.js", () => ({
  insertEmailSentLog: (...args: unknown[]) => mockInsertEmailSentLog(...args),
}));

import { buildStreakNudge, sendStreakNudge } from "./streakNudge.js";

const baseInput = {
  email: "learner@test.dev",
  userId: "u-123",
  firstName: "Mehul",
  currentStreak: 5,
  lastCourseId: "python-fundamentals",
  lastLessonId: "loops",
};

beforeEach(() => {
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ id: "op-abc" });
  mockInsertEmailSentLog.mockReset();
  mockInsertEmailSentLog.mockResolvedValue(undefined);
});

describe("buildStreakNudge — canonical pieces", () => {
  it("subject is the locked tagline", () => {
    expect(buildStreakNudge(baseInput).subject).toBe(
      "Picking up where you left off",
    );
  });

  it("renders Reply-To and From display name from config", () => {
    const built = buildStreakNudge(baseInput);
    expect(built.replyTo).toBe("support@codetutor.test");
    expect(built.displayName).toBe("CodeTutor");
  });

  it("includes both List-Unsubscribe headers (Gmail one-click button)", () => {
    const built = buildStreakNudge(baseInput);
    expect(built.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/codetutor\.test\/api\/email\/unsubscribe\?token=.+>$/,
    );
    expect(built.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });

  it("plaintext + html both contain the deep link and unsubscribe url", () => {
    const built = buildStreakNudge(baseInput);
    expect(built.text).toContain(built.deepLink);
    expect(built.text).toContain(built.unsubscribeUrl);
    expect(built.html).toContain(built.deepLink);
    expect(built.html).toContain(built.unsubscribeUrl);
  });

  it("plaintext salutation uses the firstName", () => {
    expect(buildStreakNudge(baseInput).text).toContain("Hi Mehul,");
  });
});

describe("buildStreakNudge — pluralization", () => {
  it("'1 day' for streak == 1 (no trailing s)", () => {
    const built = buildStreakNudge({ ...baseInput, currentStreak: 1 });
    expect(built.text).toContain("You're 1 day in,");
    expect(built.text).not.toContain("You're 1 days in,");
  });

  it("'N days' for streak >= 2", () => {
    expect(buildStreakNudge({ ...baseInput, currentStreak: 2 }).text).toContain(
      "You're 2 days in,",
    );
    expect(buildStreakNudge({ ...baseInput, currentStreak: 47 }).text).toContain(
      "You're 47 days in,",
    );
  });
});

describe("buildStreakNudge — firstName fallback", () => {
  it("uses 'there' when firstName is null", () => {
    const built = buildStreakNudge({ ...baseInput, firstName: null });
    expect(built.text).toContain("Hi there,");
  });

  it("uses 'there' when firstName is whitespace-only", () => {
    const built = buildStreakNudge({ ...baseInput, firstName: "   " });
    expect(built.text).toContain("Hi there,");
  });

  it("trims whitespace around a real firstName", () => {
    const built = buildStreakNudge({ ...baseInput, firstName: "  Ada  " });
    expect(built.text).toContain("Hi Ada,");
  });
});

describe("buildStreakNudge — deep link", () => {
  it("composes /learn/course/<id>/lesson/<id> when both ids present", () => {
    const built = buildStreakNudge(baseInput);
    expect(built.deepLink).toBe(
      "https://codetutor.test/learn/course/python-fundamentals/lesson/loops",
    );
  });

  it("falls back to /start when last_lesson_id is missing", () => {
    const built = buildStreakNudge({
      ...baseInput,
      lastCourseId: "python-fundamentals",
      lastLessonId: null,
    });
    expect(built.deepLink).toBe("https://codetutor.test/start");
  });

  it("falls back to /start when last_course_id is missing", () => {
    const built = buildStreakNudge({
      ...baseInput,
      lastCourseId: null,
      lastLessonId: "loops",
    });
    expect(built.deepLink).toBe("https://codetutor.test/start");
  });

  it("falls back to /start when both ids are null", () => {
    const built = buildStreakNudge({
      ...baseInput,
      lastCourseId: null,
      lastLessonId: null,
    });
    expect(built.deepLink).toBe("https://codetutor.test/start");
  });

  it("URL-encodes ids that contain reserved characters (defense-in-depth)", () => {
    const built = buildStreakNudge({
      ...baseInput,
      lastCourseId: "intro & friends",
      lastLessonId: "lesson 2/of/3",
    });
    expect(built.deepLink).toBe(
      "https://codetutor.test/learn/course/intro%20%26%20friends/lesson/lesson%202%2Fof%2F3",
    );
  });
});

describe("buildStreakNudge — HTML safety", () => {
  it("escapes a hostile firstName so it can't break out of the salutation", () => {
    const built = buildStreakNudge({
      ...baseInput,
      firstName: '"><script>alert(1)</script>',
    });
    // The raw payload must not appear as a runnable script tag in the HTML.
    expect(built.html).not.toContain("<script>alert(1)</script>");
    // Escaped form must be present.
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("escapes a hostile firstName in plaintext too (no double-escaping)", () => {
    const built = buildStreakNudge({
      ...baseInput,
      firstName: "<<crash>>",
    });
    // Plaintext doesn't escape — it preserves the user's literal name in
    // the salutation. The HTML version is the one that escapes.
    expect(built.text).toContain("Hi <<crash>>,");
  });
});

describe("sendStreakNudge — wiring", () => {
  it("calls acsClient.sendEmail with the built fields + Reply-To + headers", async () => {
    const result = await sendStreakNudge(baseInput);
    expect(result).toEqual(
      expect.objectContaining({
        id: "op-abc",
        deepLink: expect.any(String),
        unsubscribeUrl: expect.any(String),
      }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0]?.[0];
    expect(arg).toEqual(
      expect.objectContaining({
        to: "learner@test.dev",
        subject: "Picking up where you left off",
        replyTo: "support@codetutor.test",
        text: expect.stringContaining("Hi Mehul"),
        html: expect.stringContaining("Hi Mehul"),
        headers: expect.objectContaining({
          "List-Unsubscribe": expect.any(String),
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }),
      }),
    );
    // displayName is intentionally NOT forwarded — ACS rejects the
    // friendly-from form on our verified domain.
    expect(arg).not.toHaveProperty("displayName");
  });

  it("propagates a downstream sendEmail failure (caller decides retry)", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("ACS 500"));
    await expect(sendStreakNudge(baseInput)).rejects.toThrow("ACS 500");
    // Outbox should NOT be written when the ACS call itself failed —
    // there's nothing meaningful to record (no opId, send didn't happen).
    expect(mockInsertEmailSentLog).not.toHaveBeenCalled();
  });

  // Phase 23 P1 #10: operator outbox.
  it("writes an email_sent_log row with the rendered body + ACS opId on success", async () => {
    const result = await sendStreakNudge(baseInput);
    expect(result.id).toBe("op-abc");
    expect(mockInsertEmailSentLog).toHaveBeenCalledTimes(1);
    const arg = mockInsertEmailSentLog.mock.calls[0]?.[0];
    expect(arg).toEqual(
      expect.objectContaining({
        userId: "u-123",
        kind: "streak_nudge",
        toEmail: "learner@test.dev",
        subject: "Picking up where you left off",
        textBody: expect.stringContaining("Hi Mehul"),
        htmlBody: expect.stringContaining("Hi Mehul"),
        acsOpId: "op-abc",
      }),
    );
  });

  it("does NOT throw when the outbox insert fails (logging is non-fatal)", async () => {
    mockInsertEmailSentLog.mockRejectedValueOnce(new Error("DB down"));
    // The send should still resolve cleanly because the user already
    // got the email; the audit-log insert is best-effort.
    await expect(sendStreakNudge(baseInput)).resolves.toMatchObject({
      id: "op-abc",
    });
  });
});
