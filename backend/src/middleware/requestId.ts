import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

// Phase 20-P1: every request gets a short correlation id. Assigned here so
// downstream handlers (errorHandler, the request-logger, and any stream
// handler that wants to tag its own log lines) can include it. Echoed in
// the `X-Request-ID` response header so the client — or a support ticket —
// can paste the id back and we can pull the exact log line.
//
// nanoid(8) gives ~48 bits of entropy, enough that we won't collide within
// the rolling log window but short enough for a human to dictate.
//
// Trust an incoming X-Request-ID only when it matches a safe shape; a
// client can usefully propagate ids across a multi-service trace, but must
// not be able to stuff arbitrary junk into our log.
const SAFE_ID = /^[A-Za-z0-9_-]{6,32}$/;

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : nanoid(8);
  req.id = id;
  res.setHeader("X-Request-ID", id);
  next();
}
