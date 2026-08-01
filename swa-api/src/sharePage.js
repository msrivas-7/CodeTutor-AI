import { createHmac, randomBytes } from "node:crypto";

const DEFAULT_API_BASE =
  "https://codetutor-ai-vm.eastus2.cloudapp.azure.com";
const PREVIEW_AUTH_VERSION = "codetutor-share-preview-v1";
const PREVIEW_AUTH_HEADERS = {
  keyId: "x-codetutor-preview-key-id",
  timestamp: "x-codetutor-preview-timestamp",
  nonce: "x-codetutor-preview-nonce",
  signature: "x-codetutor-preview-signature",
};

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

function canonicalPreviewRequest({ method, canonicalPath, timestamp, nonce, keyId }) {
  return [
    PREVIEW_AUTH_VERSION,
    method.toUpperCase(),
    canonicalPath,
    timestamp,
    nonce,
    keyId,
  ].join("\n");
}

function decodePreviewSecret(secret) {
  try {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(secret ?? "")) return null;
    const decoded = Buffer.from(secret ?? "", "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function signPreviewHeaders({
  token,
  keyId,
  secret,
  timestamp,
  nonce,
}) {
  const key = decodePreviewSecret(secret);
  if (!key || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(keyId)) {
    throw new Error("share preview authentication is not configured safely");
  }
  const canonicalPath = `/api/internal/share-previews/${token}`;
  const signature = createHmac("sha256", key)
    .update(
      canonicalPreviewRequest({
        method: "GET",
        canonicalPath,
        timestamp,
        nonce,
        keyId,
      }),
      "utf8",
    )
    .digest("base64url");
  return {
    accept: "application/json",
    [PREVIEW_AUTH_HEADERS.keyId]: keyId,
    [PREVIEW_AUTH_HEADERS.timestamp]: timestamp,
    [PREVIEW_AUTH_HEADERS.nonce]: nonce,
    [PREVIEW_AUTH_HEADERS.signature]: signature,
  };
}

const PREVIEW_DTO_KEYS = new Set([
  "schemaVersion",
  "lessonTitle",
  "lessonOrder",
  "courseTitle",
  "mastery",
  "timeSpentMs",
  "attemptCount",
  "displayName",
  "ogImageUrl",
]);

function parsePreviewDto(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !PREVIEW_DTO_KEYS.has(key))) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.lessonTitle !== "string" ||
    value.lessonTitle.length < 1 ||
    value.lessonTitle.length > 200 ||
    !Number.isInteger(value.lessonOrder) ||
    value.lessonOrder < 1 ||
    typeof value.courseTitle !== "string" ||
    value.courseTitle.length < 1 ||
    value.courseTitle.length > 200 ||
    !["strong", "okay", "shaky"].includes(value.mastery) ||
    !Number.isInteger(value.timeSpentMs) ||
    value.timeSpentMs < 0 ||
    !Number.isInteger(value.attemptCount) ||
    value.attemptCount < 1 ||
    !(value.displayName === null || typeof value.displayName === "string") ||
    !(value.ogImageUrl === null || typeof value.ogImageUrl === "string")
  ) {
    return null;
  }
  if (typeof value.displayName === "string" && value.displayName.length > 80) {
    return null;
  }
  if (typeof value.ogImageUrl === "string") {
    try {
      if (new URL(value.ogImageUrl).protocol !== "https:") return null;
    } catch {
      return null;
    }
  }
  return value;
}

function renderDegradedShareHtml(token, origin) {
  const parsedOrigin = new URL(origin);
  const publicOrigin = parsedOrigin.origin;
  const destination = `${publicOrigin}/s/${encodeURIComponent(token)}`;
  const title = "A CodeTutor learner shared a coding win | CodeTutor";
  const description =
    "See what they built and continue learning with an AI coding tutor.";
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
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#080a0f;color:#f4f1e8;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(680px,100%);padding:32px;border:1px solid #252a35;border-radius:24px;background:linear-gradient(145deg,#141824,#0d1018);box-shadow:0 30px 80px #0008}p{color:#a9afbd;line-height:1.6}.mark{font-family:Georgia,serif;font-size:22px}h1{margin:48px 0 0;font-family:Georgia,serif;font-size:clamp(32px,7vw,54px);line-height:1.05}a{display:inline-flex;min-height:44px;align-items:center;margin-top:22px;padding:0 18px;border-radius:999px;background:#d9b269;color:#0b0d12;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid #f4f1e8;outline-offset:3px}</style>
  <script>window.location.replace(${JSON.stringify(destination)});</script>
</head>
<body><main><div class="mark">CodeTutor</div><h1>A coding win</h1><p>Opening the shared interactive project…</p><a href="${escapeHtml(destination)}">View the project</a></main></body>
</html>`;
}

function htmlHeaders({ cacheControl, state, cache }) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    "x-codetutor-preview-state": state,
    "x-codetutor-preview-cache": cache,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

export function createSharePageHandler(options = {}) {
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE;
  const keyId = options.keyId ?? "";
  const secret = options.secret ?? "";
  const previewDisabled = options.previewDisabled ?? false;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const nonceFactory =
    options.nonceFactory ?? (() => randomBytes(18).toString("base64url"));
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 800;
  const readinessRetryDelayMs = options.readinessRetryDelayMs ?? 200;
  const positiveTtlMs = options.positiveTtlMs ?? 30_000;
  const incompleteTtlMs = options.incompleteTtlMs ?? 2_000;
  const negativeTtlMs = options.negativeTtlMs ?? 10_000;
  const degradedTtlMs = options.degradedTtlMs ?? 2_000;
  const cacheMax = options.cacheMax ?? 500;
  const circuitFailureThreshold = options.circuitFailureThreshold ?? 3;
  const circuitOpenMs = options.circuitOpenMs ?? 10_000;
  const log = options.log ?? ((event) => console.warn(JSON.stringify(event)));
  const configured =
    decodePreviewSecret(secret) !== null &&
    /^[a-z0-9][a-z0-9._-]{0,31}$/.test(keyId);

  const cache = new Map();
  const inflight = new Map();
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  function setCache(token, value, ttlMs) {
    cache.delete(token);
    cache.set(token, { value, expiresAt: now() + ttlMs });
    while (cache.size > cacheMax) {
      cache.delete(cache.keys().next().value);
    }
  }

  function getCache(token) {
    const entry = cache.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(token);
      return null;
    }
    // Promote to the tail so the bounded map behaves as an LRU.
    cache.delete(token);
    cache.set(token, entry);
    return entry.value;
  }

  function recordSuccess() {
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  }

  function recordFailure(reason) {
    consecutiveFailures += 1;
    const authFailure = reason === "upstream_unauthorized";
    if (authFailure || consecutiveFailures >= circuitFailureThreshold) {
      circuitOpenUntil = now() + (authFailure ? 30_000 : circuitOpenMs);
      log({ level: "warn", evt: "share_preview_circuit_open", reason });
    }
  }

  async function signedFetch(token) {
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = nonceFactory();
    const headers = signPreviewHeaders({
      token,
      keyId,
      secret,
      timestamp,
      nonce,
    });
    return fetchImpl(
      `${apiBaseUrl}/api/internal/share-previews/${encodeURIComponent(token)}`,
      {
        headers,
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      },
    );
  }

  async function fetchPreview(token) {
    let response;
    try {
      response = await signedFetch(token);
    } catch {
      return { kind: "degraded", reason: "upstream_timeout" };
    }
    if (response.status === 404) {
      // A same-version backend returns this exact JSON shape. An older backend
      // without the internal route returns Express's HTML 404; classify that
      // as deployment skew and degrade safely instead of telling crawlers a
      // real share is missing during backend-before-SWA promotion.
      try {
        const body = await response.clone().json();
        if (body?.error === "share not found") return { kind: "not_found" };
      } catch {
        // Non-JSON 404 means route/version mismatch, not share absence.
      }
      return { kind: "degraded", reason: "upstream_route_missing" };
    }
    if (response.status === 401) {
      return { kind: "degraded", reason: "upstream_unauthorized" };
    }
    if (response.status === 429) {
      return { kind: "degraded", reason: "upstream_rate_limited" };
    }
    if (!response.ok) return { kind: "degraded", reason: "upstream_error" };

    let share;
    try {
      share = parsePreviewDto(await response.json());
    } catch {
      share = null;
    }
    if (!share) return { kind: "degraded", reason: "invalid_dto" };

    // Image rendering is asynchronous. Give a brand-new artifact one bounded
    // second read with a fresh nonce; never loop and never exceed two short
    // upstream requests. If refresh fails, retain the valid first response.
    if (!share.ogImageUrl && readinessRetryDelayMs > 0) {
      await sleep(readinessRetryDelayMs);
      try {
        const refreshed = await signedFetch(token);
        if (refreshed.ok) {
          const candidate = parsePreviewDto(await refreshed.json());
          if (candidate) share = candidate;
        }
      } catch {
        // The first valid DTO is still safe and useful without an image.
      }
    }
    return { kind: "ok", share };
  }

  async function load(token) {
    const cached = getCache(token);
    if (cached) return { ...cached, cache: "hit" };
    if (circuitOpenUntil > now()) {
      return { kind: "degraded", reason: "circuit_open", cache: "bypass" };
    }
    const pending = inflight.get(token);
    if (pending) return { ...(await pending), cache: "coalesced" };

    const promise = fetchPreview(token)
      .then((result) => {
        if (result.kind === "ok") {
          recordSuccess();
          setCache(
            token,
            result,
            result.share.ogImageUrl ? positiveTtlMs : incompleteTtlMs,
          );
        } else if (result.kind === "not_found") {
          recordSuccess();
          setCache(token, result, negativeTtlMs);
        } else {
          recordFailure(result.reason);
          setCache(token, result, degradedTtlMs);
        }
        return result;
      })
      .finally(() => inflight.delete(token));
    inflight.set(token, promise);
    return { ...(await promise), cache: "miss" };
  }

  return async function handle(request) {
    const token = request.params.token ?? "";
    if (!/^[a-z2-9]{12}$/.test(token)) {
      return {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
        body: "Share not found",
      };
    }

    const origin = resolveOrigin(request);
    if (previewDisabled || !configured) {
      return {
        status: 200,
        headers: htmlHeaders({
          cacheControl: "public, max-age=5, must-revalidate",
          state: "degraded",
          cache: "bypass",
        }),
        body: renderDegradedShareHtml(token, origin),
      };
    }

    const result = await load(token);
    if (result.kind === "not_found") {
      return {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-codetutor-preview-state": "not-found",
          "x-codetutor-preview-cache": result.cache,
        },
        body: "Share not found",
      };
    }
    if (result.kind === "degraded") {
      return {
        status: 200,
        headers: htmlHeaders({
          cacheControl: "public, max-age=5, must-revalidate",
          state: "degraded",
          cache: result.cache,
        }),
        body: renderDegradedShareHtml(token, origin),
      };
    }

    const share = { ...result.share, shareToken: token };
    return {
      status: 200,
      headers: htmlHeaders({
        cacheControl: share.ogImageUrl
          ? "public, max-age=30, must-revalidate"
          : "public, max-age=5, must-revalidate",
        state: "full",
        cache: result.cache,
      }),
      body: renderShareHtml(share, origin),
    };
  };
}

const runtimeHandler = createSharePageHandler({
  apiBaseUrl: process.env.CODETUTOR_API_BASE_URL ?? DEFAULT_API_BASE,
  keyId: process.env.SHARE_PREVIEW_HMAC_KEY_ID ?? "",
  secret: process.env.SHARE_PREVIEW_HMAC_SECRET ?? "",
  previewDisabled: process.env.SHARE_PREVIEW_DISABLED === "1",
});

// Collapse the raw credential surface after the warm Function instance has
// captured its immutable signer config. Rotation restarts/recycles the API.
delete process.env.SHARE_PREVIEW_HMAC_SECRET;

export async function handleSharePage(request) {
  return runtimeHandler(request);
}
