import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderDesignTokensHtml } from "../../../design-system/tokens";

const html = renderDesignTokensHtml(readFileSync(
  new URL("../../../../index.html", import.meta.url),
  "utf8",
));
const bootstrap = html.match(
  /<script id="public-theme-bootstrap">([\s\S]*?)<\/script>/,
)![1];

function boot(pathname: string) {
  const attributes = new Map<string, string>([["data-theme", "light"]]);
  const listeners = new Map<string, () => void>();
  const location = { pathname };
  const chromeTheme = { content: "#0f172a" };
  runInNewContext(bootstrap, {
    window: {
      location,
      addEventListener: (event: string, fn: () => void) =>
        listeners.set(event, fn),
    },
    document: {
      querySelector: () => chromeTheme,
      documentElement: {
        toggleAttribute: (key: string, on: boolean) =>
          on ? attributes.set(key, "") : attributes.delete(key),
      },
    },
  });
  return { attributes, location, listeners, chromeTheme };
}

describe("public pre-paint theme", () => {
  it.each([
    "/",
    "/login",
    "/login/",
    "/signup",
    "/reset-password",
    "/auth/callback",
    "/privacy",
    "/privacy/",
    "/Privacy",
    "/%70rivacy",
    "/terms",
    "/support",
    "/why-not-chatgpt",
    "/s/example",
    "/learn-to-code",
    "/learn-to-code/python-fundamentals",
    "/lessons/python-fundamentals/hello-world/",
    "/this-route-does-not-exist",
    "/login-extra",
    "/%E0%A4%A",
  ])("paints %s before the app and preserves the saved theme", (path) => {
    const { attributes, chromeTheme } = boot(path);
    expect(attributes.has("data-public-theme")).toBe(true);
    expect(attributes.get("data-theme")).toBe("light");
    expect(chromeTheme.content).toBe("#050709");
  });
  it.each([
    "/start",
    "/Start/",
    "/welcome",
    "/editor",
    "/learn",
    "/learn/saved",
    "/admin/project",
    "/admin",
    "/admin/eval-quality",
    "/dev/content",
    "/learn/course/python-fundamentals",
    "/learn/course/python-fundamentals/lesson/hello-world",
    "/try/lesson/python-fundamentals/hello-world",
  ])("does not recolor workspace route %s", (path) => {
    expect(boot(path).attributes.has("data-public-theme")).toBe(false);
  });
  it.each(["codetutor:route-change", "popstate"])(
    "restores workspace preference on %s and can reenter public pages",
    (event) => {
      const { attributes, location, listeners, chromeTheme } = boot("/login");
      location.pathname = "/editor";
      listeners.get(event)!();
      expect(attributes.has("data-public-theme")).toBe(false);
      expect(attributes.get("data-theme")).toBe("light");
      expect(chromeTheme.content).toBe("#0f172a");
      location.pathname = "/privacy";
      listeners.get(event)!();
      expect(attributes.has("data-public-theme")).toBe(true);
      expect(chromeTheme.content).toBe("#050709");
    },
  );
  it("runs inline in the head before React without a separately cached script", () => {
    expect(bootstrap).toBeTruthy();
    expect(html.indexOf('id="public-theme-bootstrap"')).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(html).not.toContain('src="/public-theme.js"');
  });
});
