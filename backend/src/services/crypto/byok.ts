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
// clean upgrade path: bumping CURRENT_VERSION + adding a new key to the
// version map lets new writes land under the new key while old reads keep
// working — until a re-encrypt sweep catches up.
//
// Phase 26 (audit M-1): the version map is now real. Multiple master keys
// can coexist under BYOK_ENCRYPTION_KEY_V{N} env vars (legacy
// BYOK_ENCRYPTION_KEY = V1). encrypt() uses config.byokCurrentVersion
// for new writes; decrypt() reads the version byte from the ciphertext
// and looks up the matching key. Rotating no longer instantly fails
// existing rows.
//
// Rotation runbook (operator):
//   1. Generate K2; set BYOK_ENCRYPTION_KEY_V2 in Key Vault.
//   2. Deploy backend → V2 decryptable; old V1 rows still readable.
//   3. Set BYOK_CURRENT_VERSION=2 in KV → new writes encrypt under V2.
//   4. Run re-encrypt sweep over user_preferences (separate cron job)
//      whose byok_cipher_version=1.
//   5. After 0 v1 rows remain, drop BYOK_ENCRYPTION_KEY_V1 from KV.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

// Exported so writes set `user_preferences.byok_cipher_version` in
// lockstep with the version byte embedded in `openai_api_key_cipher[0]`.
// Used by the rotation runbook to find rows still on the old key after a
// master-key bump. Reads from config so a deploy with a different
// BYOK_CURRENT_VERSION env value flips the write target without code
// change.
export const BYOK_CURRENT_VERSION = config.byokCurrentVersion;

const cachedKeys = new Map<number, Buffer>();

function masterKey(version: number): Buffer {
  const cached = cachedKeys.get(version);
  if (cached) return cached;
  const raw = config.byokEncryptionKeys.get(version);
  if (!raw) {
    throw new Error(
      `[byok] no master key configured for version ${version} ` +
        `(set BYOK_ENCRYPTION_KEY_V${version} or BYOK_ENCRYPTION_KEY for V1)`,
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `[byok] BYOK_ENCRYPTION_KEY_V${version} must decode to 32 bytes (got ${buf.length})`,
    );
  }
  cachedKeys.set(version, buf);
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
  // Phase 26: encrypt under the operator-configured CURRENT version,
  // not a code-level constant. Lets the operator rotate by setting
  // BYOK_CURRENT_VERSION in env without a code release.
  const version = config.byokCurrentVersion;
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
