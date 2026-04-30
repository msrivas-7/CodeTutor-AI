import type { NextFunction, Request, Response } from "express";

import { httpResponses } from "../services/metrics.js";

// Phase 23 P0 #5: HTTP error-rate observability. Increments
// `http_responses_total{status}` once per response so the
// `429 + 503 rate > 5% sustained 10 min` alert has data to evaluate.
//
// Hook: `res.on("finish")` fires after Express has flushed the
// response (status + headers + body). `res.statusCode` is the final
// code at that point — including any code set by an error handler
// downstream of this middleware. We count exactly one event per
// request, so the rate is `429+503 / total` not `429+503 / requests-
// that-reached-our-router`. Background-task responses (cron logs,
// metrics scrape) don't fire — they don't go through the Express
// router.
//
// Kept tiny + side-effecting. Failure modes: counter exhaustion (won't
// happen at our cardinality — bounded set of status codes).
export function responseMetrics(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    httpResponses.inc({ status: String(res.statusCode) });
  });
  next();
}
