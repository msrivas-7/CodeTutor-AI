import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalSharePreviewRequest,
  createSharePreviewAuthenticator,
  SHARE_PREVIEW_AUTH_HEADERS,
  signSharePreviewRequest,
} from "./previewAuth.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../../../../contracts/share-preview-auth-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  version: string;
  method: string;
  canonicalPath: string;
  timestamp: string;
  nonce: string;
  keyId: string;
  secretRecipe: {
    kind: "ascending-bytes";
    start: number;
    length: number;
  };
  signatureBase64Url: string;
};

const vectorSecret = Buffer.from(
  Array.from(
    { length: vector.secretRecipe.length },
    (_, index) => vector.secretRecipe.start + index,
  ),
).toString("base64");

function headers(overrides: Record<string, string> = {}) {
  return {
    [SHARE_PREVIEW_AUTH_HEADERS.keyId]: vector.keyId,
    [SHARE_PREVIEW_AUTH_HEADERS.timestamp]: vector.timestamp,
    [SHARE_PREVIEW_AUTH_HEADERS.nonce]: vector.nonce,
    [SHARE_PREVIEW_AUTH_HEADERS.signature]: vector.signatureBase64Url,
    ...overrides,
  };
}

describe("share preview HMAC contract", () => {
  it("matches the cross-runtime v1 signing vector", () => {
    expect(
      canonicalSharePreviewRequest({
        method: vector.method,
        canonicalPath: vector.canonicalPath,
        timestamp: vector.timestamp,
        nonce: vector.nonce,
        keyId: vector.keyId,
      }),
    ).toBe(
      [
        vector.version,
        vector.method,
        vector.canonicalPath,
        vector.timestamp,
        vector.nonce,
        vector.keyId,
      ].join("\n"),
    );
    expect(
      signSharePreviewRequest({
        method: vector.method,
        canonicalPath: vector.canonicalPath,
        timestamp: vector.timestamp,
        nonce: vector.nonce,
        keyId: vector.keyId,
        secret: vectorSecret,
      }),
    ).toBe(vector.signatureBase64Url);
  });

  it("accepts current and previous keys during rotation", () => {
    const previous = {
      id: "2026-06-z",
      secret: Buffer.alloc(32, 7).toString("base64"),
    };
    const auth = createSharePreviewAuthenticator({
      keys: [
        { id: vector.keyId, secret: vectorSecret },
        previous,
      ],
      now: () => Number(vector.timestamp) * 1000,
    });
    expect(
      auth.verify({
        method: vector.method,
        canonicalPath: vector.canonicalPath,
        headers: headers(),
      }),
    ).toEqual({ ok: true, keyId: vector.keyId });

    const nonce = "AgMEBQYHCAkKCwwNDg8QERIT";
    const timestamp = vector.timestamp;
    const signature = signSharePreviewRequest({
      method: "GET",
      canonicalPath: vector.canonicalPath,
      timestamp,
      nonce,
      keyId: previous.id,
      secret: previous.secret,
    });
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers({
          [SHARE_PREVIEW_AUTH_HEADERS.keyId]: previous.id,
          [SHARE_PREVIEW_AUTH_HEADERS.nonce]: nonce,
          [SHARE_PREVIEW_AUTH_HEADERS.signature]: signature,
        }),
      }),
    ).toEqual({ ok: true, keyId: previous.id });
  });

  it("rejects the old key after rotation overlap is removed", () => {
    const oldKey = {
      id: "2026-06-z",
      secret: Buffer.alloc(32, 7).toString("base64"),
    };
    const auth = createSharePreviewAuthenticator({
      keys: [{ id: vector.keyId, secret: vectorSecret }],
      now: () => Number(vector.timestamp) * 1000,
    });
    const nonce = "AgMEBQYHCAkKCwwNDg8QERIT";
    const signature = signSharePreviewRequest({
      method: "GET",
      canonicalPath: vector.canonicalPath,
      timestamp: vector.timestamp,
      nonce,
      keyId: oldKey.id,
      secret: oldKey.secret,
    });
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers({
          [SHARE_PREVIEW_AUTH_HEADERS.keyId]: oldKey.id,
          [SHARE_PREVIEW_AUTH_HEADERS.nonce]: nonce,
          [SHARE_PREVIEW_AUTH_HEADERS.signature]: signature,
        }),
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed, bad, stale, and replayed requests", () => {
    let now = Number(vector.timestamp) * 1000;
    const auth = createSharePreviewAuthenticator({
      keys: [{ id: vector.keyId, secret: vectorSecret }],
      now: () => now,
      maxSkewMs: 30_000,
    });

    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: {},
      }),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers({
          [SHARE_PREVIEW_AUTH_HEADERS.signature]: "A".repeat(43),
        }),
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });

    now += 31_000;
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers(),
      }),
    ).toEqual({ ok: false, reason: "stale" });

    now = Number(vector.timestamp) * 1000;
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers(),
      }),
    ).toEqual({ ok: true, keyId: vector.keyId });
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: headers(),
      }),
    ).toEqual({ ok: false, reason: "replayed" });

  });

  it("retains a future-dated nonce for its entire accepted window", () => {
    const initialNow = Number(vector.timestamp) * 1000;
    let now = initialNow;
    const futureTimestamp = String(Math.floor((initialNow + 30_000) / 1000));
    const nonce = "AgMEBQYHCAkKCwwNDg8QERIT";
    const signature = signSharePreviewRequest({
      method: "GET",
      canonicalPath: vector.canonicalPath,
      timestamp: futureTimestamp,
      nonce,
      keyId: vector.keyId,
      secret: vectorSecret,
    });
    const futureHeaders = headers({
      [SHARE_PREVIEW_AUTH_HEADERS.timestamp]: futureTimestamp,
      [SHARE_PREVIEW_AUTH_HEADERS.nonce]: nonce,
      [SHARE_PREVIEW_AUTH_HEADERS.signature]: signature,
    });
    const auth = createSharePreviewAuthenticator({
      keys: [{ id: vector.keyId, secret: vectorSecret }],
      now: () => now,
      maxSkewMs: 30_000,
    });

    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: futureHeaders,
      }),
    ).toEqual({ ok: true, keyId: vector.keyId });

    now += 60_000;
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: futureHeaders,
      }),
    ).toEqual({ ok: false, reason: "replayed" });

    now += 1;
    expect(
      auth.verify({
        method: "GET",
        canonicalPath: vector.canonicalPath,
        headers: futureHeaders,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("binds signatures to method, path, nonce, timestamp, and key id", () => {
    const auth = createSharePreviewAuthenticator({
      keys: [{ id: vector.keyId, secret: vectorSecret }],
      now: () => Number(vector.timestamp) * 1000,
    });
    const mutations: Array<{
      method: string;
      path: string;
      headerOverrides: Record<string, string>;
    }> = [
      { method: "POST", path: vector.canonicalPath, headerOverrides: {} },
      {
        method: "GET",
        path: `${vector.canonicalPath}x`,
        headerOverrides: {},
      },
      {
        method: "GET",
        path: vector.canonicalPath,
        headerOverrides: {
          [SHARE_PREVIEW_AUTH_HEADERS.nonce]:
            "BBBBBBBBBBBBBBBBBBBBBB",
        },
      },
      {
        method: "GET",
        path: vector.canonicalPath,
        headerOverrides: {
          [SHARE_PREVIEW_AUTH_HEADERS.keyId]: "2026-07-b",
        },
      },
    ];
    for (const mutation of mutations) {
      expect(
        auth.verify({
          method: mutation.method,
          canonicalPath: mutation.path,
          headers: headers(mutation.headerOverrides),
        }),
      ).toMatchObject({ ok: false });
    }
  });

  it("refuses noncanonical secrets and duplicate key ids", () => {
    expect(() =>
      createSharePreviewAuthenticator({
        keys: [{ id: "v1", secret: Buffer.alloc(16).toString("base64") }],
      }),
    ).toThrow(/canonical base64/);
    expect(() =>
      createSharePreviewAuthenticator({
        keys: [
          { id: "v1", secret: Buffer.alloc(32, 1).toString("base64") },
          { id: "v1", secret: Buffer.alloc(32, 2).toString("base64") },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});
