const API_BASE =
  process.env.CODETUTOR_API_BASE_URL ??
  "https://codetutor-ai-vm.eastus2.cloudapp.azure.com";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "a focused session";
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function achievementLabel(mastery) {
  if (mastery === "strong") return "Completed confidently";
  if (mastery === "shaky") return "Kept going and finished";
  return "Lesson completed";
}

export function renderShareHtml(share, origin) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
    throw new TypeError("Unsupported share origin");
  }
  const publicOrigin = parsedOrigin.origin;
  const token = String(share.shareToken);
  const author = share.displayName || "A CodeTutor learner";
  const attempts = Math.max(1, Number(share.attemptCount) || 0);
  const destination = `${publicOrigin}/s/${encodeURIComponent(token)}`;
  const title = `${author} completed ${share.lessonTitle} | CodeTutor`;
  const description = `${achievementLabel(share.mastery)} in ${formatDuration(
    Number(share.timeSpentMs),
  )} · ${attempts} ${attempts === 1 ? "attempt" : "attempts"}. See the code.`;
  const imageTags = share.ogImageUrl
    ? `<meta property="og:image" content="${escapeHtml(share.ogImageUrl)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(`${author}'s completed CodeTutor lesson`)}">
    <meta name="twitter:image" content="${escapeHtml(share.ogImageUrl)}">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(destination)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="CodeTutor">
  <meta property="og:url" content="${escapeHtml(destination)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${imageTags}
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#080a0f;color:#f4f1e8;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(680px,100%);padding:32px;border:1px solid #252a35;border-radius:24px;background:linear-gradient(145deg,#141824,#0d1018);box-shadow:0 30px 80px #0008}p{color:#a9afbd;line-height:1.6}.mark{font-family:Georgia,serif;font-size:22px}.eyebrow{margin-top:48px;color:#8e96a8;font-size:12px;letter-spacing:.16em;text-transform:uppercase}h1{margin:10px 0 0;font-family:Georgia,serif;font-size:clamp(32px,7vw,54px);line-height:1.05}a{display:inline-flex;min-height:44px;align-items:center;margin-top:22px;padding:0 18px;border-radius:999px;background:#d9b269;color:#0b0d12;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid #f4f1e8;outline-offset:3px}
  </style>
  <script>window.location.replace(${JSON.stringify(destination)});</script>
</head>
<body>
  <main>
    <div class="mark">CodeTutor</div>
    <div class="eyebrow">${escapeHtml(share.courseTitle)} · Lesson ${escapeHtml(share.lessonOrder)}</div>
    <h1>${escapeHtml(share.lessonTitle)}</h1>
    <p>${escapeHtml(author)} completed this lesson. Opening the interactive project…</p>
    <a href="${escapeHtml(destination)}">View the project</a>
  </main>
</body>
</html>`;
}

function isPublicShareHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "codetutor.msrivas.com" ||
    normalized.endsWith(".azurestaticapps.net") ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function originFromHost(host, protocol = "https:") {
  const candidate = host?.split(",")[0].trim();
  if (!candidate || !/^[A-Za-z0-9.:[\]-]+(?::\d{1,5})?$/.test(candidate)) {
    return null;
  }
  try {
    const parsed = new URL(`${protocol}//${candidate}`);
    return isPublicShareHost(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function originFromUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value.split(",")[0].trim());
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      isPublicShareHost(parsed.hostname)
    ) {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed proxy metadata and continue to the next source.
  }
  return null;
}

export function resolveOrigin(request) {
  // Azure Static Web Apps terminates the public request before invoking its
  // managed Function. Depending on the hosting path, request.url can therefore
  // contain an internal *.azurewebsites.net hostname. Prefer the original host
  // metadata that the SWA/App Service proxy preserves. `disguised-host` is the
  // header currently used by the SWA API proxy; the others cover standard and
  // older Azure proxy paths. Every candidate is constrained to our custom
  // domain, SWA-owned preview domains, or local development hosts so a spoofed
  // Host header cannot poison canonical/share URLs.
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    request.headers.get("x-appservice-proto")?.split(",")[0].trim() ||
    "https";
  const safeProtocol = protocol === "http" ? "http:" : "https:";
  const hostHeaders = [
    "x-forwarded-host",
    "disguised-host",
    "x-original-host",
    "x-ms-original-host",
    "host",
  ];
  for (const header of hostHeaders) {
    const origin = originFromHost(request.headers.get(header), safeProtocol);
    if (origin) return origin;
  }

  for (const header of ["x-original-url", "x-ms-original-url"]) {
    const origin = originFromUrl(request.headers.get(header));
    if (origin) return origin;
  }

  return originFromUrl(request.url) ?? "https://codetutor.msrivas.com";
}

export async function handleSharePage(request) {
  const token = request.params.token ?? "";
  if (!/^[a-z2-9]{12}$/.test(token)) {
    return {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "Share not found",
    };
  }

  const fetchShare = () =>
    fetch(`${API_BASE}/api/shares/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });

  let response;
  try {
    response = await fetchShare();
  } catch {
    return {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "This shared lesson is temporarily unavailable. Please try again.",
    };
  }

  if (!response.ok) {
    return {
      status: response.status === 404 ? 404 : 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: response.status === 404 ? "Share not found" : "Unable to load this shared lesson",
    };
  }

  let share;
  try {
    share = await response.json();
  } catch {
    return {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "Unable to load this shared lesson",
    };
  }
  if (
    !share ||
    typeof share !== "object" ||
    typeof share.shareToken !== "string" ||
    typeof share.lessonTitle !== "string" ||
    typeof share.courseTitle !== "string"
  ) {
    return {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "Unable to load this shared lesson",
    };
  }

  // Main OG rendering is intentionally fire-and-forget on share creation.
  // A crawler often arrives immediately after the learner pastes the new
  // link, so give the artifact a short readiness window instead of caching a
  // metadata response with no image. Existing shares return on the first
  // request; only brand-new ones pay this bounded wait.
  for (let attempt = 0; attempt < 5 && !share.ogImageUrl; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const refreshed = await fetchShare();
      if (!refreshed.ok) break;
      const candidate = await refreshed.json();
      if (candidate && typeof candidate === "object") share = candidate;
    } catch {
      break;
    }
  }
  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": share.ogImageUrl
        ? "public, max-age=300, stale-while-revalidate=3600"
        : "public, max-age=5, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body: renderShareHtml(share, resolveOrigin(request)),
  };
}
