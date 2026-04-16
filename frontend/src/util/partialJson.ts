import type { TutorSections } from "../types";

const KEYS = [
  "whatIThink",
  "whatToCheck",
  "hint",
  "nextStep",
  "strongerHint",
] as const;

/**
 * Best-effort extractor for a partially-streamed tutor response. The model
 * emits a strict JSON object whose fields are one of KEYS. We walk the raw
 * buffer, locate each key, and extract the value string as far as the stream
 * has progressed — even when the closing quote hasn't arrived yet.
 *
 * Handles JSON string escapes (\n, \t, \", \\, \uXXXX) so live text reads
 * naturally. Unknown escapes pass through as the escaped character.
 */
export function parsePartialTutor(raw: string): TutorSections {
  if (!raw) return {};
  // Fast path: fully parseable JSON.
  try {
    return JSON.parse(raw) as TutorSections;
  } catch {
    /* fall through to best-effort */
  }

  const out: TutorSections = {};
  for (const key of KEYS) {
    const value = extractStringField(raw, key);
    if (value !== null) out[key] = value;
  }
  return out;
}

function extractStringField(raw: string, key: string): string | null {
  const needle = `"${key}"`;
  const at = raw.indexOf(needle);
  if (at === -1) return null;

  let i = at + needle.length;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== ":") return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i])) i++;

  // `null` field (the tutor leaves un-returned sections as null)
  if (raw.slice(i, i + 4) === "null") return null;

  if (raw[i] !== '"') return null;
  i++;

  let buf = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break;
      if (next === "n") buf += "\n";
      else if (next === "t") buf += "\t";
      else if (next === "r") buf += "\r";
      else if (next === '"') buf += '"';
      else if (next === "\\") buf += "\\";
      else if (next === "/") buf += "/";
      else if (next === "b") buf += "\b";
      else if (next === "f") buf += "\f";
      else if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        buf += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      } else {
        buf += next;
      }
      i += 2;
    } else if (c === '"') {
      return buf;
    } else {
      buf += c;
      i++;
    }
  }
  return buf;
}
