// Phase B7 — observe-only suspect-symbol telemetry.
//
// After a tutor response completes, scan code-formatted spans for call-shaped
// symbols. A call is trusted only when its symbol is part of the supported
// language runtime, appears in a learner file, or is explicitly defined in the
// same tutor snippet. Learner questions are evidence, not authority: merely
// naming an API in a question must not make a fabricated answer look valid.
//
// A hit never blocks or mutates the response. It emits a bounded structured
// `tutor_suspect_api` event and increments the existing operational counter.
// This remains telemetry, not a proof that an API is invalid.

import { aiPlatformAbuseSignals } from "../metrics.js";

export const SUSPECT_API_DETECTOR_VERSION = "b7.1";

// Python builtins plus the standard-library and common object surfaces that a
// beginner tutor can legitimately name. This is intentionally explicit and
// reviewable; it is not a package-index allowlist.
const PYTHON_GLOBAL_ALLOWED = new Set([
  // builtins
  "print", "len", "input", "range", "str", "int", "float", "bool", "list",
  "dict", "set", "tuple", "type", "isinstance", "open", "enumerate", "zip",
  "map", "filter", "sorted", "reversed", "sum", "min", "max", "abs", "round",
  "help", "repr", "id", "hash", "iter", "next", "super", "getattr", "setattr",
  "hasattr", "vars", "dir", "ord", "chr", "format", "any", "all", "divmod",
  "pow", "exec", "eval", "globals", "locals", "issubclass", "callable",
  "property", "staticmethod", "classmethod", "memoryview", "bytes", "bytearray",
  "frozenset", "complex", "bin", "hex", "oct",
  // common stdlib modules, types, and entrypoints
  "import", "random", "randint", "choice", "shuffle", "sample", "math",
  "sqrt", "floor", "ceil", "datetime", "date", "timedelta", "timezone",
  "time", "sleep", "json", "loads", "dumps", "load", "dump", "os", "sys",
  "exit", "re", "match", "fullmatch", "search", "findall", "finditer", "sub",
  "compile", "collections", "Counter", "defaultdict", "namedtuple", "deque",
  "itertools", "functools", "reduce", "pathlib", "Path", "statistics", "mean",
  "median", "csv", "reader", "writer", "StringIO", "io",
]);

const PYTHON_MEMBER_ALLOWED = new Set([
  // stdlib module/type entrypoints
  "randint", "choice", "shuffle", "sample", "sqrt", "floor", "ceil", "sleep",
  "loads", "dumps", "load", "dump", "exit", "match", "fullmatch", "search",
  "findall", "finditer", "sub", "compile", "Counter", "defaultdict",
  "namedtuple", "deque", "reduce", "Path", "mean", "median", "reader",
  "writer", "StringIO", "now",
  // str/list/dict/set/file methods
  "append", "extend", "insert", "remove", "pop", "clear", "index", "count",
  "sort", "reverse", "copy", "split", "rsplit", "join", "strip", "lstrip",
  "rstrip", "lower", "upper", "title", "capitalize", "casefold", "replace",
  "startswith", "endswith", "find", "rfind", "isdigit", "isalpha", "isalnum",
  "isspace", "islower", "isupper", "center", "ljust", "rjust", "zfill",
  "encode", "decode", "splitlines", "get", "keys", "values", "items", "update",
  "setdefault", "fromkeys", "add", "discard", "union", "intersection",
  "difference", "issubset", "issuperset", "read", "readline", "readlines",
  "write", "writelines", "close", "seek", "tell", "flush", "read_text",
  "write_text", "read_bytes", "write_bytes", "exists", "is_file", "is_dir",
]);

// JavaScript language/runtime globals and prototype surfaces used by the
// supported beginner curriculum. Browser-standard calls are included because
// BYOK/editor questions can legitimately reference them.
const JS_GLOBAL_ALLOWED = new Set([
  "console",
  "alert", "prompt", "confirm", "parseInt", "parseFloat", "isNaN", "isFinite",
  "Number", "String", "Boolean", "BigInt", "Symbol", "Array", "Object", "JSON",
  "Math", "Date", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "queueMicrotask", "require", "structuredClone",
  "Promise", "fetch", "Map", "Set", "WeakMap", "WeakSet", "RegExp", "Error",
  "URL", "URLSearchParams", "document", "window",
]);

const JS_MEMBER_ALLOWED = new Set([
  // console and JSON/Math/Date methods
  "log", "warn", "error", "info", "debug", "table", "assert", "parse",
  "stringify", "random", "floor", "ceil", "round", "sqrt", "abs", "min",
  "max", "pow", "trunc", "now", "getTime", "getFullYear", "getMonth",
  "getDate",
  // array methods
  "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join",
  "reverse", "sort", "map", "filter", "reduce", "reduceRight", "forEach",
  "find", "findIndex", "findLast", "findLastIndex", "some", "every", "includes",
  "indexOf", "lastIndexOf", "flat", "flatMap", "fill", "keys", "values",
  "entries", "from", "isArray", "of", "at",
  // string and number methods
  "charAt", "charCodeAt", "codePointAt", "toUpperCase", "toLowerCase", "trim",
  "trimStart", "trimEnd", "split", "replace", "replaceAll", "substring", "substr",
  "startsWith", "endsWith", "padStart", "padEnd", "repeat", "match", "matchAll",
  "search", "toString", "toFixed", "toPrecision", "localeCompare",
  // object statics, collections, async, and browser-standard entrypoints
  "assign", "freeze", "seal", "hasOwn", "hasOwnProperty", "create",
  "defineProperty", "getOwnPropertyNames", "length", "test", "exec", "then",
  "catch", "finally", "resolve", "reject", "querySelector", "querySelectorAll",
  "getElementById", "addEventListener",
  "removeEventListener",
]);

const CALL_KEYWORDS = new Set([
  "if", "for", "while", "return", "def", "class", "function", "elif", "else",
  "not", "and", "or", "in", "lambda", "switch", "catch", "new", "typeof",
  "await", "async", "with", "except",
]);

/** Exact runtime membership for policy and calibration checks. */
export function isStandardApiSymbol(
  language: "python" | "javascript",
  symbol: string,
): boolean {
  const globals = language === "python" ? PYTHON_GLOBAL_ALLOWED : JS_GLOBAL_ALLOWED;
  const members = language === "python" ? PYTHON_MEMBER_ALLOWED : JS_MEMBER_ALLOWED;
  return globals.has(symbol) || members.has(symbol);
}

// Pull code-formatted spans only. Prose references are low-signal and do not
// present a pasteable API to a beginner.
function extractCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const fence = /```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) spans.push(match[1]);
  const withoutFences = text.replace(fence, "");
  const inline = /`([^`\n]{1,240})`/g;
  while ((match = inline.exec(withoutFences)) !== null) spans.push(match[1]);
  return spans;
}

function identifierTokens(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []);
}

function userFileSymbols(files: Array<{ path: string; content: string }>): Set<string> {
  const symbols = new Set<string>();
  for (const file of files) {
    for (const token of identifierTokens(file.content)) symbols.add(token);
  }
  return symbols;
}

// A tutor may define a helper and call it in the same snippet. Trust only
// concrete declarations—not a nearby prose suggestion and not an import the
// tutor invented. Any dependency used by that definition is still scanned.
function responseDefinedSymbols(
  language: "python" | "javascript",
  span: string,
): Set<string> {
  const symbols = new Set<string>();
  const patterns = language === "python"
    ? [
        /\b(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
        /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g,
      ]
    : [
        /\b(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g,
        /(?:^|[;{}\n])\s*(?:(?:async|static|get|set)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g,
      ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(span)) !== null) symbols.add(match[1]);
  }
  return symbols;
}

function isTrustedSymbol({
  language,
  symbol,
  userSymbols,
  responseSymbols,
}: {
  language: "python" | "javascript";
  symbol: string;
  userSymbols: Set<string>;
  responseSymbols: Set<string>;
}): boolean {
  return (
    CALL_KEYWORDS.has(symbol) ||
    isStandardApiSymbol(language, symbol) ||
    userSymbols.has(symbol) ||
    responseSymbols.has(symbol)
  );
}

export interface SuspectApiInput {
  responseText: string;
  userFiles: Array<{ path: string; content: string }>;
  // Kept in the route contract because the question remains useful context for
  // future classifiers. B7 deliberately does not trust it as symbol authority.
  userQuestion: string;
  language: "python" | "javascript";
}

/** Pure detector — returns distinct unrecognized call/root symbols. */
export function detectSuspectApis(input: SuspectApiInput): string[] {
  const userSymbols = userFileSymbols(input.userFiles);
  const suspects = new Set<string>();

  for (const span of extractCodeSpans(input.responseText)) {
    const responseSymbols = responseDefinedSymbols(input.language, span);
    const callPattern = /([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*(?=\()/g;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(span)) !== null) {
      const chain = match[1].split(".").map((part) => part.trim());
      const root = chain[0];
      const called = chain.at(-1)!;

      if (!isTrustedSymbol({
        language: input.language,
        symbol: called,
        userSymbols,
        responseSymbols,
      })) {
        suspects.add(called);
      }

      // An allowed method on an invented receiver (for example
      // `magic.print()`) is still suspicious. Check the root separately for
      // dotted calls so familiar method names cannot mask a fabricated API.
      if (
        chain.length > 1 &&
        !isTrustedSymbol({
          language: input.language,
          symbol: root,
          userSymbols,
          responseSymbols,
        })
      ) {
        suspects.add(root);
      }
    }
  }
  return [...suspects];
}

/**
 * Fire-and-forget response-completion hook. A detector bug must never break
 * tutor stream teardown or hide a valid response from the learner.
 */
export function flagSuspectApis(
  input: SuspectApiInput & { route: string },
): void {
  try {
    const symbols = detectSuspectApis(input);
    if (symbols.length === 0) return;
    aiPlatformAbuseSignals.inc({ signal: "tutor_suspect_api" });
    console.warn(
      JSON.stringify({
        level: "warn",
        evt: "tutor_suspect_api",
        detectorVersion: SUSPECT_API_DETECTOR_VERSION,
        route: input.route,
        language: input.language,
        symbolCount: symbols.length,
        symbols: symbols.slice(0, 10),
      }),
    );
  } catch {
    // Observe-only detector failures remain fail-open by design.
  }
}
