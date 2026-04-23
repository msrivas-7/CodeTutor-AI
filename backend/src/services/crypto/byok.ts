import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { config } from "../../config.js";
import { byokDecryptFailures } from "../metrics.js";

// AES-256-GCM envelope for user-supplied OpenAI keys. GCM gives us
// confidentiality + authenticity in one shot — the 16-byte auth tag is
// appended to the ciphertext on encrypt, split off and verified on decrypt,
// so a tampered cipher column throws instead of returning garbage.
//
// Ciphertext layout (single bytea column; nonce lives in its own column):
//
//   [1 byte version] [ciphertext …] [16-byte auth tag]
//
// The version byte is bound into the GCM auth tag as additional associated
// data alongside the user id, so a row-swap attack (copying user A's cipher
// + nonce into user B's row) fails the tag check instead of silently
// decrypting A's OpenAI key under B's identity. Version also gives us a
// clean upgrade path: bumping to 0x02 with a second master key lets new
// writes land under the new key while old reads keep working until a
// re-encrypt migration catches up. Today only v1 is defined.
//
// Rotation plan (when it comes up): add BYOK_ENCRYPTION_KEY_V2 to env,
// bump CURRENT_VERSION to 0x02, teach masterKey(version) to return the
// matching key, and re-save rewrites under v2. Losing the master key still
// invalidates every stored row; only the row user re-enters their key.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const CURRENT_VERSION = 0x01;

let cachedKey: Buffer | null = null;

function masterKey(version: number): Buffer {
  if (version !== CURRENT_VERSION) {
    throw new Error(`[byok] unsupported cipher version 0x${version.toString(16)}`);
  }
  if (cachedKey) return cachedKey;
  const raw = config.byokEncryptionKey;
  if (!raw) {
    // Should never reach here — assertConfigValid() gates on this at boot.
    throw new Error("[byok] BYOK_ENCRYPTION_KEY not configured");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `[byok] BYOK_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`,
    );
  }
  cachedKey = buf;
  return buf;
}

// AAD binds the ciphertext to both the version byte and the owning user.
// Re-deriving the same bytes at decrypt-time is required for the tag to
// verify — any divergence (swapped row, wrong user, altered version byte)
// throws inside `decipher.final()`.
function buildAad(version: number, userId: string): Buffer {
  return Buffer.concat([
    Buffer.from([version]),
    Buffer.from(userId, "utf8"),
  ]);
}

export function encryptKey(
  plaintext: string,
  userId: string,
): { cipher: Buffer; nonce: Buffer } {
  if (!userId) throw new Error("[byok] userId required for AAD binding");
  const nonce = randomBytes(IV_BYTES);
  const version = CURRENT_VERSION;
  const cipher = createCipheriv(ALGO, masterKey(version), nonce);
  cipher.setAAD(buildAad(version, userId));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    cipher: Buffer.concat([Buffer.from([version]), encrypted, tag]),
    nonce,
  };
}

export function decryptKey(
  cipher: Buffer,
  nonce: Buffer,
  userId: string,
): string {
  if (!userId) throw new Error("[byok] userId required for AAD binding");
  if (cipher.length < 1 + TAG_BYTES + 1) {
    byokDecryptFailures.inc();
    throw new Error("[byok] ciphertext too short");
  }
  const version = cipher[0];
  const tag = cipher.subarray(cipher.length - TAG_BYTES);
  const body = cipher.subarray(1, cipher.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGO, masterKey(version), nonce);
    decipher.setAAD(buildAad(version, userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch (err) {
    // Any throw inside the GCM pipeline — unsupported version, wrong master
    // key, tampered tag, row-swap attempt — funnels here. Tick the counter
    // AND emit a structured log line so the alert rule can key on either
    // the scraped metric or the log pattern. Keep the rethrow shape intact
    // so callers can't tell the difference between this path and the old
    // one (no error-shape regression).
    byokDecryptFailures.inc();
    console.error(
      JSON.stringify({
        level: "error",
        t: new Date().toISOString(),
        err: "byok_decrypt_failed",
        version,
        message: (err as Error).message,
      }),
    );
    throw err;
  }
}
