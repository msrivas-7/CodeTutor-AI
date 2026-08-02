import { config } from "../../config.js";

// Phase 21C: Supabase Storage upload for share OG images.
//
// Pattern matches db/supabaseAdmin.ts — direct REST calls with the
// service role key, no SDK. Two operations:
//
//   - ensureBucket(): create the share-og bucket (public-read) if
//     missing. Idempotent. Called once at boot or first upload.
//   - uploadOgPng(): write a PNG buffer to share-og/s/{token}.png
//     and return the public URL.

const BUCKET = "share-og";

function adminHeaders(): Record<string, string> {
  const key = config.supabase.serviceRoleKey;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function baseUrl(): string {
  const u = config.supabase.url;
  if (!u) throw new Error("SUPABASE_URL not configured");
  return u.replace(/\/$/, "");
}

let bucketEnsured = false;

/**
 * Idempotently create the share-og bucket with public-read access.
 * Cached so the no-op case (bucket already exists) doesn't re-fire
 * the REST call on every share creation.
 */
export async function ensureShareBucket(): Promise<void> {
  if (bucketEnsured) return;
  const res = await fetch(`${baseUrl()}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 2 * 1024 * 1024, // 2 MB cap per object — well above
      // a 1200x630 PNG (~80-200 KB).
      allowed_mime_types: ["image/png"],
    }),
  });
  // 200 = created. Supabase Storage signals "already exists" with
  // EITHER an HTTP 409 OR an HTTP 400 wrapping a body whose
  // `statusCode` is "409" (the Storage API leaks through both shapes
  // depending on path/version). Treat both as success — the bucket
  // exists, which is what we wanted.
  if (res.ok || res.status === 409) {
    bucketEnsured = true;
    return;
  }
  const text = await res.text().catch(() => "");
  if (res.status === 400) {
    try {
      const parsed = JSON.parse(text) as { statusCode?: string };
      if (parsed.statusCode === "409") {
        bucketEnsured = true;
        return;
      }
    } catch {
      /* not JSON — fall through to the generic error */
    }
  }
  throw new Error(`storage: ensureBucket failed (${res.status}): ${text}`);
}

/**
 * Upload `pngBuffer` to share-og/s/{token}.png. Returns the storage
 * object PATH (relative to the bucket) — caller stores this in
 * shared_lesson_completions.og_image_path. Public URL is derived
 * from the path via publicUrl().
 *
 * Uses `upsert=true` so a re-render for the same token overwrites
 * (e.g., if we ever add re-render-on-edit). Without upsert the
 * second call would 409.
 */
async function uploadWithRetry(
  objectPath: string,
  pngBuffer: Buffer,
): Promise<void> {
  // 3 attempts, exponential backoff (250ms, 500ms). Supabase Storage
  // 5xxs intermittently during deploys / pool churn; without retry a
  // share lands with a null image path forever.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
    let res: Response;
    try {
      res = await fetch(
        `${baseUrl()}/storage/v1/object/${BUCKET}/${objectPath}`,
        {
          method: "POST",
          headers: {
            ...adminHeaders(),
            "Content-Type": "image/png",
            "x-upsert": "true",
            // Keep the origin cache short because the owner can edit, rotate,
            // or revoke this artifact. Third-party apps may retain copies
            // under their own policies, but our CDN will revalidate quickly.
            "Cache-Control": "public, max-age=300",
          },
          // Node Buffer IS a subclass of Uint8Array and Node 18+ fetch
          // accepts it at runtime. The TS BodyInit type in this
          // project's lib version is overly strict; cast through
          // unknown — runtime behavior is well-defined.
          body: pngBuffer as unknown as BodyInit,
        },
      );
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    // Retry only on 5xx + 429. 4xx is a request bug — don't waste
    // retries on something that won't change.
    if (res.status >= 500 || res.status === 429) {
      lastError = new Error(`storage: upload ${res.status}: ${text}`);
      continue;
    }
    throw new Error(`storage: upload failed (${res.status}): ${text}`);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`storage: upload failed after retries: ${String(lastError)}`);
}

export async function uploadOgPng(
  shareToken: string,
  pngBuffer: Buffer,
): Promise<string> {
  await ensureShareBucket();
  const objectPath = `s/${shareToken}.png`;
  await uploadWithRetry(objectPath, pngBuffer);
  return objectPath;
}

/**
 * Phase 21C-ext: upload the 9:16 Story-format PNG. Lives at
 * share-og/s/{token}-story.png alongside the OG card. Same upsert
 * semantics, same cache headers — Stories images are also immutable
 * per token.
 */
export async function uploadStoryPng(
  shareToken: string,
  pngBuffer: Buffer,
): Promise<string> {
  await ensureShareBucket();
  const objectPath = `s/${shareToken}-story.png`;
  await uploadWithRetry(objectPath, pngBuffer);
  return objectPath;
}

/**
 * Resolve a storage object path to its public URL. Used by the GET
 * /api/shares/:token route to embed `og:image` in the response.
 *
 * Format: {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}.
 * Anonymous read works because the bucket is public.
 */
export function publicUrl(objectPath: string): string {
  return `${baseUrl()}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

/**
 * Delete both share images for a token. Called from the revoke path
 * so the cached PNG stops serving (caches respect the short TTL we set
 * on upload, but a missing object 404s immediately on origin re-fetch).
 *
 * Best-effort: a missing object 404 is fine (idempotent revoke). Other
 * errors are logged by the caller; we don't throw because revoke must
 * succeed even when storage is degraded — the row's `revoked_at` is
 * the source of truth, and the GET endpoint already 404s on revoked.
 */
export async function deleteShareImages(shareToken: string): Promise<void> {
  await Promise.all([
    deleteOne(`s/${shareToken}.png`),
    deleteOne(`s/${shareToken}-story.png`),
  ]);
}

async function deleteOne(objectPath: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${baseUrl()}/storage/v1/object/${BUCKET}/${objectPath}`,
      {
        method: "DELETE",
        headers: { ...adminHeaders() },
      },
    );
  } catch (err) {
    // Network / DNS / TLS failure — log so an operator can correlate
    // a Supabase Storage outage with the resulting orphan PNGs.
    // Previously this branch was swallowed via `.catch(() => null)`,
    // hiding the failure mode from observability entirely.
    console.error(
      JSON.stringify({
        level: "error",
        t: new Date().toISOString(),
        evt: "share_storage_delete_failed",
        reason: "network",
        objectPath,
        msg: err instanceof Error ? err.message : String(err),
      }),
    );
    return;
  }
  if (res.ok || res.status === 404) return;
  // Non-blocking — caller already accepted that revoke succeeds even
  // when image deletion doesn't. Log via console.error so the operator
  // can investigate if a delete keeps failing.
  const text = await res.text().catch(() => "");
  console.error(
    JSON.stringify({
      level: "error",
      t: new Date().toISOString(),
      evt: "share_storage_delete_failed",
      reason: "http",
      objectPath,
      status: res.status,
      msg: text,
    }),
  );
}
