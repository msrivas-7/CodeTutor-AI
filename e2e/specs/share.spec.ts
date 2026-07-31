// Phase 21C: cinematic share e2e. Exercises:
//   - the LessonCompletePanel "Share this win" button is shown only
//     when there's code to share (not in practice mode, lastCode set).
//   - opening the dialog shows the in-browser preview + opt-in toggle.
//   - "Make public & share" creates a server-side share, surfaces the
//     URL, and the dialog enters its post-create state with copy +
//     view-page affordances.
//   - the public /s/:token route renders for anonymous visitors —
//     shows lesson title, course context, code, mastery ring, CTA.
//   - the page sets the right OG meta tags client-side.
//   - revoked / unknown tokens render the "Share not found" empty
//     state instead of the cinematic.
//
// We use seedLessonProgress + a direct backend POST to create the share
// row in some tests so we can stand up the read path without driving
// the full UI flow each time.

import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { getWorkerUser } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import { criticalTest } from "../fixtures/testMetadata";
import {
  BACKEND,
  loadProfile,
  markOnboardingDone,
  newBackendContext,
  seedLessonProgress,
} from "../fixtures/profiles";

const COURSE_ID = "python-fundamentals";
const LESSON_ID = "hello-world";

const SAMPLE_CODE = `def greet(name):
    # Returns a friendly hello.
    return f"Hello, {name}!"

print(greet("Mehul"))`;

async function authedCtx(): Promise<{
  ctx: APIRequestContext;
  token: string;
}> {
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const ctx = await newBackendContext();
  return { ctx, token: user.session.access_token };
}

async function createShare(opts: {
  // Post-audit: lesson title / order / course title / total are NOT
  // part of the wire schema anymore — backend looks them up canonically
  // from the published course catalog (services/share/lessonCatalog.ts).
  // Tests assert against the canonical values, so only fields the
  // server still accepts are sent.
  mastery?: "strong" | "okay" | "shaky";
  timeSpentMs?: number;
  attemptCount?: number;
  codeSnippet?: string;
  displayName?: string | null;
} = {}): Promise<{ shareToken: string; url: string }> {
  const { ctx, token } = await authedCtx();
  try {
    const res = await ctx.post(`${BACKEND}/api/shares`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        courseId: COURSE_ID,
        lessonId: LESSON_ID,
        mastery: opts.mastery ?? "strong",
        timeSpentMs: opts.timeSpentMs ?? 360_000,
        attemptCount: opts.attemptCount ?? 1,
        codeSnippet: opts.codeSnippet ?? SAMPLE_CODE,
        displayName: opts.displayName ?? null,
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as { shareToken: string; url: string };
  } finally {
    await ctx.dispose();
  }
}

async function revokeShare(shareToken: string): Promise<void> {
  const { ctx, token } = await authedCtx();
  try {
    await ctx.delete(`${BACKEND}/api/shares/${shareToken}`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${token}`,
      },
    });
  } finally {
    await ctx.dispose();
  }
}

test.describe("Phase 21C: cinematic share", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test(
    "created share is visible at /s/:token to anonymous visitors",
    criticalTest({
      risk: "p1",
      owner: "share",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page, context }) => {
    // Seed via the backend so the row exists (with snapshot fields).
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      attemptCount: 1,
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const { shareToken } = await createShare({});

    // Use a fresh, unauthenticated context — anon read path.
    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/${shareToken}`);
      // Lesson title — solid success-green Fraunces. Renders as the
      // dominant H1 on the page.
      await expect(
        anonPage.getByRole("heading", { name: "Hello, World!" }),
      ).toBeVisible({ timeout: 10_000 });
      // Course context eyebrow.
      await expect(
        anonPage.getByText(/Python Fundamentals · Lesson 1 of 12/),
      ).toBeVisible();
      // CTA — "Try this lesson" copy with utm tracking on the link.
      const cta = anonPage.getByRole("link", {
        name: /Try this lesson/i,
      });
      await expect(cta).toBeVisible();
      const href = await cta.getAttribute("href");
      expect(href).not.toBeNull();
      const ctaUrl = new URL(href!);
      expect(ctaUrl.searchParams.get("utm_source")).toBe("share");
      expect(ctaUrl.searchParams.get("utm_medium")).toBe("lesson_share");
      expect(ctaUrl.searchParams.get("utm_campaign")).toBe(COURSE_ID);
      expect(ctaUrl.searchParams.get("utm_content")).toBe(LESSON_ID);
      expect(ctaUrl.searchParams.get("share_ref")).toBe(shareToken);
    } finally {
      await anon.close();
    }
    },
  );

  test("display name is hidden by default — anonymous attribution", async ({
    page,
    context,
  }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const { shareToken } = await createShare({ displayName: null });

    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/${shareToken}`);
      await expect(
        anonPage.getByText("A learner on CodeTutor"),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await anon.close();
    }
  });

  test("display name is shown when opted-in at create time", async ({
    page,
    context,
  }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const { shareToken } = await createShare({ displayName: "Mehul" });

    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/${shareToken}`);
      await expect(anonPage.getByText("Mehul").first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await anon.close();
    }
  });

  test(
    "revoked share renders the not-found empty state",
    criticalTest({
      risk: "p1",
      owner: "share",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page, context }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const { shareToken } = await createShare({});
    await revokeShare(shareToken);

    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/${shareToken}`);
      await expect(
        anonPage.getByRole("heading", { name: /Share not found/i }),
      ).toBeVisible({ timeout: 10_000 });
      // Recovery CTA is present so a misdirected visitor still has
      // somewhere to go.
      await expect(
        anonPage.getByRole("button", { name: /Go to CodeTutor/i }),
      ).toBeVisible();
    } finally {
      await anon.close();
    }
    },
  );

  test("unknown token renders the not-found empty state", async ({
    context,
  }) => {
    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/aaaaaaaaaaaa`); // valid shape, no row
      await expect(
        anonPage.getByRole("heading", { name: /Share not found/i }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await anon.close();
    }
  });

  test("completed lesson page shows persistent Share affordance in header", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      attemptCount: 1,
      lastCode: { "main.py": SAMPLE_CODE },
    });
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    // Header chip group renders ✓ Completed; the share affordance
    // appears alongside it. Aria-label flips between "Open share
    // dialog…" (no existing share) and "View existing share…" (the
    // pre-fetch found one). Either reading proves the chip mounted.
    await expect(
      page.getByRole("button", {
        name: /(Open share dialog|View existing share) for( | this )lesson/i,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Story-format image is generated and downloadable", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const { shareToken } = await createShare({});

    // Poll the GET endpoint until ogStoryImageUrl lands. The fire-
    // and-forget render+upload pipeline takes ~2-3s; allow up to 30s.
    const { ctx, token } = await authedCtx();
    let storyUrl: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await ctx.get(`${BACKEND}/api/shares/${shareToken}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = (await res.json()) as { ogStoryImageUrl: string | null };
      if (body.ogStoryImageUrl) {
        storyUrl = body.ogStoryImageUrl;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await ctx.dispose();
    expect(storyUrl).toBeTruthy();

    // Fetch the image directly to confirm it's a real PNG. The public
    // URL points at Supabase Storage's public bucket.
    const fetched = await page.request.get(storyUrl!);
    expect(fetched.ok()).toBeTruthy();
    expect(fetched.headers()["content-type"]).toContain("image/png");
    const buf = await fetched.body();
    // PNG magic header.
    expect(
      buf.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    // 9:16 PNG should be larger than the OG (which is what the prior
    // 5KB lower bound caught for the smaller card).
    expect(buf.byteLength).toBeGreaterThan(8_000);
  });

  test("a second share for the same lesson reuses the first token", async ({
    page,
  }) => {
    // Per user feedback: the dialog shouldn't mint a fresh token each
    // time the user clicks Share for the same lesson. The "have I
    // already shared this?" lookup catches this.
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    const first = await createShare({});
    // Direct GET against the lookup endpoint — simulates what the
    // dialog does on open.
    const { ctx, token } = await authedCtx();
    try {
      const res = await ctx.get(
        `${BACKEND}/api/shares/mine?courseId=${COURSE_ID}&lessonId=${LESSON_ID}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as { shareToken: string };
      expect(body.shareToken).toBe(first.shareToken);
    } finally {
      await ctx.dispose();
    }
  });

  test(
    "OG meta tags reflect canonical share data (server lookup)",
    criticalTest({
      risk: "p1",
      owner: "share",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page, context }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
      status: "completed",
      lastCode: { "main.py": SAMPLE_CODE },
    });
    // Title comes from the catalog (lesson.json) — client can't spoof
    // it. For python-fundamentals/hello-world that's "Hello, World!".
    const { shareToken } = await createShare({ displayName: "Mehul" });

    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/s/${shareToken}`);
      // Wait for the React effect that sets meta tags to flush.
      await expect(anonPage).toHaveTitle(/Mehul finished Hello, World!/, {
        timeout: 10_000,
      });
      const ogTitle = await anonPage
        .locator('meta[property="og:title"]')
        .getAttribute("content");
      expect(ogTitle).toContain("Mehul finished Hello, World!");
      const twitterCard = await anonPage
        .locator('meta[name="twitter:card"]')
        .getAttribute("content");
      expect(twitterCard).toBe("summary_large_image");
    } finally {
      await anon.close();
    }
    },
  );
});
