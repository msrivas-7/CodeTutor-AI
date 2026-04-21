import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiagnostics } from "./FeedbackModal";

// Phase 20-P1: the diagnostic payload is the user-visible privacy contract —
// the "What's included?" disclosure explicitly lists these keys. If this
// test drifts from the UI copy, either fix the copy or shrink the payload;
// don't silently start collecting new fields.
//
// buildDiagnostics is a pure function of (pathname, globals). We stub the
// globals here to keep the assertion deterministic across macOS/Linux CI.

const realDocument = globalThis.document;
const realWindow = globalThis.window;
const realNavigator = globalThis.navigator;

afterEach(() => {
  vi.restoreAllMocks();
  // Restore globals between tests so each case sees a clean slate.
  Object.defineProperty(globalThis, "document", { value: realDocument, configurable: true });
  Object.defineProperty(globalThis, "window", { value: realWindow, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true });
});

function setGlobals(opts: {
  theme?: string;
  viewport?: [number, number];
  lang?: string;
  userAgent?: string;
}) {
  Object.defineProperty(globalThis, "document", {
    value: {
      documentElement: { dataset: { theme: opts.theme } },
    },
    configurable: true,
  });
  if (opts.viewport) {
    Object.defineProperty(globalThis, "window", {
      value: { innerWidth: opts.viewport[0], innerHeight: opts.viewport[1] },
      configurable: true,
    });
  }
  Object.defineProperty(globalThis, "navigator", {
    value: {
      language: opts.lang ?? "en-US",
      userAgent: opts.userAgent ?? "Mozilla/5.0 Test",
    },
    configurable: true,
  });
}

describe("buildDiagnostics", () => {
  it("returns the documented key set — and nothing more", () => {
    setGlobals({ theme: "dark", viewport: [1440, 900] });
    const d = buildDiagnostics("/learn/course/python/lesson/l1");
    expect(Object.keys(d).sort()).toEqual(
      ["appSha", "lang", "route", "theme", "userAgent", "viewport"].sort(),
    );
  });

  it("captures the current route path verbatim", () => {
    setGlobals({ theme: "dark", viewport: [1440, 900] });
    expect(buildDiagnostics("/editor").route).toBe("/editor");
  });

  it("reports the viewport as WxH", () => {
    setGlobals({ theme: "dark", viewport: [1440, 900] });
    expect(buildDiagnostics("/").viewport).toBe("1440x900");
  });

  it("reports theme from documentElement.dataset.theme, defaulting when unset", () => {
    setGlobals({ viewport: [100, 100] });
    expect(buildDiagnostics("/").theme).toBe("default");
    setGlobals({ theme: "light", viewport: [100, 100] });
    expect(buildDiagnostics("/").theme).toBe("light");
  });

  it("reads language from navigator.language", () => {
    setGlobals({ theme: "dark", viewport: [1, 1], lang: "fr-FR" });
    expect(buildDiagnostics("/").lang).toBe("fr-FR");
  });

  it("truncates userAgent to 256 chars so a single field can't blow the budget", () => {
    const long = "UA" + "x".repeat(400);
    setGlobals({ theme: "dark", viewport: [1, 1], userAgent: long });
    const d = buildDiagnostics("/");
    expect(d.userAgent.length).toBe(256);
    expect(d.userAgent.startsWith("UAxxxx")).toBe(true);
  });

  it("NEVER includes learner code, email, IP, or the OpenAI key", () => {
    setGlobals({ theme: "dark", viewport: [100, 100] });
    const d = buildDiagnostics("/") as unknown as Record<string, unknown>;
    expect(d).not.toHaveProperty("code");
    expect(d).not.toHaveProperty("source");
    expect(d).not.toHaveProperty("email");
    expect(d).not.toHaveProperty("ip");
    expect(d).not.toHaveProperty("openaiKey");
    expect(d).not.toHaveProperty("apiKey");
    expect(d).not.toHaveProperty("token");
  });
});
