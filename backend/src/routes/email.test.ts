import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    corsOrigin: "https://codetutor.test",
    email: {
      unsubscribeSecret: "test-unsubscribe-secret",
      streakNudgeReplyTo: "support@codetutor.test",
    },
  },
  setEmailOptInDirect: vi.fn(),
  verifyUnsubscribeToken: vi.fn(),
}));

vi.mock("../config.js", () => ({ config: mocks.config }));
vi.mock("../db/preferences.js", () => ({
  setEmailOptInDirect: mocks.setEmailOptInDirect,
}));
vi.mock("../services/email/unsubscribeTokens.js", () => ({
  verifyUnsubscribeToken: mocks.verifyUnsubscribeToken,
}));

const { emailRouter } = await import("./email.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/email", emailRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/email/unsubscribe`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mocks.config.email.unsubscribeSecret = "test-unsubscribe-secret";
  mocks.verifyUnsubscribeToken.mockReset();
  mocks.setEmailOptInDirect.mockReset();
});

describe("GET /api/email/unsubscribe", () => {
  it("returns a branded 503 without attempting verification when the service is unconfigured", async () => {
    mocks.config.email.unsubscribeSecret = "";
    const response = await fetch(baseUrl);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("Service not configured");
    expect(mocks.verifyUnsubscribeToken).not.toHaveBeenCalled();
  });

  it("returns the same non-oracular 401 for a missing or invalid token", async () => {
    mocks.verifyUnsubscribeToken.mockReturnValue(null);
    for (const suffix of ["", "?token=tampered"]) {
      const response = await fetch(`${baseUrl}${suffix}`);
      expect(response.status).toBe(401);
      expect(await response.text()).toContain("Link no longer valid");
    }
    expect(mocks.setEmailOptInDirect).not.toHaveBeenCalled();
  });

  it("turns off email and renders a recoverable success page for a valid token", async () => {
    mocks.verifyUnsubscribeToken.mockReturnValue({ userId: "user-123" });
    mocks.setEmailOptInDirect.mockResolvedValue(true);
    const response = await fetch(`${baseUrl}?token=valid`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.setEmailOptInDirect).toHaveBeenCalledWith("user-123", false);
    expect(body).toContain("You&#39;re unsubscribed");
    expect(body).toContain("Back to CodeTutor");
  });

  it("is idempotent when the preferences row is already absent", async () => {
    mocks.verifyUnsubscribeToken.mockReturnValue({ userId: "user-123" });
    mocks.setEmailOptInDirect.mockResolvedValue(false);
    const first = await fetch(`${baseUrl}?token=valid`);
    const second = await fetch(`${baseUrl}?token=valid`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.setEmailOptInDirect).toHaveBeenCalledTimes(2);
  });

  it("contains database failures behind a generic retryable 500 page", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verifyUnsubscribeToken.mockReturnValue({ userId: "user-123" });
    mocks.setEmailOptInDirect.mockRejectedValue(new Error("private database detail"));
    const response = await fetch(`${baseUrl}?token=valid`);
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toContain("Something went wrong");
    expect(body).not.toContain("private database detail");
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});
