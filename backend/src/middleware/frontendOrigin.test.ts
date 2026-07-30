import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cors from "cors";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  corsOriginPolicy,
  isFrontendOriginAllowed,
} from "./frontendOrigin.js";

const PR_PREVIEW =
  "https://gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net";
const SWA_PRIMARY =
  "https://gentle-flower-093ba7e0f.eastus2.7.azurestaticapps.net";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(cors({ origin: corsOriginPolicy }));
  app.get("/probe", (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
);

describe("frontend origin policy", () => {
  it("allows the configured canonical frontend origin", () => {
    expect(isFrontendOriginAllowed("http://localhost:5173")).toBe(true);
  });

  it("allows this CodeTutor SWA resource and its numeric PR previews", () => {
    expect(isFrontendOriginAllowed(SWA_PRIMARY)).toBe(true);
    expect(isFrontendOriginAllowed(PR_PREVIEW)).toBe(true);
    expect(
      isFrontendOriginAllowed(
        "https://gentle-flower-093ba7e0f-99999.eastus2.7.azurestaticapps.net",
      ),
    ).toBe(true);
  });

  it.each([
    "https://attacker.example",
    "https://other-app.azurestaticapps.net",
    "https://gentle-flower-093ba7e0f.attacker.example",
    "https://gentle-flower-093ba7e0f-10.westus2.7.azurestaticapps.net",
    "http://gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net",
    "https://gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net:444",
    "https://gentle-flower-093ba7e0f-10.eastus2.7.azurestaticapps.net/path",
    "not a URL",
  ])("rejects an untrusted or malformed origin: %s", (origin) => {
    expect(isFrontendOriginAllowed(origin)).toBe(false);
  });

  it("echoes an allowed preview origin in the CORS response", async () => {
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { Origin: PR_PREVIEW },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(PR_PREVIEW);
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("authorizes the preview's mutating-request preflight", async () => {
    const response = await fetch(`${baseUrl}/probe`, {
      method: "OPTIONS",
      headers: {
        Origin: PR_PREVIEW,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-requested-with",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(PR_PREVIEW);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-requested-with",
    );
  });

  it("does not emit an allow-origin header for a foreign site", async () => {
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
