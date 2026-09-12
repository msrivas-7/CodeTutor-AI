import { expect, test } from "@playwright/test";

const obsoleteChunk =
  "Failed to fetch dynamically imported module: /assets/AnonLessonPage-obsolete.js";

test("an open tab reloads once when a deployment removes its lazy chunk", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.sessionStorage.removeItem("codetutor:preload-recovery"),
  );

  const reloaded = page.waitForEvent("load");
  await page.evaluate((message) => {
    const event = new Event("vite:preloadError", { cancelable: true });
    Object.defineProperty(event, "payload", { value: new TypeError(message) });
    setTimeout(() => window.dispatchEvent(event), 0);
  }, obsoleteChunk);
  await reloaded;

  await expect(
    page.getByRole("heading", { name: "AI that builds you, not the code" }),
  ).toBeVisible();

  let navigations = 0;
  page.on("framenavigated", () => {
    navigations += 1;
  });
  const repeatedWasPrevented = await page.evaluate((message) => {
    const event = new Event("vite:preloadError", { cancelable: true });
    Object.defineProperty(event, "payload", { value: new TypeError(message) });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, obsoleteChunk);
  await page.waitForTimeout(250);

  expect(repeatedWasPrevented).toBe(false);
  expect(navigations).toBe(0);
});
