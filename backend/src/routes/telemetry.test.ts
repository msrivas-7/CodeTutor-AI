import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

const { db } = await import("../db/client.js");
const { createTelemetryRouter } = await import("./telemetry.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { hashShareRef } = await import("../services/ai/ipHash.js");
const { registry, shareInteractions } = await import("../services/metrics.js");

let server: Server;
let base = "";
let distributionSchemaReachable = false;
const campaigns: string[] = [];

beforeAll(async () => {
  try {
    await db()`
      SELECT acquisition_source, acquisition_medium, acquisition_campaign,
             acquisition_content, referring_share_hash
        FROM public.phase27_funnel_events
       LIMIT 0
    `;
    distributionSchemaReachable = true;
  } catch {
    distributionSchemaReachable = false;
  }

  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.use("/api/telemetry", createTelemetryRouter());
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (distributionSchemaReachable && campaigns.length > 0) {
    await db()`
      DELETE FROM public.phase27_funnel_events
       WHERE acquisition_campaign = ANY(${campaigns}::text[])
    `;
  }
});

function post(body: unknown, ip = "10.73.0.1") {
  return fetch(`${base}/api/telemetry/event`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function postShareOutcome(body: unknown, ip = "10.74.0.1") {
  return fetch(`${base}/api/telemetry/share-outcome`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/telemetry/share-outcome", () => {
  it("records four explicit outcomes with bounded surfaces", async () => {
    shareInteractions.reset();
    for (const [index, outcome] of [
      "copied",
      "share_completed",
      "cancelled",
      "dismissed",
    ].entries()) {
      const response = await postShareOutcome(
        {
          outcome,
          surface: index % 2 === 0 ? "anonymous" : "authenticated",
        },
        `10.74.0.${index + 1}`,
      );
      expect(response.status).toBe(204);
    }
    const metrics = await registry.metrics();
    expect(metrics).toMatch(
      /share_interactions_total\{outcome="copied",surface="anonymous"\} 1/,
    );
    expect(metrics).toMatch(
      /share_interactions_total\{outcome="share_completed",surface="authenticated"\} 1/,
    );
    expect(metrics).toMatch(
      /share_interactions_total\{outcome="cancelled",surface="anonymous"\} 1/,
    );
    expect(metrics).toMatch(
      /share_interactions_total\{outcome="dismissed",surface="authenticated"\} 1/,
    );
  });

  it("rejects arbitrary outcome, surface, and extra dimensions", async () => {
    for (const body of [
      { outcome: "clicked", surface: "anonymous" },
      { outcome: "copied", surface: "admin" },
      {
        outcome: "copied",
        surface: "anonymous",
        shareToken: "abc234def567",
      },
    ]) {
      const response = await postShareOutcome(body, "10.74.1.1");
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_share_outcome" });
    }
  });
});

describe("POST /api/telemetry/event distribution contract", () => {
  it("rejects arbitrary analytics dimensions before any database write", async () => {
    const response = await post({
      event: "anon_page_view",
      attribution: {
        source: "google",
        medium: "cpc",
        campaign: "unbounded marketing text",
        referrer: "https://example.test/private/path?email=maya@example.test",
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_event_body" });
  });

  it("keeps legacy clients backward compatible as direct first touch", async () => {
    const response = await post({ event: "anon_page_view" }, "10.73.0.2");
    expect(response.status).toBe(204);
  });

  it("stores bounded share attribution and only a one-way share digest", async () => {
    if (!distributionSchemaReachable) return;
    const campaign = `test-${randomUUID()}`;
    const shareRef = "23456789abcd";
    campaigns.push(campaign);
    const response = await post(
      {
        event: "anon_first_run",
        attribution: {
          source: "share",
          medium: "lesson_share",
          campaign,
          content: "hello-world",
          shareRef,
        },
      },
      "10.73.0.3",
    );
    expect(response.status).toBe(204);

    const rows = await db()<
      Array<{
        acquisition_source: string;
        acquisition_medium: string | null;
        acquisition_campaign: string | null;
        acquisition_content: string | null;
        referring_share_hash: string | null;
      }>
    >`
      SELECT acquisition_source, acquisition_medium, acquisition_campaign,
             acquisition_content, referring_share_hash
        FROM public.phase27_funnel_events
       WHERE acquisition_campaign = ${campaign}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      acquisition_source: "share",
      acquisition_medium: "lesson_share",
      acquisition_campaign: campaign,
      acquisition_content: "hello-world",
      referring_share_hash: hashShareRef(shareRef),
    });
    expect(rows[0]?.referring_share_hash).not.toContain(shareRef);
  });

  it("accepts the complete first-run-to-completion event vocabulary", async () => {
    if (!distributionSchemaReachable) return;
    const campaign = `test-${randomUUID()}`;
    campaigns.push(campaign);
    for (const event of ["anon_page_view", "anon_first_run", "anon_lesson_completed"] as const) {
      const response = await post(
        {
          event,
          attribution: {
            source: "organic",
            medium: "lesson_page",
            campaign,
            content: "variables",
          },
        },
        "10.73.0.4",
      );
      expect(response.status).toBe(204);
    }
    const rows = await db()<Array<{ event: string }>>`
      SELECT event
        FROM public.phase27_funnel_events
       WHERE acquisition_campaign = ${campaign}
       ORDER BY occurred_at, event
    `;
    expect(new Set(rows.map((row) => row.event))).toEqual(
      new Set(["anon_page_view", "anon_first_run", "anon_lesson_completed"]),
    );
  });
});
