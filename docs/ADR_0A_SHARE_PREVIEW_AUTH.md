# ADR 0A — purpose-specific authentication for share previews

Date: 2026-07-31

Status: accepted for Release 0A

Decision owners: Staff Security and Staff SRE persona review

## Context

Azure Static Web Apps renders crawler metadata at `/api/share/:token`. Before
0A, that adapter fetched the human-facing `GET /api/shares/:token` route. A
crawler therefore consumed the public lookup and hit budgets, incremented
`view_count`, and could keep an otherwise orphaned image alive. Shared SWA
egress also meant one preview burst could reduce capacity for unrelated human
readers.

The adapter needs only a small metadata projection. It must not receive a
general internal bypass, user credential, code, reader count, owner identity,
or storage path.

## Decision

Use one narrow service contract:

- `GET /api/internal/share-previews/:token` is the only privileged route.
- The SWA adapter signs each lookup with HMAC-SHA256 using a dedicated 32-byte
  random secret. The credential has no authority on any other endpoint.
- The canonical v1 message is six newline-separated values:
  `codetutor-share-preview-v1`, `GET`, canonical path, Unix timestamp in
  seconds, random nonce, and key ID.
- Requests carry `x-codetutor-preview-key-id`, `-timestamp`, `-nonce`, and
  `-signature`. Signatures are compared in constant time.
- The backend accepts only a 30-second freshness window and one use of each
  key-ID/nonce pair. The bounded replay cache holds at most 10,000 entries.
- Current and previous key IDs can overlap during rotation. The SWA adapter
  signs with one current key; the backend verifies both.
- The response schema is versioned and contains only lesson title/order,
  course title, mastery, bounded time/attempt values, optional display name,
  and the resolved OG image URL. It excludes code, course/lesson IDs, user/IP
  identity, view count, story image, timestamps, and raw storage paths.

Today production has one active backend replica, so the in-process replay
cache is authoritative. Adding a second active replica requires a shared,
bounded nonce store before traffic is split; the route must not be horizontally
scaled while each replica can accept the same nonce independently.

## Isolation and failure behavior

- Preview traffic has a separate fixed-window service budget: 600 successful
  authenticated admissions per minute per key, before database lookup.
- It never calls or falls back to `/api/shares/:token`; public reader buckets
  and view mutation are unreachable from the adapter path.
- The SWA adapter coalesces same-token requests and keeps bounded LRU state:
  30 seconds for image-ready metadata, 2 seconds while an image is pending,
  and 10 seconds for not-found responses. Image-ready HTTP responses advertise
  the same 30-second `must-revalidate` window so an intermediary controlled by
  CodeTutor cannot extend the adapter's revocation delay.
- A new share receives at most two short upstream reads (800 ms each with a
  200 ms readiness gap). There is no unbounded retry loop.
- Three sustained upstream failures open a 10-second circuit. Authentication
  rejection opens a 30-second circuit immediately because it indicates
  configuration drift rather than a share-specific failure.
- Timeout, 401, 429, 5xx, invalid DTO, missing credential, and either preview
  kill switch produce safe generic CodeTutor metadata with a five-second
  revalidation window. A genuine authenticated 404 remains 404.
- Generic degradation still points to the public `/s/:token` artifact, but
  the adapter never fetches the counting reader API to construct it.

## Operations

- Backend switch: `share_preview_disabled` (DB-first, environment fallback).
  It does not disable human share reads.
- Adapter switch: SWA application setting `SHARE_PREVIEW_DISABLED`.
- Backend metrics:
  `share_preview_requests_total{outcome}` and
  `share_preview_duration_seconds{outcome}`. Labels are bounded and contain no
  token, signature, key, or IP.
- Adapter logs only bounded failure reasons and circuit transitions. It never
  logs a signature, secret, nonce, or raw share token.
- SWA API application settings are encrypted at rest and copied to staging
  environments by Azure. Backend secrets remain in Key Vault and reach the VM
  through the existing managed-identity `refresh-env` path.

Rotation order:

1. Generate a new 32-byte base64 secret and unique key ID.
2. Put the old pair in backend `PREVIOUS` and the new pair in backend
   `CURRENT`; refresh/recreate the backend.
3. Verify both signed probes succeed.
4. update the SWA `KEY_ID` and `SECRET` application settings to the new pair.
5. After the 30-second auth window, 30-second adapter cache, and deployment
   health checks clear, remove the backend previous pair.

Emergency revocation sets both preview kill switches first, removes the
compromised key, provisions a new current key, then reenables the path after a
signed probe. Public human share viewing remains independent throughout.

## Review decision

The repository's Staff Security persona approves this narrow contract because
it binds method/path/freshness/nonce, supports rotation and revocation, fails
closed, returns a minimal DTO, preserves anti-enumeration, and does not create a
general bypass. The Staff SRE persona approves it because budgets, timeouts,
coalescing, bounded cache, circuit breaking, actionable metrics, degraded
behavior, and a dedicated kill switch are explicit and testable.

This records the requested structured persona approval, not an external human
security audit.

## Rejected alternatives

- A static bearer header: no replay protection and easy accidental reuse.
- Client/user JWT: wrong principal and couples crawler uptime to user auth.
- Managed identity for the SWA managed Function: substantially more platform
  coupling for one narrow caller and not available as the existing portable
  local/preview contract.
- A reusable service-auth middleware: premature authority expansion.
- Falling back to the public endpoint: recreates both 0A defects.
- Long-lived metadata caching: makes revocation behavior unnecessarily stale.
