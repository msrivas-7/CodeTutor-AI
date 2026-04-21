import { Router } from "express";
import { registry } from "../services/metrics.js";

export const metricsRouter = Router();

// Prom exposition is text/plain; version=0.0.4. Using registry.contentType
// keeps the header in sync if a prom-client upgrade bumps the version.
metricsRouter.get("/", async (_req, res, next) => {
  try {
    res.setHeader("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    next(err);
  }
});
