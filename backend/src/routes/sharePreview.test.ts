import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedCompletion } from "../db/sharedCompletions.js";
import {
  SHARE_PREVIEW_AUTH_HEADERS,
  signSharePreviewRequest,
  type SharePreviewAuthKey,
} from "../services/share/previewAuth.js";
import { createSharePreviewRouter } from "./sharePreview.js";

const NOW = 1_770_000_000_000;
const TOKEN = "abc234def567";
const CURRENT: SharePreviewAuthKey = {
  id: "2026-07-a",
  secret: Buffer.alloc(32, 1).toString("base64"),
};
const PREVIOUS: SharePreviewAuthKey = {
  id: "2026-06-z",
  secret: Buffer.alloc(32, 2).toString("base64"),
};

const share: SharedCompletion = {
  id: "00000000-0000-4000-8000-000000000001",
  shareToken: TOKEN,
  userId: "00000000-0000-4000-8000-000000000002",
  ipHash: null,
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  lessonTitle: "Hello, World!",
  lessonOrder: 1,
  courseTitle: "Python Fundamentals",
  courseTotalLessons: 12,
  mastery: "strong",
  timeSpentMs: 180_000,
  attemptCount: 2,
  codeSnippet: 'print("private from preview DTO")',
  displayName: "Maya",
  ogImagePath: null,
  ogStoryImagePath: "s/should-not-leak-story.png",
  viewCount: 42,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  revision: 0,
  rotatedAt: null,
  revokedAt: null,
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function start(router: express.Router): Promise<string> {
  const app = express();
  app.use("/api/internal/share-previews", router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function signedHeaders(options: {
  key?: SharePreviewAuthKey;
  token?: string;
  timestampMs?: number;
  nonceByte?: number;
  nonceCounter?: number;
} = {}): Record<string, string> {
  const key = options.key ?? CURRENT;
  const token = options.token ?? TOKEN;
  const timestamp = String(
    Math.floor((options.timestampMs ?? NOW) / 1000),
  );
  const nonceBuffer = Buffer.alloc(18, options.nonceByte ?? 1);
  if (options.nonceCounter !== undefined) {
    nonceBuffer.writeUInt32BE(options.nonceCounter, 14);
  }
  const nonce = nonceBuffer.toString("base64url");
  const canonicalPath = `/api/internal/share-previews/${token}`;
  return {
    [SHARE_PREVIEW_AUTH_HEADERS.keyId]: key.id,
    [SHARE_PREVIEW_AUTH_HEADERS.timestamp]: timestamp,
    [SHARE_PREVIEW_AUTH_HEADERS.nonce]: nonce,
    [SHARE_PREVIEW_AUTH_HEADERS.signature]: signSharePreviewRequest({
      method: "GET",
      canonicalPath,
      timestamp,
      nonce,
      keyId: key.id,
      secret: key.secret,
    }),
  };
}

describe("GET /api/internal/share-previews/:token", () => {
  it("returns only the minimal non-counting metadata projection", async () => {
    let reads = 0;
    const outcomes: string[] = [];
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        getShare: async () => {
          reads += 1;
          return share;
        },
        isDisabled: async () => false,
        recordMetric: (outcome) => outcomes.push(outcome),
      }),
    );
    const response = await fetch(
      `${base}/api/internal/share-previews/${TOKEN}`,
      { headers: signedHeaders() },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: 1,
      lessonTitle: "Hello, World!",
      lessonOrder: 1,
      courseTitle: "Python Fundamentals",
      mastery: "strong",
      timeSpentMs: 180_000,
      attemptCount: 2,
      displayName: "Maya",
      ogImageUrl: null,
    });
    expect(body).not.toHaveProperty("codeSnippet");
    expect(body).not.toHaveProperty("viewCount");
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("courseId");
    expect(body).not.toHaveProperty("lessonId");
    expect(body).not.toHaveProperty("ogStoryImageUrl");
    expect(reads).toBe(1);
    expect(outcomes).toEqual(["ok"]);
  });

  it("accepts the previous key during a zero-downtime rotation", async () => {
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT, PREVIOUS],
        now: () => NOW,
        getShare: async () => share,
        isDisabled: async () => false,
      }),
    );
    const response = await fetch(
      `${base}/api/internal/share-previews/${TOKEN}`,
      { headers: signedHeaders({ key: PREVIOUS, nonceByte: 2 }) },
    );
    expect(response.status).toBe(200);
  });

  it("makes malformed, bad, stale, and replayed authentication failures indistinguishable", async () => {
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        getShare: async () => share,
        isDisabled: async () => false,
      }),
    );
    const url = `${base}/api/internal/share-previews/${TOKEN}`;
    const bad = signedHeaders({ nonceByte: 3 });
    bad[SHARE_PREVIEW_AUTH_HEADERS.signature] = "A".repeat(43);
    const stale = signedHeaders({
      timestampMs: NOW - 31_000,
      nonceByte: 4,
    });
    const replay = signedHeaders({ nonceByte: 5 });

    const missingResponse = await fetch(url);
    const badResponse = await fetch(url, { headers: bad });
    const staleResponse = await fetch(url, { headers: stale });
    expect((await fetch(url, { headers: replay })).status).toBe(200);
    const replayResponse = await fetch(url, { headers: replay });

    for (const response of [
      missingResponse,
      badResponse,
      staleResponse,
      replayResponse,
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "share preview unavailable",
      });
    }
  });

  it("fails closed when unconfigured or disabled without querying a share", async () => {
    let reads = 0;
    const getShare = async () => {
      reads += 1;
      return share;
    };
    const unconfiguredBase = await start(
      createSharePreviewRouter({
        keys: [],
        now: () => NOW,
        getShare,
        isDisabled: async () => false,
      }),
    );
    expect(
      (
        await fetch(
          `${unconfiguredBase}/api/internal/share-previews/${TOKEN}`,
        )
      ).status,
    ).toBe(503);

    const disabledBase = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        getShare,
        isDisabled: async () => true,
      }),
    );
    expect(
      (
        await fetch(
          `${disabledBase}/api/internal/share-previews/${TOKEN}`,
          { headers: signedHeaders({ nonceByte: 6 }) },
        )
      ).status,
    ).toBe(503);
    expect(reads).toBe(0);
  });

  it("uses a service budget independent of public-reader throttling", async () => {
    let reads = 0;
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        rateLimitMax: 2,
        rateLimitWindowMs: 60_000,
        getShare: async () => {
          reads += 1;
          return share;
        },
        isDisabled: async () => false,
      }),
    );
    const url = `${base}/api/internal/share-previews/${TOKEN}`;
    expect(
      (await fetch(url, { headers: signedHeaders({ nonceByte: 7 }) })).status,
    ).toBe(200);
    expect(
      (await fetch(url, { headers: signedHeaders({ nonceByte: 8 }) })).status,
    ).toBe(200);
    const limited = await fetch(url, {
      headers: signedHeaders({ nonceByte: 9 }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(reads).toBe(2);
  });

  it("admits exactly the configured 600-request service ceiling under burst", async () => {
    let reads = 0;
    let nonceCounter = 20;
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        rateLimitMax: 600,
        rateLimitWindowMs: 60_000,
        getShare: async () => {
          reads += 1;
          return share;
        },
        isDisabled: async () => false,
      }),
    );
    const url = `${base}/api/internal/share-previews/${TOKEN}`;
    const responses: Response[] = [];
    // Keep 50 requests in flight at a time so this measures the application
    // ceiling rather than the host OS socket backlog. All 650 requests still
    // land in the same fixed window because `now` is held constant.
    for (let offset = 0; offset < 650; offset += 50) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(50, 650 - offset) }, () => {
          nonceCounter += 1;
          return fetch(url, {
            headers: signedHeaders({ nonceCounter }),
          });
        }),
      );
      responses.push(...batch);
    }
    const admitted = responses.filter((response) => response.status === 200);
    const limited = responses.filter((response) => response.status === 429);
    expect(admitted).toHaveLength(600);
    expect(limited).toHaveLength(50);
    expect(limited.every((response) => response.headers.get("retry-after") === "60")).toBe(true);
    expect(reads).toBe(600);
  }, 15_000);

  it("retains anti-enumeration not-found behavior", async () => {
    const base = await start(
      createSharePreviewRouter({
        keys: [CURRENT],
        now: () => NOW,
        getShare: async () => null,
        isDisabled: async () => false,
      }),
    );
    const missing = await fetch(
      `${base}/api/internal/share-previews/${TOKEN}`,
      { headers: signedHeaders({ nonceByte: 10 }) },
    );
    const malformed = await fetch(
      `${base}/api/internal/share-previews/not-a-token`,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "share not found" });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: "share not found" });
  });
});
