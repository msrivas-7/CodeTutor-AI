import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

// Thrown from routes/services when a specific HTTP status is meaningful
// (404 not-found, 409 conflict, 422 unsupported). Anything else still falls
// through to the generic 500.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Defense-in-depth: unknown-error paths (500s) serialize `err.message` and
// `err.stack` straight into the log line. Upstream SDKs sometimes echo
// request metadata (auth headers) or DB/JWT strings in error objects; the
// client sees only "Internal error" + requestId, so this guards logs.
const OPENAI_KEY_PATTERN = /sk[-_][A-Za-z0-9_-]{20,}/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const POSTGRES_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"'<>]+/g;
function scrubSecrets(s: string): string {
  return s
    .replace(OPENAI_KEY_PATTERN, "sk-<redacted>")
    .replace(JWT_PATTERN, "<jwt-redacted>")
    .replace(POSTGRES_URL_PATTERN, "postgres://<redacted>");
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => i.message).join("; ");
    console.error(
      JSON.stringify({ level: "warn", t: new Date().toISOString(), id: req.id, status: 400, err: "zod", detail }),
    );
    res.status(400).json({ error: detail });
    return;
  }
  if (err instanceof HttpError) {
    // 401s are routine traffic (every protected route hit without a valid
    // token — expected on sign-out, fresh tab, expired session). Skip the
    // log so authMiddleware doesn't turn into a noise source.
    if (err.status !== 401) {
      console.error(
        JSON.stringify({
          level: "warn",
          t: new Date().toISOString(),
          id: req.id,
          status: err.status,
          err: err.message,
        }),
      );
    }
    if (err.headers) {
      for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    }
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Phase 20-P1: body-parser throws PayloadTooLargeError (from raw-body) when
  // the streamed body exceeds express.json's `limit`. Our per-router
  // bodyLimit precheck rejects most oversize traffic earlier, but the global
  // 1 MB ceiling still fires for requests that either lied about
  // Content-Length or omitted it and then streamed past the cap. Map to 413
  // so clients see a meaningful status instead of a generic 500.
  if (
    err instanceof Error &&
    (err as { type?: string }).type === "entity.too.large"
  ) {
    console.error(
      JSON.stringify({
        level: "warn",
        t: new Date().toISOString(),
        id: req.id,
        status: 413,
        err: err.message,
      }),
    );
    res.status(413).json({ error: "payload too large" });
    return;
  }
  // 500 is the path for *unexpected* errors — the message often contains
  // internal details (file paths, SQL, stack fragments) that should not leak
  // to the client. Log the full error server-side; return a generic string
  // plus the request id so a support ticket can map back to this log line.
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : "";
  console.error(
    JSON.stringify({
      level: "error",
      t: new Date().toISOString(),
      id: req.id,
      status: 500,
      err: scrubSecrets(message),
      stack: stack ? scrubSecrets(stack) : stack,
    }),
  );
  res.status(500).json({ error: "Internal error", requestId: req.id });
};
