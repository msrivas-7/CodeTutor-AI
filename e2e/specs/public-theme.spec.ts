import { expect, test } from "@playwright/test";

test("public mobile typography is independent of the document entry shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/privacy", "/why-not-chatgpt"]) {
    const title = path === "/" ? "AI that builds you, not the code"
      : path === "/privacy" ? "Privacy, in plain language." : "Why not just use ChatGPT?";
    const heading = page.getByRole("heading", { level: 1, name: title, exact: true });
    const typography = async () => {
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      return page.locator("h1, h2.font-display").evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        return { text: element.textContent, font: style.fontFamily, weight: style.fontWeight,
          width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
      }));
    };
    await page.goto(path);
    const baseline = await typography();
    // A fresh auth document selects FullApp, not the acquisition entry shell.
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    if (path === "/") await page.getByRole("link", { name: "CodeTutor AI home" }).click();
    else if (path === "/privacy") await page.getByRole("link", { name: "Privacy", exact: true }).click();
    else {
      await page.getByRole("link", { name: "CodeTutor AI home" }).click();
      await page.getByRole("link", { name: "Why not ChatGPT?", exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
    expect(await typography()).toEqual(baseline);
    await page.reload();
    expect(await typography()).toEqual(baseline);
    await page.getByRole("link", { name: path === "/" ? "Privacy" : "CodeTutor AI home", exact: true }).click();
    await page.goBack();
    expect(await typography()).toEqual(baseline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.goto("/try/lesson/python-fundamentals/hello-world");
  await expect(page.locator(".public-surface")).toHaveCount(0);
});

test("public auth supporting copy uses one readable role", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ["/login", "/signup"]) {
    await page.goto(route);
    const divider = page.getByText(/or sign (?:in|up) with email/);
    await expect(divider).toBeVisible();
    await expect(divider).toHaveCSS("font-size", "14px");
  }
  // Controlled transport response: exercise the real form's recovery state
  // without sending mail or changing an account.
  await page.route("**/auth/v1/recover*", route => route.fulfill({ json: {} }));
  await page.goto("/reset-password");
  await page.getByLabel("Email", { exact: true }).fill("typography-review@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  const detail = page.getByText("The link expires in an hour.", { exact: true });
  await expect(detail).toBeVisible();
  await expect(detail).toHaveCSS("font-size", "14px");
  await expect(detail).toHaveCSS("line-height", "21px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("public share comments retain readable contrast in normal and reduced motion", async ({ page }) => {
  const comment = "# Read the result before changing the code.";
  await page.route("**/api/shares/aaaaaaaaaaaa", route => route.fulfill({ json: {
    shareToken: "aaaaaaaaaaaa", courseId: "python-fundamentals", lessonId: "hello-world",
    lessonTitle: "Hello, World!", lessonOrder: 1, courseTitle: "Python Fundamentals",
    courseTotalLessons: 12, mastery: "strong", timeSpentMs: 60000, attemptCount: 1,
    codeSnippet: `print("Hello!")\n${comment}`, displayName: null, ogImageUrl: null,
    ogStoryImageUrl: null, viewCount: 1, createdAt: "2026-09-01T00:00:00Z",
  } }));
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.goto("/s/aaaaaaaaaaaa");
      const text = page.getByText(comment, { exact: true });
      await expect(text).toBeVisible();
      const contrast = await text.evaluate(element => {
        let ancestor: Element | null = element;
        let background = "rgba(0, 0, 0, 0)";
        while (ancestor && background === "rgba(0, 0, 0, 0)") {
          background = getComputedStyle(ancestor).backgroundColor;
          ancestor = ancestor.parentElement;
        }
        const lum = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const a = lum(getComputedStyle(element).color), b = lum(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("support action keeps readable contrast and stable geometry through pointer and keyboard states", async ({ page }) => {
  await page.goto("/support");
  const action = page.getByRole("link", { name: /^Email / });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", /^mailto:.*\?subject=CodeTutor%20support$/);
  const contrast = () => action.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await action.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
      const initial = await action.boundingBox();
      for (let repeat = 0; repeat < 2; repeat++) {
        await action.hover();
        // Assert the foreground too: a transition must not briefly satisfy a
        // contrast poll before the broken final hover color takes effect.
        await expect(action).toHaveCSS("color", "rgb(5, 7, 9)");
        await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
        expect(await action.boundingBox()).toEqual(initial);
        await page.mouse.move(0, 0);
      }
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).toHaveCSS("outline-style", "solid");
      await expect(action).toHaveCSS("outline-width", "2px");
      await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press("Tab");
      await expect(action).not.toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});

test("public token edits reach SPA and static surfaces without recoloring the workspace", async ({ page }) => {
  for (const route of ["/", "/login", "/privacy", "/learn-to-code/"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator("#design-system-tokens")).toHaveCount(1);
    const header = page.locator(".brand-header");
    await expect(header).toHaveCSS("min-height", "88px");
    // Verify inheritance through the real consumers, not just string presence.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--brand-header-height", "96px");
      document.documentElement.style.setProperty("--brand-text", "rgb(220, 230, 240)");
    });
    await expect(header).toHaveCSS("min-height", "96px");
    await expect(header.getByRole("link", { name: "CodeTutor AI home" })).toHaveCSS("color", "rgb(220, 230, 240)");
    await page.reload();
    await expect(header).toHaveCSS("min-height", "88px");
  }
  await page.goto("/try/lesson/python-fundamentals/hello-world");
  await expect(page.locator("html")).not.toHaveAttribute("data-public-theme");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim())).not.toBe("5 7 9");
});

test("walkthrough opens surrounding space but keeps all demo states protected", async ({ page }) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/#study-demo");
      await expect(page.locator("#study-demo-title")).toBeVisible();
      await expect(page.locator("#study-demo-title")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.locator(".study-demo-surface")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      for (const stage of ["Ask", "Check", "Read", "Ask"]) {
        const button = page.getByRole("button", { name: new RegExp(stage) });
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(button).toBeFocused();
        await expect(page.locator(".study-demo-body")).toHaveCSS("background-color", "rgb(5, 7, 9)");
        await expect(page.locator(".study-demo-explanation > p")).toHaveCSS("background-color", "rgb(5, 7, 9)");
        await expect(page.locator(".study-code pre")).toHaveAttribute("aria-label", `Code example, ${stage} stage`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});

for (const checkpoint of ["during typing", "after reveal"] as const) {
test(`a live reduced-motion change settles the entire public share ${checkpoint}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const code = 'print("' + 'learning '.repeat(checkpoint === "during typing" ? 60 : 1) + '")';
  await page.route('**/api/shares/aaaaaaaaaaaa', route => route.fulfill({ json: {
    shareToken: 'aaaaaaaaaaaa', courseId: 'python-fundamentals', lessonId: 'hello-world',
    lessonTitle: 'Hello, World!', lessonOrder: 1, courseTitle: 'Python Fundamentals',
    courseTotalLessons: 12, mastery: 'strong', timeSpentMs: 60000, attemptCount: 1,
    codeSnippet: code, displayName: null, ogImageUrl: null, ogStoryImageUrl: null,
    viewCount: 25, createdAt: '2026-09-01T00:00:00Z',
  }}));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/s/aaaaaaaaaaaa');
  await expect(page.getByRole('heading', { name: 'Hello, World!' })).toBeVisible();
  if (checkpoint === "during typing") {
    await expect(page.locator('.public-share-artifact')).not.toContainText(code);
  } else {
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByText('25 readers', { exact: true })).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.motion-study-canvas canvas')).toHaveCount(0);
  await expect(page.getByText(code, { exact: true })).toBeVisible({ timeout: 1500 });
  await expect(page.getByText('25 readers', { exact: true })).toBeVisible();
  const cta = page.getByRole('link', { name: /Try this lesson/ });
  await expect(cta.locator('..')).toHaveCSS('opacity', '1');
  await expect(cta.locator('..')).toHaveCSS('transform', 'none');
  await cta.hover();
  await expect(cta).toHaveCSS('transform', 'none');
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.public-page')).toHaveAttribute('data-motion', 'ready');
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText('25 readers', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.motion-study-canvas canvas')).toHaveCount(0);
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(cta).toBeFocused();
  expect(errors).toEqual([]);
});
}

test("public navigation keeps its geometry across page families and auth steps", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    let baseline: { height: number; logoX: number; logoY: number } | undefined;
    let authHeadingY: number | undefined;
    for (const route of ["/", "/login", "/signup", "/reset-password", "/privacy", "/terms", "/support", "/why-not-chatgpt", "/learn-to-code/"]) {
      await page.goto(route);
      // The shared loading shell has its own accessible heading. Measure only
      // after the actual destination replaces it, not during that handoff.
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasNotText: "Loading page" }).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const header = page.locator(".study-nav, .public-header, .site-nav");
      const box = (await header.boundingBox())!;
      const logo = (await header.getByRole("link", { name: "CodeTutor AI home" }).boundingBox())!;
      const geometry = { height: box.height, logoX: logo.x, logoY: logo.y + logo.height / 2 };
      baseline ??= geometry;
      for (const key of ["height", "logoX", "logoY"] as const) {
        expect(Math.abs(geometry[key] - baseline[key]), `${route} ${width}px ${key}`).toBeLessThan(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(width);
      if (["/login", "/signup", "/reset-password"].includes(route)) {
        const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
        authHeadingY ??= heading.y;
        expect(Math.abs(heading.y - authHeadingY), `${route} auth heading jumps`).toBeLessThan(1);
      }
    }
  }
});

test("one public field survives the homepage and auth journey without keeping form state", async ({page}) => {
  await page.emulateMedia({reducedMotion: "no-preference"});
  await page.goto("/");
  await expect(page.locator(".study-ready")).toBeVisible();
  const original = await page.locator(".motion-study-canvas canvas").elementHandle();
  expect(original).not.toBeNull();
  const sameField = async () => {
    await expect(page.locator(".motion-study-canvas canvas")).toHaveCount(1);
    expect(await original!.evaluate(node => node.isConnected && node === document.querySelector(".motion-study-canvas canvas"))).toBe(true);
  };
  await page.getByRole("navigation", {name: "Main navigation"}).getByRole("link", {name: "Sign in"}).click();
  await expect(page.getByRole("heading", {name: "Sign in", exact:true})).toBeVisible();
  await sameField();
  await page.getByLabel("Email", {exact:true}).fill("invalid");
  await page.getByRole("link", {name:"Create one"}).click();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page.getByLabel("Email", {exact:true})).toHaveValue("");
  await sameField();
  await page.getByRole("link", {name:"Sign in", exact:true}).click();
  await page.getByRole("link", {name:"Forgot password?"}).click();
  await expect(page.getByRole("heading", {name:"Reset your password"})).toBeVisible();
  await sameField();
  await page.getByRole("link", {name:"CodeTutor AI home"}).click();
  await expect(page.locator(".study-ready")).toBeVisible();
  await sameField();
  await page.getByRole("link", {name:"Try your first lesson"}).first().click();
  await expect(page).toHaveURL(/\/try\/lesson\//);
  await expect(page.locator(".motion-study-canvas")).toHaveCount(0);
});

test("reading routes retain the field and protect text without an opaque page slab", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('.public-page')).toHaveAttribute('data-motion', 'ready');
  const original = await page.locator('.motion-study-canvas canvas').elementHandle();
  for (const name of ['Privacy', 'Terms', 'Support']) {
    await page.getByRole('navigation', { name: 'Trust and support' }).getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await original!.evaluate(node => node === document.querySelector('.motion-study-canvas canvas'))).toBe(true);
    await expect(page.locator('.public-reading-body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.public-reading-body section p').first()).toHaveCSS('background-color', 'rgb(5, 7, 9)');
    await expect(page.locator('.public-content')).toBeFocused();
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('navigation', { name: 'Trust and support' }).getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`reading-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.motion-study-canvas canvas')).toHaveCount(0);
  await expect(page.locator('.public-flow-still')).toBeVisible();
  await page.getByRole('heading', { name: 'How code and AI requests are used' }).scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.public-page')).toHaveAttribute('data-motion', 'ready');
  await expect(page.getByRole('heading', { name: 'How code and AI requests are used' })).toBeInViewport();
  await page.goto('/learn-to-code/');
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'ready');
  await expect(page.locator('.motion-study-canvas canvas')).toHaveCount(1);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ['method-title', 'courses-title']) {
      const heading = page.locator(`#${id}`);
      await expect(heading).toHaveCSS('background-color', 'rgb(5, 7, 9)');
      await expect(heading.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      if (width === 1440) {
        expect((await heading.boundingBox())!.width).toBeLessThan((await heading.locator('..').boundingBox())!.width);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.public-flow-still')).toBeVisible();
  await expect(page.locator('.motion-study-canvas canvas')).toHaveCount(0);
});

test("cold public loading retains the header without adding it to workspace loading", async ({ page }) => {
  let releasePublic!: () => void;
  let releaseWorkspace!: () => void;
  const heldPublic = new Promise<void>(resolve => { releasePublic = resolve; });
  const heldWorkspace = new Promise<void>(resolve => { releaseWorkspace = resolve; });
  await page.route(/\/(?:src\/pages\/LoginPage\.tsx|assets\/LoginPage-[^/]+\.js)(?:\?|$)/, async route => {
    await heldPublic;
    await route.continue();
  });
  await page.route(/\/(?:src\/App\.tsx|assets\/App-[^/]+\.js)(?:\?|$)/, async route => {
    await heldWorkspace;
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".public-route-loading")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Loading");
    const header = page.locator(".brand-header");
    const initial = await header.boundingBox();
    await expect(page.getByRole("link", { name: "Back to CodeTutor" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-public-theme", "");
    await page.goto("/editor", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".route-loading")).toBeVisible();
    await expect(page.locator(".brand-header")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-public-theme");
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".public-route-loading")).toBeVisible();
    await page.getByRole("link", { name: "Back to CodeTutor" }).focus();
    releasePublic();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to CodeTutor" })).toBeFocused();
    expect(await header.boundingBox()).toEqual(initial);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally {
    releasePublic();
    releaseWorkspace();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("direct auth entry does not wait for the authenticated application bundle", async ({ page }) => {
  let fullAppRequests = 0;
  await page.route(/\/(?:src\/App\.tsx|assets\/App-[^/]+\.js)(?:\?|$)/, route => {
    fullAppRequests += 1;
    return route.abort();
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-public-theme", "");
  expect(fullAppRequests).toBe(0);
});

test("nested auth loading can be left through its header and completed without stale navigation", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/(?:src\/pages\/LoginPage\.tsx|assets\/LoginPage-[^/]+\.js)(?:\?|$)/, async route => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".public-route-loading")).toBeVisible();
    const header = page.locator(".brand-header");
    const initial = await header.boundingBox();
    await page.getByRole("link", { name: "Back to CodeTutor" }).click();
    await expect(page.locator(".study-ready")).toBeVisible();
    release();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    expect(await header.boundingBox()).toEqual(initial);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a canceled slow auth load keeps public navigation and cannot replace the restored homepage field", async ({page}) => {
  let release!: () => void;
  let intercepted = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/(?:src\/pages\/LoginPage\.tsx|assets\/LoginPage-[^/]+\.js)(?:\?|$)/, async route => {
    intercepted = true;
    await held;
    await route.continue();
  });
  try {
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.goto("/");
    await expect(page.locator(".study-ready")).toBeVisible();
    const original = await page.locator(".motion-study-canvas canvas").elementHandle();
    await page.getByRole("navigation", {name:"Main navigation"}).getByRole("link", {name:"Sign in"}).click();
    // React may retain the outgoing page during a transition instead of showing
    // Suspense's fallback. Assert the held request, not that presentation choice.
    await expect.poll(() => intercepted).toBe(true);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".public-auth")).toHaveCount(0);
    await expect(page.locator(".brand-header:visible")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "CodeTutor AI home" })).toBeVisible();
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    await page.goBack();
    release();
    await expect(page.locator(".study-ready")).toBeVisible();
    await expect(page.locator(".public-auth")).toHaveCount(0);
    expect(await original!.evaluate(node => node === document.querySelector(".motion-study-canvas canvas"))).toBe(true);
    await page.getByRole("navigation", {name:"Main navigation"}).getByRole("link", {name:"Sign in"}).click();
    await expect(page.getByRole("heading", {name:"Sign in",exact:true})).toBeVisible();
    expect(await original!.evaluate(node => node === document.querySelector(".motion-study-canvas canvas"))).toBe(true);
  } finally {
    release();
    await page.unrouteAll({behavior:"wait"});
  }
});

test("malformed public shares are unavailable links, not retryable connection failures", async ({ page }) => {
  let lookups = 0;
  page.on("request", request => { if (request.url().includes("/api/shares/")) lookups += 1; });
  for (const token of ["not-a-real-share", "short", "012345678901", "mine"]) {
    await page.goto(`/s/${token}`);
    const heading = page.getByRole("heading", { name: "Share not found", exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  }
  expect(lookups).toBe(0);
  await page.route("**/api/shares/aaaaaaaaaaaa", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/s/aaaaaaaaaaaa");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("missing discovery documents remain themed real 404s without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  try {
    const page = await context.newPage();
    for (const path of ["/learn-to-code/missing-course/", "/lessons/python-fundamentals/missing-lesson/", "/lessons/malformed/path/extra/"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page isn't here.");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 7, 9)");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }
    await page.getByRole("link", { name: "Browse public lessons" }).click();
    await expect(page).toHaveURL(/\/learn-to-code\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Built to teach");
  } finally { await context.close(); }
});

test("static discovery is readable without JavaScript and motion stays optional", async ({ browser, page }) => {
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const staticPage = await staticContext.newPage();
    await staticPage.goto("/lessons/python-intermediate/file-io/");
    await expect(staticPage.getByRole("heading", { level: 1 })).toContainText("File");
    await expect(staticPage.locator("article table")).toBeVisible();
    await expect(staticPage.locator("body")).toHaveCSS("background-color", "rgb(5, 7, 9)");
    await expect(staticPage.locator("canvas")).toHaveCount(0);
  } finally { await staticContext.close(); }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/learn-to-code/");
  await expect(page.locator("body")).toHaveAttribute("data-motion", "ready");
  await expect(page.locator("canvas")).toHaveCount(1);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("body")).toHaveAttribute("data-motion", "ready");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#root")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a cold homepage fragment waits for content without replaying on later interaction", async ({ page, browserName }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/MarketingHomepage.tsx*", async route => { await held; await route.continue(); });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#study-demo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Loading page", exact: true })).toBeAttached();
  } finally { release(); }
  await expect(page.locator("#study-demo-title")).toBeVisible();
  const anchorError = () => page.locator("#study-demo").evaluate(el =>
    Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop)),
  );
  await expect.poll(anchorError).toBeLessThan(2);
  const nextControl = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(nextControl);
  await expect(page.getByRole("button", { name: "01 Read", exact: true })).toBeFocused();
  await page.keyboard.press(nextControl);
  await expect(page.getByRole("button", { name: "02 Ask", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  const offset = await page.evaluate(() => scrollY);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "02 Ask", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "02 Ask", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => scrollY)).toBe(offset);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect.poll(anchorError).toBeLessThan(2);
  await page.goto("/support");
  await page.goto("/#%E0%A4%A");
  await expect(page.locator("#study-title")).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("a pending homepage fragment yields to visitor intent and later history", async ({ page, browserName }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/MarketingHomepage.tsx*", async route => { await held; await route.continue(); });
  try {
    await page.goto("/#study-demo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Loading page", exact: true })).toBeAttached();
    await page.keyboard.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
  } finally { release(); }
  await expect(page.locator("#study-title")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole("link", { name: "Skip to the product walkthrough", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "See how learning happens", exact: true }).click();
  await expect.poll(() => page.locator("#study-demo").evaluate(el =>
    Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop)),
  )).toBeLessThan(2);
  // Observe only programmatic replay; native Back may restore the fragment
  // rather than the footer's offset, and remains owned by the browser.
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      this.setAttribute("data-test-programmatic-scroll", "true");
      return original.apply(this, args);
    };
  });
  await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page.locator("#study-title")).toBeAttached();
  await expect(page.locator("#study-demo")).not.toHaveAttribute("data-test-programmatic-scroll");
});

for (const destination of ["main", "home"] as const) {
  test(`homepage loading hands ${destination} focus to its final equivalent`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/MarketingHomepage.tsx*", async route => { await held; await route.continue(); });
    try {
      await page.goto("/#study-demo", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Loading page", exact: true })).toBeAttached();
      if (destination === "main") {
        await page.getByRole("link", { name: "Skip to content", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#public-content")).toBeFocused();
      } else {
        await page.keyboard.press("Tab"); // Cancel the pending automatic fragment.
        await page.getByRole("link", { name: "Back to CodeTutor", exact: true }).focus();
      }
    } finally { release(); }
    const target = destination === "main"
      ? page.locator("#study-title")
      : page.getByRole("link", { name: "CodeTutor AI home", exact: true });
    await expect(target).toBeFocused();
    if (destination === "main") {
      await expect(target).toBeInViewport();
    } else {
      expect(await page.evaluate(() => scrollY)).toBe(0);
    }
  });
}

test("long discovery code stays within narrow reading widths without empty concept panels", async ({ page }) => {
  await page.goto("/lessons/python-intermediate/capstone-mini-orm/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mini In-Memory ORM");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator("article code").filter({ hasText: 'User.objects.filter(role="admin")' })).toContainText('.order_by("-age").first()');
    expect(await page.locator(".hero .chip").evaluateAll(chips => chips.every(chip =>
      chip.getBoundingClientRect().width <= chip.parentElement!.getBoundingClientRect().width + 1,
    ))).toBe(true);
  }
  await expect(page.locator(".side .note").filter({ hasText: "Concepts in this lesson" })).toHaveCount(0);
  await expect(page.locator(".side").getByRole("link", { name: "Start with lesson 1 — required first →" })).toBeVisible();
});

test("comparison keeps readable columns, navigation and the anonymous trial", async ({
  page,
}) => {
  await page.goto("/why-not-chatgpt");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".public-comparison-row")).toHaveCount(4);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const columns = page
      .locator(".public-comparison-pair")
      .first()
      .locator(":scope > div");
    const first = (await columns.nth(0).boundingBox())!;
    const second = (await columns.nth(1).boundingBox())!;
    if (width > 760) expect(second.x).toBeGreaterThan(first.x + first.width);
    else expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "When ChatGPT is the better tool" }),
  ).toBeAttached();
  await expect(
    page
      .getByRole("navigation", { name: "Product links" })
      .getByRole("link", { name: "Lessons", exact: true }),
  ).toHaveAttribute("href", "/learn-to-code/");
  await page
    .getByRole("link", {
      name: "Judge for yourself — try lesson 1, no signup →",
    })
    .click();
  await expect(page).toHaveURL(
    /\/try\/lesson\/python-fundamentals\/hello-world$/,
  );
  await expect(page.locator(".public-page")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-public-theme");
});

test("trust route aliases keep their content and malformed anchors cannot crash it", async ({
  page,
}) => {
  const errors: string[] = [];
  const fullAppRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/src/App.tsx") {
      fullAppRequests.push(request.url());
    }
  });
  for (const path of [
    "/privacy/",
    "/Privacy",
    "/%70rivacy",
    "/privacy#%E0%A4%A",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "How code and AI requests are used" }),
    ).toBeAttached();
    await expect(page.locator("html")).toHaveAttribute("data-public-theme", "");
    await expect(page).toHaveTitle(/Privacy/);
  }
  expect(errors).toEqual([]);
  expect(fullAppRequests).toEqual([]);
});

for (const [path, heading] of [
  ["/login", "Sign in"],
  ["/this-route-does-not-exist", "This page isn't here."],
] as const) {
  test(`public document ${path} paints correctly before the application can load`, async ({
    page,
  }) => {
    const appScript = /\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?|$)/;
    await page.route(appScript, (route) => route.abort());
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).toBeEmpty();
    await expect(page.locator("html")).toHaveAttribute("data-public-theme", "");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(5, 7, 9)",
    );
    await page.unroute(appScript);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(5, 7, 9)",
    );
  });
}

test("auth remains centered and usable through motion and mode changes", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-glyph")).toHaveCount(0);
  await expect(page.locator('.public-auth-still svg')).toHaveCount(1);
  await expect(page.locator('.public-auth-form')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCSS('opacity', '1');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.locator(".public-auth-form").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page.getByLabel("Email", { exact: true }).fill("invalid");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await expect(page.locator(".public-page")).toHaveAttribute(
    "data-motion",
    "static",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator('.public-auth-still')).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "invalid",
  );
  await page
    .getByRole("button", { name: "Prefer not to use a password?" })
    .click();
  await expect(
    page.getByRole("button", { name: "Send magic link" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "invalid",
  );
});

test("public footer navigation starts at the heading and explicit anchors still focus", async ({
  page,
}) => {
  await page.goto("/privacy");
  await page
    .getByRole("navigation", { name: "Trust and support" })
    .getByRole("link", { name: "Support", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Let's get you unstuck.", exact: true }),
  ).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("main")).toBeFocused();
  await page.goto("/privacy#ai");
  await expect(page.locator("#ai")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "How code and AI requests are used" }),
  ).toBeInViewport();
});
