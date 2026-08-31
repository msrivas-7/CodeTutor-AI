import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SUPPORTED_BROWSERS = new Set(["chromium", "firefox", "webkit"]);

export async function ensureBrowserRuntime({
  browserName,
  browserTypes,
  installDependencies,
}) {
  if (!SUPPORTED_BROWSERS.has(browserName) || !browserTypes[browserName]) {
    throw new Error(`Unsupported Playwright browser: ${browserName}`);
  }

  const launch = async () => {
    const browser = await browserTypes[browserName].launch({ headless: true });
    await browser.close();
  };

  try {
    await launch();
    console.log(`[playwright-runtime] ${browserName} launched with runner-provided libraries`);
    return { installedDependencies: false };
  } catch (firstError) {
    console.warn(
      `[playwright-runtime] ${browserName} preflight failed; installing OS dependencies`,
    );
    await installDependencies(browserName, firstError);
    await launch();
    console.log(`[playwright-runtime] ${browserName} launched after dependency installation`);
    return { installedDependencies: true };
  }
}

async function main() {
  const browserName = process.argv[2];
  const playwright = await import("playwright");
  await ensureBrowserRuntime({
    browserName,
    browserTypes: {
      chromium: playwright.chromium,
      firefox: playwright.firefox,
      webkit: playwright.webkit,
    },
    installDependencies: async (name) => {
      const executable = process.platform === "win32" ? "npx.cmd" : "npx";
      const result = spawnSync(executable, ["playwright", "install-deps", name], {
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`playwright install-deps ${name} exited ${result.status}`);
      }
    },
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
