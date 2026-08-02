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
