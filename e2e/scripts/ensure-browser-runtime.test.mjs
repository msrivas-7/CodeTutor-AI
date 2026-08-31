import assert from "node:assert/strict";
import test from "node:test";
import { ensureBrowserRuntime } from "./ensure-browser-runtime.mjs";

function fakeBrowser(launches) {
  return {
    async launch() {
      launches.count += 1;
      const next = launches.results.shift();
      if (next instanceof Error) throw next;
      return {
        async close() {
          launches.closed += 1;
        },
      };
    },
  };
}

test("skips OS installation when the cached browser already launches", async () => {
  const launches = { count: 0, closed: 0, results: [true] };
  let installs = 0;
  const result = await ensureBrowserRuntime({
    browserName: "chromium",
    browserTypes: { chromium: fakeBrowser(launches) },
    installDependencies: async () => {
      installs += 1;
    },
  });

  assert.deepEqual(result, { installedDependencies: false });
  assert.equal(installs, 0);
  assert.deepEqual(launches, { count: 1, closed: 1, results: [] });
});

test("installs dependencies once and requires a successful second launch", async () => {
  const launches = { count: 0, closed: 0, results: [new Error("missing library"), true] };
  const installs = [];
  const result = await ensureBrowserRuntime({
    browserName: "webkit",
    browserTypes: { webkit: fakeBrowser(launches) },
    installDependencies: async (name, firstError) => {
      installs.push({ name, message: firstError.message });
    },
  });

  assert.deepEqual(result, { installedDependencies: true });
  assert.deepEqual(installs, [{ name: "webkit", message: "missing library" }]);
  assert.deepEqual(launches, { count: 2, closed: 1, results: [] });
});

test("fails closed for an unknown browser", async () => {
  await assert.rejects(
    ensureBrowserRuntime({
      browserName: "chrome",
      browserTypes: {},
      installDependencies: async () => {},
    }),
    /Unsupported Playwright browser: chrome/,
  );
});
