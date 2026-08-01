import { Router } from "express";
import { config } from "../config.js";
import {
  getSharedByToken,
  type SharedCompletion,
} from "../db/sharedCompletions.js";
import {
  sharePreviewDuration,
  sharePreviewRequests,
} from "../services/metrics.js";
import {
  createSharePreviewAuthenticator,
  SHARE_PREVIEW_AUTH_HEADERS,
  type SharePreviewAuthKey,
} from "../services/share/previewAuth.js";
import { isSharePreviewDisabled } from "../services/share/killSwitches.js";
import { publicUrl } from "../services/share/storage.js";

const TOKEN_RE = /^[a-z2-9]{12}$/i;

export interface SharePreviewDto {
  schemaVersion: 1;
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  mastery: "strong" | "okay" | "shaky";
  timeSpentMs: number;
  attemptCount: number;
  displayName: string | null;
  ogImageUrl: string | null;
}

function toPreviewDto(share: SharedCompletion): SharePreviewDto {
  return {
    schemaVersion: 1,
    lessonTitle: share.lessonTitle,
    lessonOrder: share.lessonOrder,
    courseTitle: share.courseTitle,
    mastery: share.mastery,
    timeSpentMs: share.timeSpentMs,
    attemptCount: share.attemptCount,
    displayName: share.displayName,
    ogImageUrl: share.ogImagePath ? publicUrl(share.ogImagePath) : null,
  };
}

type PreviewMetricOutcome =
  | "ok"
  | "not_found"
  | "unconfigured"
  | "disabled"
  | "rate_limited"
  | "auth_malformed"
  | "auth_bad_signature"
  | "auth_stale"
  | "auth_replayed"
  | "error";

function productionKeys(): SharePreviewAuthKey[] {
  const keys: SharePreviewAuthKey[] = [];
  const auth = config.share.previewAuth;
  if (auth.currentSecret) {
    keys.push({ id: auth.currentKeyId, secret: auth.currentSecret });
  }
  if (auth.previousKeyId && auth.previousSecret) {
    keys.push({ id: auth.previousKeyId, secret: auth.previousSecret });
  }
  return keys;
}

export function createSharePreviewRouter(options: {
  keys?: readonly SharePreviewAuthKey[];
  now?: () => number;
  maxSkewMs?: number;
  nonceCacheMax?: number;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  getShare?: (token: string) => Promise<SharedCompletion | null>;
  isDisabled?: () => Promise<boolean>;
  recordMetric?: (outcome: PreviewMetricOutcome, seconds: number) => void;
} = {}): Router {
  const now = options.now ?? Date.now;
  const authenticator = createSharePreviewAuthenticator({
    keys: options.keys ?? productionKeys(),
    now,
    maxSkewMs:
      options.maxSkewMs ?? config.share.previewAuth.maxSkewMs,
    nonceCacheMax:
      options.nonceCacheMax ?? config.share.previewAuth.nonceCacheMax,
  });
  const rateLimitWindowMs =
    options.rateLimitWindowMs ?? config.share.previewRateLimit.windowMs;
  const rateLimitMax = options.rateLimitMax ?? config.share.previewRateLimit.max;
  const getShare = options.getShare ?? getSharedByToken;
  const isDisabled = options.isDisabled ?? isSharePreviewDisabled;
  const recordMetric =
    options.recordMetric ??
    ((outcome: PreviewMetricOutcome, seconds: number) => {
      sharePreviewRequests.inc({ outcome });
      sharePreviewDuration.observe({ outcome }, seconds);
    });

  const budget = new Map<string, { count: number; resetAt: number }>();
  const router = Router();

  router.get("/:token", async (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const finish = (outcome: PreviewMetricOutcome): void => {
      if (recorded) return;
      recorded = true;
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      recordMetric(outcome, seconds);
    };

    // Internal responses must never be cached by a shared proxy: the SWA
    // adapter owns the short revocation-aware cache and degraded behavior.
    res.setHeader("Cache-Control", "private, no-store");

    try {
      const rawToken = req.params.token ?? "";
      if (!TOKEN_RE.test(rawToken)) {
        finish("not_found");
        return res.status(404).json({ error: "share not found" });
      }
      const token = rawToken.toLowerCase();
      const canonicalPath = `/api/internal/share-previews/${token}`;

      if (!authenticator.configured) {
        finish("unconfigured");
        return res.status(503).json({ error: "share preview unavailable" });
      }

      const headers: Record<string, string | undefined> = {};
      for (const name of Object.values(SHARE_PREVIEW_AUTH_HEADERS)) {
        headers[name] = req.header(name) ?? undefined;
      }
      const auth = authenticator.verify({
        method: req.method,
        canonicalPath,
        headers,
      });
      if (!auth.ok) {
        finish(`auth_${auth.reason}` as PreviewMetricOutcome);
        // All authentication failures are intentionally indistinguishable to
        // the caller. The private metric retains the bounded reason for ops.
        return res.status(401).json({ error: "share preview unavailable" });
      }

      if (await isDisabled()) {
        finish("disabled");
        return res.status(503).json({ error: "share preview unavailable" });
      }

      const at = now();
      let entry = budget.get(auth.keyId);
      if (!entry || entry.resetAt <= at) {
        entry = { count: 0, resetAt: at + rateLimitWindowMs };
        budget.set(auth.keyId, entry);
      }
      if (entry.count >= rateLimitMax) {
        finish("rate_limited");
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((entry.resetAt - at) / 1000))),
        );
        return res.status(429).json({ error: "share preview unavailable" });
      }
      entry.count += 1;

      const share = await getShare(token);
      if (!share) {
        finish("not_found");
        return res.status(404).json({ error: "share not found" });
      }

      finish("ok");
      return res.json(toPreviewDto(share));
    } catch (err) {
      finish("error");
      return next(err);
    }
  });

  return router;
}

export const sharePreviewRouter = createSharePreviewRouter();
