import express from "express";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, closeDb } from "../db/client.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { adminAnonSummaryRouter } from "./adminAnonSummary.js";

interface FunnelSnapshot {
  funnelEvents: Record<string, number>;
  distributionChannels: Array<{
    source: "direct" | "organic" | "share";
    anon_page_view: number;
    anon_first_run: number;
    anon_lesson_completed: number;
    anon_signup_completed: number;
    anon_lesson2_reached: number;
  }>;
}

let server: Server;
let base = "";
let dbReachable = false;
const insertedHashes: string[] = [];

async function summary(): Promise<FunnelSnapshot> {
  const response = await fetch(`${base}/api/admin/anon-summary`);
  expect(response.status).toBe(200);
  return response.json() as Promise<FunnelSnapshot>;
}

function channel(snapshot: FunnelSnapshot, source: "direct" | "organic" | "share") {
  return snapshot.distributionChannels.find((entry) => entry.source === source)!;
}

beforeAll(async () => {
  try {
    await db()`SELECT 1 FROM public.phase27_funnel_events LIMIT 0`;
    dbReachable = true;
  } catch {
    return;
  }
  const app = express();
  app.use("/api/admin", adminAnonSummaryRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dbReachable && insertedHashes.length > 0) {
    await db()`DELETE FROM public.phase27_funnel_events WHERE ip_hash = ANY(${insertedHashes}::text[])`;
  }
  await closeDb();
});

describe("admin anon funnel cohorts", () => {
  it.skipIf(!dbReachable)(
    "deduplicates repeated events and excludes later stages without prerequisites",
    async () => {
      const organic = `q7-organic-${randomUUID()}`;
      const direct = `q7-direct-${randomUUID()}`;
      const orphan = `q7-orphan-${randomUUID()}`;
      insertedHashes.push(organic, direct, orphan);
      const before = await summary();

      await db()`
        INSERT INTO public.phase27_funnel_events (
          event, ip_hash, acquisition_source, acquisition_medium,
          acquisition_campaign, acquisition_content
        ) VALUES
          ('anon_page_view', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_page_view', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_first_run', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_first_run', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_first_run', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_lesson_completed', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_wall_opened', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_signup_completed', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_lesson2_reached', ${organic}, 'organic', 'lesson_page', 'python-fundamentals', 'hello-world'),
          ('anon_page_view', ${direct}, 'direct', NULL, NULL, NULL),
          ('anon_wall_opened', ${direct}, 'direct', NULL, NULL, NULL),
          ('anon_lesson2_reached', ${direct}, 'direct', NULL, NULL, NULL),
          ('anon_first_run', ${orphan}, 'direct', NULL, NULL, NULL),
          ('anon_lesson2_reached', ${orphan}, 'direct', NULL, NULL, NULL)
      `;

      const after = await summary();
      expect(after.funnelEvents.anon_page_view - before.funnelEvents.anon_page_view).toBe(2);
      expect(after.funnelEvents.anon_first_run - before.funnelEvents.anon_first_run).toBe(1);
      expect(
        after.funnelEvents.anon_lesson_completed - before.funnelEvents.anon_lesson_completed,
      ).toBe(1);
      expect(after.funnelEvents.anon_wall_opened - before.funnelEvents.anon_wall_opened).toBe(2);
      expect(
        after.funnelEvents.anon_signup_completed - before.funnelEvents.anon_signup_completed,
      ).toBe(1);
      expect(
        after.funnelEvents.anon_lesson2_reached - before.funnelEvents.anon_lesson2_reached,
      ).toBe(1);

      const organicBefore = channel(before, "organic");
      const organicAfter = channel(after, "organic");
      expect(organicAfter.anon_page_view - organicBefore.anon_page_view).toBe(1);
      expect(organicAfter.anon_first_run - organicBefore.anon_first_run).toBe(1);
      expect(organicAfter.anon_lesson2_reached - organicBefore.anon_lesson2_reached).toBe(1);

      for (const snapshot of [after.funnelEvents, ...after.distributionChannels]) {
        expect(snapshot.anon_first_run).toBeLessThanOrEqual(snapshot.anon_page_view);
        expect(snapshot.anon_lesson_completed).toBeLessThanOrEqual(snapshot.anon_first_run);
        expect(snapshot.anon_lesson2_reached).toBeLessThanOrEqual(
          snapshot.anon_signup_completed,
        );
      }
    },
    30_000,
  );
});
