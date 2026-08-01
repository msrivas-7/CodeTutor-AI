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
      expect(ctaUrl.pathname).toBe(
        "/try/lesson/python-fundamentals/hello-world",
      );
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
        anonPage.getByText("A learner on CodeTutor AI"),
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
      await expect(anonPage).toHaveTitle("Share not found · CodeTutor AI");
      // Recovery CTA is present so a misdirected visitor still has
      // somewhere to go.
      await expect(
        anonPage.getByRole("link", { name: /try the first lesson/i }),
      ).toBeVisible();
      await expect(
        anonPage.getByRole("link", {
          name: "Go to CodeTutor AI home",
          exact: true,
        }),
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
      await expect(
        anonPage.getByText(/invalid or no longer public/i),
      ).toBeVisible();
    } finally {
      await anon.close();
    }
  });

  test("temporary share failure offers a real retry without losing the link", async ({
    context,
  }) => {
    const anon = await context.browser()!.newContext();
    try {
      const anonPage = await anon.newPage();
      let requests = 0;
      let recovered = false;
      await anonPage.route("**/api/shares/aaaaaaaaaaaa", async (route) => {
        requests += 1;
        await route.fulfill({
          // React development Strict Mode may mount the initial effect
          // twice. Keep every initial request in the same outage state;
          // only the explicit learner action changes the boundary.
          status: recovered ? 404 : 503,
          contentType: "application/json",
          body: JSON.stringify({ error: recovered ? "Not found" : "Unavailable" }),
        });
      });

      await anonPage.goto("/s/aaaaaaaaaaaa");
      const failureHeading = anonPage.getByRole("heading", {
        name: /couldn't load this share/i,
      });
      await expect(failureHeading).toBeVisible();
      await expect(failureHeading).toBeFocused();
      await expect(anonPage).toHaveTitle(
        "Couldn't load this share · CodeTutor AI",
      );
      await expect(
        anonPage.getByText(/link may still work/i),
      ).toBeVisible();

      const requestsBeforeRetry = requests;
      recovered = true;
      await anonPage.getByRole("button", { name: /try again/i }).click();
      await expect(
        anonPage.getByRole("heading", { name: /share not found/i }),
      ).toBeVisible();
      await expect(anonPage).toHaveURL(/\/s\/aaaaaaaaaaaa$/);
      expect(requests).toBe(requestsBeforeRetry + 1);
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
    "existing public share is restored, editable, replaceable, and revocable",
    criticalTest({
      risk: "p1",
      owner: "share",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async () => undefined },
        });
      });
      await loadProfile(page, "empty");
      await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
        status: "completed",
        lastCode: { "main.py": SAMPLE_CODE },
      });
      const original = await createShare({ displayName: "Mehul" });

      // A fresh lesson mount is the post-login boundary: authoritative
      // owner state must replace the plain Publish affordance.
      await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
      const existingShare = page
        .getByRole("button", {
          name: /view existing share for( | this )lesson/i,
        })
        .first();
      await expect(existingShare).toBeVisible({ timeout: 10_000 });
      await expect(existingShare).toContainText(/shared/i);
      await existingShare.click();

      const shareUrl = page.getByLabel("Share URL");
      const originalPublicUrl = new URL(original.url, page.url()).toString();
      await expect(shareUrl).toHaveValue(originalPublicUrl);
      await expect(shareUrl).toBeFocused();
      await expect(
        page.getByRole("heading", { name: "Manage public share" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Copy", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /copied/i }),
      ).toBeVisible();

      const nameToggle = page.getByRole("checkbox", { name: /show my name/i });
      await expect(nameToggle).toBeChecked();
      // The checkbox reflects authoritative owner state after the async
      // update returns, so exercise the user click and assert the settled
      // result instead of requiring an immediate uncontrolled DOM flip.
      await nameToggle.click();
      await expect(page.getByText("Currently anonymous.")).toBeVisible();
      await expect(nameToggle).not.toBeChecked();

      const refresh = page.getByRole("button", {
        name: /update shared code/i,
      });
      await refresh.click();
      await expect(refresh).toBeEnabled();

      await page
        .getByRole("button", { name: "Replace public link", exact: true })
        .click();
      let rotateDialog = page.getByRole("alertdialog");
      await expect(
        rotateDialog.getByRole("heading", { name: /replace the public link/i }),
      ).toBeVisible();
      const cancelRotate = rotateDialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await expect(cancelRotate).toBeFocused();
      await cancelRotate.click();
      await expect(rotateDialog).toHaveCount(0);
      const replaceLink = page.getByRole("button", {
        name: "Replace public link",
        exact: true,
      });
      await expect(replaceLink).toBeFocused();

      await replaceLink.click();
      rotateDialog = page.getByRole("alertdialog");
      await rotateDialog
        .getByRole("button", { name: "Replace link", exact: true })
        .click();
      await expect(rotateDialog).toHaveCount(0);
      await expect(shareUrl).toBeFocused();
      await expect(shareUrl).not.toHaveValue(originalPublicUrl);
      const replacementUrl = await shareUrl.inputValue();
      expect(replacementUrl).toMatch(/\/s\/[a-z0-9]{12}$/);
      expect(
        (
          await page.request.get(
            `${BACKEND}/api/shares/${original.shareToken}`,
          )
        ).status(),
      ).toBe(404);

      const stopInDialog = page.getByRole("button", {
        name: /stop sharing publicly/i,
      });
      await stopInDialog.click();
      let revokeDialog = page.getByRole("alertdialog");
      await expect(
        revokeDialog.getByRole("heading", { name: /stop sharing this lesson/i }),
      ).toBeVisible();
      const cancelRevoke = revokeDialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await expect(cancelRevoke).toBeFocused();
      await cancelRevoke.click();
      await expect(revokeDialog).toHaveCount(0);
      await expect(stopInDialog).toBeFocused();

      // The Settings inventory is the durable off-ramp after leaving a
      // lesson or signing in again. Exercise its reversible confirmation
      // and final removal rather than relying only on the lesson dialog.
      await page
        .getByRole("button", { name: "Close share dialog", exact: true })
        .click();
      await page.getByRole("button", { name: /user menu for/i }).click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "My public shares", exact: true }),
      ).toBeVisible();
      const inventoryStop = page.getByRole("button", {
        name: "Stop sharing",
        exact: true,
      });
      await inventoryStop.click();
      let inventoryConfirm = page.getByRole("button", {
        name: "Stop sharing",
        exact: true,
      });
      await expect(inventoryConfirm).toBeFocused();
      await page
        .getByRole("button", { name: "Keep public", exact: true })
        .click();
      await expect(inventoryStop).toBeFocused();

      await inventoryStop.click();
      inventoryConfirm = page.getByRole("button", {
        name: "Stop sharing",
        exact: true,
      });
      await expect(inventoryConfirm).toBeFocused();
      await inventoryConfirm.click();
      await expect(page.getByText("You have no public lesson pages.")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "My public shares", exact: true }),
      ).toBeFocused();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      revokeDialog = page.getByRole("alertdialog");
      await expect(revokeDialog).toHaveCount(0);
      const replacementToken = new URL(replacementUrl).pathname.split("/").pop();
      expect(replacementToken).toMatch(/^[a-z0-9]{12}$/);
      expect(
        (
          await page.request.get(
            `${BACKEND}/api/shares/${replacementToken}`,
          )
        ).status(),
      ).toBe(404);
    },
  );

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
