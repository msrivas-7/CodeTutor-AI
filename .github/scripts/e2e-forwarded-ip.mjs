#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Map a CI job namespace onto an address in 2001:db8::/32, the IPv6 prefix
 * reserved for documentation. Each isolated Docker stack then exercises the real
 * trusted-proxy and per-IP quota path without sharing one database counter.
 */
export function e2eForwardedIp(namespace) {
  const normalized = String(namespace ?? "").trim();
  if (!normalized || normalized.length > 240) {
    throw new Error("E2E namespace must contain 1-240 characters");
  }
  const digest = createHash("sha256").update(`codetutor-e2e-client-v1:${normalized}`).digest();
  const segments = Array.from({ length: 6 }, (_, index) =>
    digest.readUInt16BE(index * 2).toString(16));
  return `2001:db8:${segments.join(":")}`;
}

function main() {
  const namespace = process.argv[2];
  if (!namespace) throw new Error("Usage: e2e-forwarded-ip.mjs <job-namespace>");
  console.log(e2eForwardedIp(namespace));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
