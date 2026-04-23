// Audit gap #1 (hazy-wishing-wren bucket 10): multi-tab same-user session
// coherence. Two browser tabs for the same signed-in user each create their
// OWN session (runner container) — no single-session-per-user cap, no
// automatic replacement. The invariants we lock here:
//
//  - Each tab gets a distinct sessionId from the backend's createSession
//    path. Regression would collapse both tabs onto one container, meaning
//    a run in tab B would clobber tab A's stdin/output.
//  - A run in tab A produces output only in tab A. Tab B's output panel
//    stays on whatever it last ran (or empty). Cross-tab leakage here is
//    the load-bearing user-visible bug behind this audit finding.
//  - Both tabs share the SAME user on the same Supabase session, so the
//    backend's per-user aggregates (free-tier counter, AI-ledger) stay
//    consistent — but session state is per-container.
//
// We share a single BrowserContext so both pages inherit the Supabase
// session from localStorage. page.context().newPage() is how a real user
// gets a second tab; this spec mirrors that without mocking the backend.

import { test as rawTest, expect, request } from "@playwright/test";
import { getWorkerUser, loginAsTestUser } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import * as S from "../utils/selectors";
import { expectStdoutContains } from "../utils/assertions";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";

rawTest.describe("tab-sleep → wake rebind", () => {
  // Audit gap #7 (hazy-wishing-wren bucket 10): when a learner's tab is
  // hidden long enough for the backend's 120-min sweeper to reap their
  // idle session, the heartbeat stops (hidden-tab optimization). On
  // visibilitychange→visible we fire an immediate tick so the 404 lands
  // right away and `rebindSession` picks up a fresh container. Without
  // the immediate tick, the learner would stare at a dead Run button
  // for up to one heartbeat interval (25s) on wake. Regression path:
  // removing the start() → tick() on wake, or dropping the 404-triggers
  // -rebind branch.

  rawTest.beforeEach(async ({ page }, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  rawTest(
    "visibility wake with a stale session triggers rebind + keeps Run usable",
    async ({ page }) => {
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

      // Now the initial session is live. Flip ping to 404 so the next
      // visibility-wake tick surfaces the "session is gone" path, and stub
      // rebind to hand back a fresh id (mirrors what the backend does when
      // the old session was swept). The 404 body carries `backendBootId`
      // to satisfy the client's drift check — we keep it matching the
      // initial value so the code enters the recovery branch, not the
      // bootDrift branch (that one goes straight to SessionReplacedModal).
      let pingCount = 0;
      let rebindCount = 0;
      await page.route("**/api/session/ping", async (route) => {
        pingCount++;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "session not found" }),
        });
      });
      await page.route("**/api/session/rebind", async (route) => {
        rebindCount++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sessionId: "wake-fresh-session-abc",
            reused: true,
            backendBootId: "boot-same",
          }),
        });
      });

      // Simulate tab → background. `visibilitychange` handler will stop
      // the heartbeat timer.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Simulate tab → foreground. Handler should fire tick() immediately
      // → ping 404 → rebindSession → new id active.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Rebind must fire at least once off the immediate wake-tick.
      await expect
        .poll(() => rebindCount, { timeout: 10_000 })
        .toBeGreaterThanOrEqual(1);
      expect(pingCount).toBeGreaterThanOrEqual(1);

      // After rebind, the Run button must still be enabled against the
      // new sessionId — if not, the learner is stuck until manual reload.
      await expect(S.runButton(page)).toBeEnabled({ timeout: 10_000 });
    },
  );
});

rawTest.describe("concurrent /snapshot calls", () => {
  // Audit gap #4 (hazy-wishing-wren bucket 10): QA-C2's per-session
  // serializer (localDocker.ts snapshotChains) lives to stop two parallel
  // /api/project/snapshot calls from racing on readdir+rm+writeFiles. If
  // the chain breaks, the final workspace can be a mix of files from
  // snapshot A and snapshot B (or EEXIST on overlapping writes). Five
  // concurrent calls with distinct markers are the blast test; the final
  // run must reflect EXACTLY one of the submitted file sets, not a mix
  // or an error.

  rawTest.beforeEach(async ({ page }, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  rawTest(
    "5 concurrent snapshots on one session resolve without partial state",
    async ({ page }, testInfo) => {
      // Open the editor, capture the sessionId from POST /api/session.
      let sessionId = "";
      page.on("response", async (res) => {
        if (!res.url().endsWith("/api/session")) return;
        if (res.request().method() !== "POST") return;
        try {
          const body = (await res.json()) as { sessionId?: string };
          if (body.sessionId) sessionId = body.sessionId;
        } catch {
          /* skip */
        }
      });
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });
      await expect.poll(() => sessionId, { timeout: 10_000 }).not.toBe("");

      // Direct-to-backend fan-out. page.request carries the same auth, but
      // we explicitly build a fresh context with Origin for CSRF+Bearer.
      const user = await getWorkerUser(testInfo.workerIndex);
      const ctx = await request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
      try {
        const makeSnapshot = (marker: string) =>
          ctx.post(`${BACKEND}/api/project/snapshot`, {
            headers: {
              "X-Requested-With": "codetutor",
              Authorization: `Bearer ${user.session.access_token}`,
              "Content-Type": "application/json",
            },
            data: {
              sessionId,
              files: [{ path: "main.py", content: `print("${marker}")\n` }],
            },
          });

        // Kick off 5 snapshots simultaneously, each with a distinct marker.
        // Promise.all so they race the serializer's chain from all sides.
        const markers = ["A", "B", "C", "D", "E"];
        const responses = await Promise.all(markers.map(makeSnapshot));
        for (const [i, res] of responses.entries()) {
          expect(res.status(), `snapshot ${markers[i]} status`).toBe(200);
          const body = (await res.json()) as { ok: boolean; fileCount: number };
          expect(body).toEqual({ ok: true, fileCount: 1 });
        }
      } finally {
        await ctx.dispose();
      }

      // Run directly against /api/execute — the UI's Run button re-snapshots
      // the editor's projectStore first, which would clobber the concurrent
      // state we just wrote. Bypassing that path isolates the invariant:
      // "after 5 concurrent snapshots, the workspace contains exactly ONE
      // of the submitted file sets, not a mix."
      const user2 = await getWorkerUser(testInfo.workerIndex);
      const ctx2 = await request.newContext({ extraHTTPHeaders: { Origin: ORIGIN } });
      try {
        const runRes = await ctx2.post(`${BACKEND}/api/execute`, {
          headers: {
            "X-Requested-With": "codetutor",
            Authorization: `Bearer ${user2.session.access_token}`,
            "Content-Type": "application/json",
          },
          data: { sessionId, language: "python" },
        });
        expect(runRes.status(), await runRes.text()).toBe(200);
        const body = (await runRes.json()) as { stdout: string; stderr: string; exitCode: number };
        expect(body.exitCode, `stderr: ${body.stderr}`).toBe(0);
        // stdout must match exactly ONE marker, trimmed. No mojibake, no
        // empty string, no mix.
        expect(body.stdout.trim()).toMatch(/^[A-E]$/);
      } finally {
        await ctx2.dispose();
      }
    },
  );
});

rawTest.describe("multi-tab session coherence", () => {
  rawTest.beforeEach(async ({ page }, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  rawTest(
    "two tabs get distinct sessionIds; each tab's runs stay in its own output panel",
    async ({ page }, testInfo) => {
      // Watch POST /api/session responses on each tab to capture the
      // sessionId the backend handed out. Install BEFORE the navigation so
      // we don't miss the initial create.
      const sessionIds = { a: "" as string, b: "" as string };
      const captureOn = (p: import("@playwright/test").Page, which: "a" | "b") => {
        p.on("response", async (res) => {
          if (!res.url().endsWith("/api/session")) return;
          if (res.request().method() !== "POST") return;
          try {
            const body = (await res.json()) as { sessionId?: string };
            if (body.sessionId) sessionIds[which] = body.sessionId;
          } catch {
            /* skip */
          }
        });
      };

      captureOn(page, "a");
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

      // Spin up tab B in the SAME context — shared localStorage means the
      // Supabase session + onboarding flags are already primed. Re-running
      // loginAsTestUser on the new page is a belt-and-suspenders for the
      // init-script timing since addInitScript is per-page.
      const pageB = await page.context().newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      await mockAllAI(pageB);
      captureOn(pageB, "b");
      await pageB.goto("/editor");
      await waitForMonacoReady(pageB);
      await expect(S.runButton(pageB)).toBeEnabled({ timeout: 30_000 });

      // Distinct markers per tab so a regression that collapses sessions
      // would surface as "TAB-B" appearing in tab A's output or vice versa.
      await setMonacoValue(page, "print('TAB-A-OUTPUT')\n");
      await setMonacoValue(pageB, "print('TAB-B-OUTPUT')\n");

      // Run sequentially so the assertions are deterministic — running in
      // parallel would still exercise the coherence invariant but makes
      // debugging a failure harder.
      await S.runButton(page).click();
      await expectStdoutContains(page, "TAB-A-OUTPUT");

      await S.runButton(pageB).click();
      await expectStdoutContains(pageB, "TAB-B-OUTPUT");

      // Critical: TAB-B's run must not have overwritten TAB-A's output, and
      // TAB-A's output must not contain TAB-B's marker.
      const outA = await page.locator("#output-panel-body").innerText();
      const outB = await pageB.locator("#output-panel-body").innerText();
      expect(outA).toContain("TAB-A-OUTPUT");
      expect(outA).not.toContain("TAB-B-OUTPUT");
      expect(outB).toContain("TAB-B-OUTPUT");
      expect(outB).not.toContain("TAB-A-OUTPUT");

      // Both sessionIds must be populated AND distinct. An empty-string
      // case means the response event never fired (regression in the test
      // harness); a shared id means two tabs collapsed to one container.
      await expect
        .poll(() => Boolean(sessionIds.a && sessionIds.b), { timeout: 10_000 })
        .toBe(true);
      expect(
        sessionIds.a,
        "each tab must hold its own sessionId (not collapsed)",
      ).not.toBe(sessionIds.b);

      await pageB.close();
    },
  );
});
