import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

// Thrown from routes/services when a specific HTTP status is meaningful
// (404 not-found, 409 conflict, 422 unsupported). Anything else still falls
// through to the generic 500.
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => i.message).join("; ");
    console.error("[error] 400 (zod)", detail);
    res.status(400).json({ error: detail });
    return;
  }
  if (err instanceof HttpError) {
    // 401s are routine traffic (every protected route hit without a valid
    // token — expected on sign-out, fresh tab, expired session). Skip the
    // log so authMiddleware doesn't turn into a noise source.
    if (err.status !== 401) {
      console.error(`[error] ${err.status}`, err.message);
    }
    res.status(err.status).json({ error: err.message });
    return;
  }
  // 500 is the path for *unexpected* errors — the message often contains
  // internal details (file paths, SQL, stack fragments) that should not leak
  // to the client. Log the full error server-side; return a generic string.
  const message = err instanceof Error ? err.message : String(err);
  console.error("[error] 500", message, err instanceof Error ? err.stack : "");
  res.status(500).json({ error: "Internal error" });
};
