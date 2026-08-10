import { expect, test } from "@playwright/test";
import {
  loginAsAdminTestUser,
  removeAdminEmailPreviewFixture,
  seedAdminEmailPreviewFixture,
} from "../fixtures/auth";

test.describe("Q7 calm and trustworthy admin operations", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginAsAdminTestUser(page, testInfo.workerIndex);
  });

  test("audit history separates operational changes from routine reviews", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Operational history" })).toBeVisible();
    await expect(page.getByLabel("Activity")).toHaveValue("changes");
    await expect(page.getByText(/Routine tab and sample views live in Review activity/)).toBeVisible();

    await page.getByLabel("Activity").selectOption("reviews");
    await expect(page.getByLabel("Event type").locator('option[value="eval_sample_viewed"]')).toHaveCount(1);
    await expect(page.getByLabel("Event type").locator('option[value="system_config_set"]')).toHaveCount(0);

    await page.getByLabel("Activity").selectOption("changes");
    await expect(page.getByLabel("Event type").locator('option[value="system_config_set"]')).toHaveCount(1);
    await expect(page.getByLabel("Event type").locator('option[value="eval_sample_viewed"]')).toHaveCount(0);
  });

  test("users search and edit controls stay usable across pagination and phone layout", async ({
    page,
  }) => {
    const firstUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "alpha@example.test",
      displayName: "Alpha",
      createdAt: "2026-08-08T00:00:00.000Z",
      lastSignInAt: null,
      questionsToday: 1,
      usdToday: 0.01,
      usdLifetime: 0.5,
      override: null,
      denylisted: false,
    };
    const secondUser = {
      ...firstUser,
      id: "00000000-0000-4000-8000-000000000002",
      email: "beta@example.test",
      displayName: "Beta",
    };
    const searchedUser = {
      ...firstUser,
      id: "00000000-0000-4000-8000-000000000003",
      email: "needle@example.test",
      displayName: "Needle",
    };
    const listRequests: Array<{ page: string | null; search: string | null }> = [];

    await page.route("**/api/admin/users?**", async (route) => {
      const url = new URL(route.request().url());
      const requestedPage = url.searchParams.get("page");
      const search = url.searchParams.get("search");
      listRequests.push({ page: requestedPage, search });
      const users = search
        ? requestedPage === "1"
          ? [searchedUser]
          : []
        : requestedPage === "2"
          ? [secondUser]
          : [firstUser];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          users,
          page: Number(requestedPage ?? "1"),
          perPage: 25,
          hasMore: !search && requestedPage !== "2",
        }),
      });
    });
    await page.route(`**/api/admin/users/${searchedUser.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: searchedUser,
          questionsToday: searchedUser.questionsToday,
          usdToday: searchedUser.usdToday,
          usdLifetime: searchedUser.usdLifetime,
          override: null,
          denylisted: false,
          denylist: null,
        }),
      });
    });

    await page.goto("/admin/users");
    const searchInput = page.getByRole("searchbox", { name: "Search users" });
    const searchButton = page.getByRole("button", { name: "Search" });
    const nextButton = page.getByRole("button", { name: "Next →" });
    const firstEdit = page.getByRole("button", { name: "Edit" });
    await expect(searchInput).toBeVisible();
    await expect(firstEdit).toBeVisible();

    for (const control of [searchInput, searchButton, firstEdit, nextButton]) {
      await expect
        .poll(async () => (await control.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }

    await nextButton.click();
    await expect(page.getByText("beta@example.test")).toBeVisible();
    await searchInput.fill("needle");
    await searchInput.press("Enter");
    await expect(page.getByText("needle@example.test")).toBeVisible();
    expect(
      listRequests.filter((request) => request.search === "needle"),
    ).toEqual([{ page: "1", search: "needle" }]);

    const editButton = page
      .getByRole("row", { name: /needle@example\.test/ })
      .locator(`button[aria-controls="admin-user-${searchedUser.id}"]`);
    await editButton.click();
    await expect(editButton).toHaveAttribute("aria-expanded", "true");
    const closeEditor = page.getByRole("button", { name: "Close user editor" });
    await expect
      .poll(async () => (await closeEditor.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await closeEditor.click();
    await expect(editButton).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await searchInput.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await expect
      .poll(async () => (await searchButton.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await expect(editButton).toBeInViewport();
    await expect
      .poll(async () => (await editButton.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBe(0);
  });

  test("overview queue counts separate active work from waiting work", async ({
    page,
  }) => {
    await page.route("**/api/admin/dashboard", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      await route.fulfill({
        response,
        json: {
          ...snapshot,
          queues: {
            ...snapshot.queues,
            dockerExecInflight: 0,
            dockerExecQueued: 0,
            renderActive: 2,
            renderWaiting: 3,
          },
        },
      });
    });

    await page.goto("/admin/overview");
    await expect(page.getByLabel("0 active, 0 waiting")).toBeVisible();
    await expect(page.getByLabel("2 active, 3 waiting")).toBeVisible();
    await expect(page.getByText(/0\(0 waiting\)/)).toHaveCount(0);
    await expect(page.getByText(/2\(3 waiting\)/)).toHaveCount(0);
  });

  test("project controls are grouped, searchable, and preserve an unfinished draft across reload", async ({ page }) => {
    await page.goto("/admin/project");
    await expect(page.getByRole("heading", { name: "System configuration" })).toBeVisible();
    for (const group of ["Learning AI", "Anonymous trial", "Public sharing", "Runner capacity"]) {
      await expect(page.getByRole("heading", { name: group })).toBeVisible();
    }

    await page.getByLabel("Find a control").fill("daily questions per user");
    await expect(page.getByText("Daily questions per user", { exact: true })).toBeVisible();
    await expect(page.getByText("Block public share viewing", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Daily questions per user" }).click();
    await page.getByRole("spinbutton").fill("29");
    await page.getByLabel(/Reason \(visible in audit log\)/).fill("Q7 draft recovery check");
    await expect(page.getByText(/Draft saved in this browser tab/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("spinbutton")).toHaveValue("29");
    await expect(page.getByLabel(/Reason \(visible in audit log\)/)).toHaveValue(
      "Q7 draft recovery check",
    );
    const control = page.getByRole("group", { name: "Daily questions per user configuration" });
    await expect(control.getByText(/Impact: Changes how many tutor questions/)).toBeVisible();
    await expect(control.getByText(/Rollback: Revert to the deployed environment default/)).toBeVisible();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
  });

  test("platform Tutor model changes require cost acknowledgement and support an audited revert", async ({ page }) => {
    type CurrentModel = {
      model: string;
      source: "fallback" | "override";
      setBy: string | null;
      setAt: string | null;
      reason: string | null;
      invalidOverride: null;
    };
    let current: CurrentModel = {
      model: "gpt-5.6-luna",
      source: "fallback",
      setBy: null,
      setAt: null,
      reason: null,
      invalidOverride: null,
    };
    const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
    const candidates = [
      {
        id: "gpt-5.6-luna",
        label: "gpt-5.6-luna (recommended)",
        qualityStatus: "evaluated",
        qualityLabel: "Evaluated for CodeTutor",
        evalSetVersion: "2.8.0+evaluator.2.14.0",
        availableToPlatform: true,
        selectable: true,
        recommended: true,
        priceUsdPerMillion: { input: 1, output: 6 },
        costMultiplierVsRecommended: 1,
        unavailableReason: null,
      },
      {
        id: "gpt-5.6-terra",
        label: "gpt-5.6-terra",
        qualityStatus: "unevaluated",
        qualityLabel: "Not evaluated for teaching quality",
        evalSetVersion: null,
        availableToPlatform: true,
        selectable: true,
        recommended: false,
        priceUsdPerMillion: { input: 2.5, output: 15 },
        costMultiplierVsRecommended: 2.5,
        unavailableReason: null,
      },
    ];

    await page.route("**/api/admin/tutor-model", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            current,
            fallbackModel: "gpt-5.6-luna",
            candidates,
            discoveryError: null,
          }),
        });
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ method, body });
      if (method === "PUT") {
        current = {
          model: String(body.model),
          source: "override",
          setBy: "admin-test",
          setAt: "2026-08-10T02:00:00.000Z",
          reason: String(body.reason),
          invalidOverride: null,
        };
      } else {
        current = {
          model: "gpt-5.6-luna",
          source: "fallback",
          setBy: null,
          setAt: null,
          reason: null,
          invalidOverride: null,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ current }),
      });
    });

    await page.goto("/admin/project");
    const card = page.getByRole("region", { name: "Platform Tutor model" });
    await expect(card.getByText("gpt-5.6-luna (recommended)")).toBeVisible();
    await card.getByRole("button", { name: "Change model" }).click();
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card.getByRole("button", { name: "Change model" })).toBeFocused();
    await card.getByRole("button", { name: "Change model" }).click();
    await card.getByLabel("Model").selectOption("gpt-5.6-terra");
    await card.getByLabel(/Reason/).fill("Compare teaching quality for launch");
    await expect(card.getByText(/2.5× gpt-5.6-luna/).first()).toBeVisible();
    await expect(card.getByRole("button", { name: "Review change…" })).toBeDisabled();
    await card.getByRole("checkbox").check();
    await card.getByRole("button", { name: "Review change…" }).click();

    const changeDialog = page.getByRole("alertdialog", { name: "Change the platform Tutor model?" });
    await expect(changeDialog.getByText(/2.5× gpt-5.6-luna/)).toBeVisible();
    await changeDialog.getByRole("button", { name: "Yes, change model" }).click();
    await expect(changeDialog.getByText(/Applying and propagating/)).toBeVisible();
    await expect(changeDialog.getByRole("button", { name: "Changing…" })).toBeDisabled();
    // The modal makes the background region inert, so use DOM locators to
    // verify the underlying model controls are also natively disabled.
    const modelSection = page.locator('section[aria-labelledby="platform-tutor-model-title"]');
    await expect(modelSection.locator("select")).toBeDisabled();
    await expect(modelSection.locator("button", { hasText: "Refresh models" })).toBeDisabled();
    await expect(card.getByText("gpt-5.6-terra", { exact: true })).toBeVisible();
    await expect(card.getByRole("status")).toContainText(
      "gpt-5.6-terra was applied successfully",
    );
    expect(writes[0]).toEqual({
      method: "PUT",
      body: {
        model: "gpt-5.6-terra",
        reason: "Compare teaching quality for launch",
        expectedSetAt: null,
        confirmCostImpact: true,
      },
    });

    await card.getByRole("button", { name: "Change model" }).click();
    await card.getByLabel(/Reason/).fill("Return to recommended model");
    await card.getByRole("button", { name: "Revert to gpt-5.6-luna" }).click();
    const revertDialog = page.getByRole("alertdialog", { name: "Revert to gpt-5.6-luna?" });
    await revertDialog.getByRole("button", { name: "Yes, revert" }).click();
    await expect(revertDialog.getByText(/Reverting and propagating/)).toBeVisible();
    await expect(card.getByText("gpt-5.6-luna (recommended)", { exact: true })).toBeVisible();
    await expect(card.getByRole("status")).toContainText(
      "gpt-5.6-luna was restored successfully",
    );
    expect(writes[1]).toEqual({
      method: "DELETE",
      body: {
        reason: "Return to recommended model",
        expectedSetAt: "2026-08-10T02:00:00.000Z",
      },
    });
  });

  test("offline Tutor-model discovery keeps the active model safe without contradictory choices", async ({ page }) => {
    await page.route("**/api/admin/tutor-model", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: {
            model: "gpt-5.6-luna",
            source: "fallback",
            setBy: null,
            setAt: null,
            reason: null,
            invalidOverride: null,
          },
          fallbackModel: "gpt-5.6-luna",
          candidates: [{
            id: "gpt-5.6-luna",
            label: "gpt-5.6-luna",
            qualityStatus: "evaluated",
            qualityLabel: "Evaluated for CodeTutor",
            evalSetVersion: "2.8.0+evaluator.2.14.0",
            availableToPlatform: false,
            selectable: false,
            recommended: true,
            priceUsdPerMillion: { input: 1, output: 6 },
            costMultiplierVsRecommended: 1,
            unavailableReason: "Availability could not be confirmed while discovery is offline.",
          }],
          discoveryError: "Live OpenAI model discovery is temporarily unavailable.",
        }),
      });
    });

    await page.goto("/admin/project");
    const card = page.getByRole("region", { name: "Platform Tutor model" });
    await expect(card.getByRole("status")).toContainText(
      "Model changes are unavailable until discovery recovers.",
    );
    await expect(card.getByRole("button", { name: "Change model" })).toBeDisabled();
    await expect(card.getByLabel("Model")).toHaveCount(0);
    await expect(card.getByText(/pricing unavailable/i)).toHaveCount(0);
  });

  test("a destructive session draft survives interruption and can be explicitly discarded", async ({ page }) => {
    await page.goto("/admin/sessions");
    await page.getByRole("button", { name: "Kill all for user…" }).click();
    await page.getByLabel("User ID (UUID, from Users page)").fill(
      "00000000-0000-0000-0000-000000000000",
    );
    await page.getByLabel("Reason (≥ 4 chars)").fill("Q7 interruption recovery");
    await page.getByLabel(/Phrase:/).fill("partial confirmation only");
    await expect(page.getByRole("button", { name: "Kill all sessions" })).toBeDisabled();

    await page.reload();
    await page.getByRole("button", { name: "Kill all for user…" }).click();
    await expect(page.getByText("Restored your unfinished bulk-termination draft.")).toBeVisible();
    await expect(page.getByLabel("Reason (≥ 4 chars)")).toHaveValue(
      "Q7 interruption recovery",
    );
    await page.getByRole("button", { name: "Discard draft" }).click();

    await page.getByRole("button", { name: "Kill all for user…" }).click();
    await expect(page.getByLabel("User ID (UUID, from Users page)")).toHaveValue("");
    await expect(page.getByLabel("Reason (≥ 4 chars)")).toHaveValue("");
    await expect(page.getByLabel(/Phrase:/)).toHaveValue("");
  });

  test("trial analytics uses coherent cohorts and never renders an impossible conversion", async ({ page }) => {
    await page.goto("/admin/anon");
    const funnel = page.getByRole("heading", { name: "Funnel (today, UTC)" }).locator("..");
    await expect(funnel.getByText(/Unique privacy-bounded trial cohorts/)).toBeVisible();
    await expect(funnel.getByText(/data mismatch/i)).toHaveCount(0);
    const rates = await funnel.locator("text=/\\d+% of/").allTextContents();
    for (const rate of rates) {
      const value = Number.parseInt(rate, 10);
      expect(value).toBeLessThanOrEqual(100);
    }

    const organic = page.getByRole("row", { name: /^organic /i });
    const cells = await organic.getByRole("cell").allTextContents();
    expect(Number(cells[1])).toBeLessThanOrEqual(Number(cells[0]));
  });

  test("a hung admin read becomes an explicit retry state and recovers", async ({ page }) => {
    await page.route("**/api/admin/anon-summary", async (route) => {
      // Playwright keeps the intercepted fetch pending until this handler
      // releases it, even after the page's AbortController fires at 10 s.
      // Release just after that boundary so the browser can surface the
      // already-triggered timeout. client.test.ts enforces the exact 10 s
      // timer; this journey owns the rendered recovery and retry contract.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      await route.continue().catch(() => undefined);
    });
    await page.goto("/admin/anon");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Trial-path data did not load", { timeout: 14_000 });
    await expect(alert).toContainText("admin request took too long");
    const retry = page.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();

    await page.unroute("**/api/admin/anon-summary");
    await retry.click();
    await expect(page.getByRole("heading", { name: "Funnel (today, UTC)" })).toBeVisible({
      timeout: 12_000,
    });
  });

  test("email review redacts the live action capability before rendering", async ({ page }, testInfo) => {
    const fixture = await seedAdminEmailPreviewFixture(testInfo.workerIndex);
    try {
      await page.goto("/admin/email");
      await page.getByRole("row", { name: /Open email preview: Q7 safe preview fixture/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Private action links were redacted");
      await expect(dialog).toContainText("[unsubscribe link redacted]");
      await expect(dialog).not.toContainText(fixture.token);
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("row", { name: /Open email preview: Q7 safe preview fixture/ })).toBeFocused();
    } finally {
      await removeAdminEmailPreviewFixture(fixture.id);
    }
  });
});
