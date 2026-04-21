import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Mock the config module before byok.js imports it — byok caches the master
// key on first use and config.ts reads process.env at module load, so
// setting env in the test file is too late. Mock is the reliable path.
vi.mock("../../config.js", () => ({
  config: {
    byokEncryptionKey: randomBytes(32).toString("base64"),
  },
}));

const { decryptKey, encryptKey } = await import("./byok.js");

describe("byok envelope", () => {
  const userA = "user-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const userB = "user-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const plaintext = "sk-test-1234567890abcdefghij";

  it("round-trips plaintext for the owning user", () => {
    const { cipher, nonce } = encryptKey(plaintext, userA);
    expect(decryptKey(cipher, nonce, userA)).toBe(plaintext);
  });

  it("prepends the version byte 0x01 to ciphertext", () => {
    const { cipher } = encryptKey(plaintext, userA);
    expect(cipher[0]).toBe(0x01);
  });

  it("rejects decrypt under a different user id (AAD binding)", () => {
    const { cipher, nonce } = encryptKey(plaintext, userA);
    expect(() => decryptKey(cipher, nonce, userB)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const { cipher, nonce } = encryptKey(plaintext, userA);
    cipher[cipher.length - 1] ^= 0xff;
    expect(() => decryptKey(cipher, nonce, userA)).toThrow();
  });

  it("rejects a tampered version byte", () => {
    const { cipher, nonce } = encryptKey(plaintext, userA);
    cipher[0] = 0x02;
    expect(() => decryptKey(cipher, nonce, userA)).toThrow();
  });

  it("rejects a tampered ciphertext body", () => {
    const { cipher, nonce } = encryptKey(plaintext, userA);
    cipher[5] ^= 0x01;
    expect(() => decryptKey(cipher, nonce, userA)).toThrow();
  });

  it("rejects a wrong nonce", () => {
    const { cipher } = encryptKey(plaintext, userA);
    const wrongNonce = randomBytes(12);
    expect(() => decryptKey(cipher, wrongNonce, userA)).toThrow();
  });

  it("produces different ciphertexts for the same plaintext (nonce uniqueness)", () => {
    const a = encryptKey(plaintext, userA);
    const b = encryptKey(plaintext, userA);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.cipher.equals(b.cipher)).toBe(false);
  });

  it("requires a userId on both encrypt and decrypt", () => {
    expect(() => encryptKey(plaintext, "")).toThrow();
    const { cipher, nonce } = encryptKey(plaintext, userA);
    expect(() => decryptKey(cipher, nonce, "")).toThrow();
  });
});
