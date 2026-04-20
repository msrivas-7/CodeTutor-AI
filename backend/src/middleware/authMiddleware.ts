import type { Request, Response, NextFunction } from "express";
import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { config } from "../config.js";
import { HttpError } from "./errorHandler.js";

// Read the auth server base URL once — it doesn't change at runtime. Falls
// back to config (which reads env at module load) if process.env was updated
// after import, which is how the unit tests hand us a fake Supabase address.
// The test-reset helper (__resetJwksCacheForTests) also clears the memoized
// URL so each spec can point at a fresh auth server.
let cachedAuthServerUrl: string | null = null;
function authServerUrl(): string {
  if (cachedAuthServerUrl) return cachedAuthServerUrl;
  const url = process.env.SUPABASE_URL ?? config.supabase.url;
  if (!url) {
    throw new Error(
      "[auth] SUPABASE_URL is not set; assertConfigValid() should have " +
        "caught this at boot. Check your env file.",
    );
  }
  cachedAuthServerUrl = url;
  return cachedAuthServerUrl;
}

// The issuer claim we expect on tokens. Defaults to `<SUPABASE_URL>/auth/v1`
// which matches what GoTrue mints in normal cloud deployments. Local dev is
// the odd one out: the backend reaches Supabase on one URL
// (host.docker.internal) while GoTrue signs tokens with a different URL
// (127.0.0.1 — what the browser sees). SUPABASE_AUTH_ISSUER overrides the
// default for that case.
let cachedAuthIssuer: string | null = null;
function authIssuer(): string {
  if (cachedAuthIssuer) return cachedAuthIssuer;
  const override = process.env.SUPABASE_AUTH_ISSUER ?? config.supabase.authIssuer;
  if (override && override.trim() !== "") {
    cachedAuthIssuer = override.trim();
  } else {
    cachedAuthIssuer = new URL("/auth/v1", authServerUrl()).toString();
  }
  return cachedAuthIssuer;
}

/**
 * Phase 18a: verify Supabase access tokens on protected routes.
 *
 * Threat model: the backend trusts `req.userId` downstream for session
 * ownership checks, rate-limit bucketing, and (in 18b) DB row-level access.
 * Anything that sets `req.userId` is therefore security-critical. We verify
 * the browser's access token via JWKS — asymmetric ES256 keys published by
 * the Supabase Auth server at `/auth/v1/.well-known/jwks.json`. The backend
 * needs no shared secret; it only needs the public key, which it fetches
 * lazily on first request and caches.
 *
 * Why JWKS, not the HS256 `SUPABASE_JWT_SECRET`: modern Supabase (CLI 2.90+)
 * signs with asymmetric keys and rotates them. Verifying against a single
 * static secret is the legacy path — it works today but breaks the moment
 * Supabase rotates or an admin rolls the signing key. `createRemoteJWKSet`
 * handles kid-based key selection and rotation transparently.
 *
 * Mounted AFTER `csrfGuard` and rate limits, BEFORE route handlers. Order
 * matters: CSRF runs cheap header checks first, rate limits cap the burst
 * surface, then we spend the JWKS verification on what's left.
 *
 * Public routes (not wrapped): `/api/health`, `/api/ai/validate-key` (the
 * learner's BYOK self-test — stateless, no session reference).
 */

// Augment Express Request so downstream handlers can read req.userId without
// casting. Any middleware that sets req.userId is effectively asserting
// authentication succeeded.
declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
    authClaims?: JWTPayload;
  }
}

// Lazy JWKS — don't hit the network at import time. Instantiated on first
// authenticated request and reused forever (the jose cache handles rotation
// via kid lookup + refetch).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const url = new URL("/auth/v1/.well-known/jwks.json", authServerUrl());
  jwks = createRemoteJWKSet(url, {
    // jose's default is already generous; pinning it here makes the posture
    // explicit. If the auth server is down when a token shows up, we'd
    // rather 503 quickly than hang the request.
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });
  return jwks;
}

/**
 * Test-only: wipe the cached JWKS client so unit tests can swap the auth
 * server between specs. Never called from production code.
 */
export function __resetJwksCacheForTests(): void {
  jwks = null;
  cachedAuthServerUrl = null;
  cachedAuthIssuer = null;
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.get("authorization") ?? req.get("Authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw new HttpError(401, "missing bearer token");
    }
    const token = header.slice("bearer ".length).trim();
    if (!token) throw new HttpError(401, "empty bearer token");

    const { payload } = await jwtVerify(token, getJwks(), {
      // Supabase issues tokens as `<SUPABASE_URL>/auth/v1`. We validate
      // the issuer so a token minted by a different project (dev vs. prod
      // misconfig, or a different cloud account entirely) can't be
      // accepted here.
      issuer: authIssuer(),
      // GoTrue sets aud="authenticated" for signed-in users. Anonymous
      // logins would use aud="anon" — we disabled those in config.toml,
      // so only "authenticated" is valid.
      audience: "authenticated",
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) throw new HttpError(401, "token missing sub claim");
    req.userId = sub;
    req.authClaims = payload;
    next();
  } catch (err) {
    // HttpError from the guards above just propagates — the global
    // errorHandler serializes it and skips the noisy log for 401s.
    if (err instanceof HttpError) return next(err);
    // Branch on jose's typed errors so we can return actionable messages
    // without leaking internals. Anything else collapses to a generic 401.
    if (err instanceof joseErrors.JWTExpired) {
      return next(new HttpError(401, "token expired"));
    }
    if (
      err instanceof joseErrors.JWTClaimValidationFailed ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWSInvalid ||
      err instanceof joseErrors.JWTInvalid
    ) {
      return next(new HttpError(401, "invalid token"));
    }
    // kid not found in JWKS — usually a token minted for a different project,
    // or a stale token signed with a rotated-out key. Same user-facing result
    // as a plain invalid-token, but we log distinctly for operability.
    if (err instanceof joseErrors.JWKSNoMatchingKey) {
      console.error("[auth] jwks: no matching key for token kid");
      return next(new HttpError(401, "invalid token"));
    }
    // Upstream auth server is unreachable / slow. 503 is the honest answer —
    // this is a transient server-side problem, not a client credential issue.
    // Distinguishing this from 401 keeps "silent auth outage" out of "user
    // got logged out" alerts.
    if (err instanceof joseErrors.JWKSTimeout) {
      console.error("[auth] jwks: timeout fetching keys");
      return next(new HttpError(503, "auth server unavailable"));
    }
    // JWKS fetch failure, unknown error. The client can't fix it; log
    // server-side and 401 so the UI falls back to the sign-in page.
    console.error("[auth] jwks/verify error:", (err as Error).message);
    return next(new HttpError(401, "token verification failed"));
  }
}
