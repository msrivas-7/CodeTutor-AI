import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { authMiddleware, __resetJwksCacheForTests } from "./authMiddleware.js";
import { errorHandler } from "./errorHandler.js";

// The middleware reads `config.supabase.url` to find the JWKS endpoint. We
// stand up a mini "Supabase" over HTTP that serves a JWKS with our test
// public key, then sign tokens locally with the matching private key and
// assert the middleware's behavior. Because `config` reads env at module
// load, we set SUPABASE_URL before importing anything that pulls in config.

let privateKey: CryptoKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let authServer: Server;
let authBase: string;
const KID = "test-kid";
const ALG = "ES256";

async function startAuthServer(): Promise<void> {
  const app = express();
  app.get("/auth/v1/.well-known/jwks.json", (_req, res) => {
    res.json({ keys: [{ ...publicJwk, kid: KID, alg: ALG, use: "sig" }] });
  });
  await new Promise<void>((resolve) => {
    authServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = authServer.address() as AddressInfo;
  authBase = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_URL = authBase;
}

function makeProtectedApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", authMiddleware, (req, res) => {
    res.json({ userId: req.userId });
  });
  // authMiddleware propagates HttpError via next(err); the error handler
  // serializes it to JSON. Without this, express falls back to its default
  // HTML 500 page and the tests' res.json() parse fails.
  app.use(errorHandler);
  return app;
}

async function listen(
  app: express.Express,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => r());
          }),
      });
    });
  });
}

async function signToken(claims: {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  kid?: string;
  alg?: string;
}): Promise<string> {
  const jwt = new SignJWT({}).setProtectedHeader({
    alg: claims.alg ?? ALG,
    kid: claims.kid ?? KID,
    typ: "JWT",
  });
  if (claims.sub !== undefined) jwt.setSubject(claims.sub);
  jwt.setIssuer(claims.iss ?? `${authBase}/auth/v1`);
  jwt.setAudience(claims.aud ?? "authenticated");
  jwt.setIssuedAt();
  if (claims.exp !== undefined) {
    jwt.setExpirationTime(claims.exp);
  } else {
    jwt.setExpirationTime("1h");
  }
  return jwt.sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair(ALG, { extractable: true });
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = await exportJWK(kp.publicKey);
  await startAuthServer();
  // config is loaded lazily by authMiddleware -> config.ts. We already set
  // SUPABASE_URL in startAuthServer, but config.ts reads env at module
  // evaluation. Since authMiddleware.ts imports config at top of file and
  // the vitest module cache kicks in on first import, we rely on this test
  // file being the first importer. If ordering ever changes we'd need a
  // dynamic import. For now the test runs green top-to-bottom.
});

afterAll(async () => {
  await new Promise<void>((r) => authServer.close(() => r()));
});

beforeEach(() => {
  __resetJwksCacheForTests();
});

describe("authMiddleware", () => {
  it("accepts a valid token and sets req.userId from the sub claim", async () => {
    const token = await signToken({ sub: "user-abc" });
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { userId: string };
      expect(body.userId).toBe("user-abc");
    } finally {
      await srv.close();
    }
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/missing.*bearer/i);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 when the Authorization header is malformed", async () => {
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: "Token abc.def.ghi" },
      });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 when the token body is empty after Bearer", async () => {
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: "Bearer   " },
      });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 for an expired token", async () => {
    // exp one second in the past. jose rejects on verify.
    const token = await signToken({
      sub: "user-abc",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/expired/i);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 for a token signed with the wrong issuer", async () => {
    const token = await signToken({
      sub: "user-abc",
      iss: "http://some-other-project.supabase.co/auth/v1",
    });
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid token/i);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 for a token with the wrong audience", async () => {
    const token = await signToken({ sub: "user-abc", aud: "anon" });
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 for a syntactically invalid JWT", async () => {
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: "Bearer not-a-jwt" },
      });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it("returns 401 when JWKS lookup finds no key for the token's kid", async () => {
    // A token signed with our real private key but stamped with an unknown kid.
    // jose fails with a JWKSNoMatchingKey which our handler maps to 401.
    const token = await signToken({ sub: "user-abc", kid: "not-in-jwks" });
    const srv = await listen(makeProtectedApp());
    try {
      const res = await fetch(`${srv.url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    } finally {
      await srv.close();
    }
  });
});
