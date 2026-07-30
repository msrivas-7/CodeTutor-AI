// Phase A — A4: fabricated-API regex post-pass.
//
// After a tutor response completes, scan the code-formatted spans of the
// response for call-shaped tokens (`name(...)` / `obj.method(...)`) and
// flag any symbol that is neither (a) in the language's builtin/stdlib
// allowlist, (b) defined or mentioned anywhere in the user's files, nor
// (c) mentioned in the learner's own question. A hit does NOT block or
// mutate the response — it emits a structured `tutor_suspect_api` log
// line (KQL-able from the dashboard/alert layer) and bumps the abuse-
// signals counter, so hallucinated APIs become a measured rate instead
// of an anecdote.
//
// Deliberately regex-grade: this is the A4 tripwire, not the full
// Phase B7 syntax fact-check. False-positive posture: we'd rather
// under-flag than page the operator about `my_function()` the tutor
// correctly suggested the learner WRITE — hence the generous "any token
// appearing in user files or the question is fine" rule and the
// snake_case heuristic below.

import { aiPlatformAbuseSignals } from "../metrics.js";

// Python: builtins + the stdlib surface a beginner-course tutor could
// legitimately name. Method names cover str/list/dict/set/file objects.
const PYTHON_ALLOWED = new Set([
  // builtins
  "print", "len", "input", "range", "str", "int", "float", "bool", "list",
  "dict", "set", "tuple", "type", "isinstance", "open", "enumerate", "zip",
  "map", "filter", "sorted", "reversed", "sum", "min", "max", "abs", "round",
  "help", "repr", "id", "hash", "iter", "next", "super", "getattr", "setattr",
  "hasattr", "vars", "dir", "ord", "chr", "format", "any", "all", "divmod",
  "pow", "exec", "eval", "globals", "locals", "issubclass", "callable",
  // common stdlib entrypoints
  "import", "random", "randint", "choice", "shuffle", "sample", "math",
  "sqrt", "floor", "ceil", "datetime", "date", "time", "sleep", "json",
  "loads", "dumps", "load", "dump", "os", "sys", "exit", "re", "match",
  "search", "findall", "sub", "compile", "collections", "Counter",
  "defaultdict", "namedtuple", "deque", "itertools", "functools", "reduce",
  // str/list/dict/set/file methods
  "append", "extend", "insert", "remove", "pop", "clear", "index", "count",
  "sort", "reverse", "copy", "split", "rsplit", "join", "strip", "lstrip",
  "rstrip", "lower", "upper", "title", "capitalize", "replace", "startswith",
  "endswith", "find", "rfind", "isdigit", "isalpha", "isalnum", "isspace",
  "islower", "isupper", "center", "ljust", "rjust", "zfill", "encode",
  "decode", "splitlines", "get", "keys", "values", "items", "update",
  "setdefault", "fromkeys", "add", "discard", "union", "intersection",
  "difference", "issubset", "issuperset", "read", "readline", "readlines",
  "write", "writelines", "close", "seek", "tell", "flush",
]);

// JavaScript: globals + prototypes a beginner-course tutor could name.
const JS_ALLOWED = new Set([
  "console", "log", "warn", "error", "info", "alert", "prompt", "confirm",
  "parseInt", "parseFloat", "isNaN", "isFinite", "Number", "String",
  "Boolean", "Array", "Object", "JSON", "parse", "stringify", "Math",
  "random", "floor", "ceil", "round", "sqrt", "abs", "min", "max", "pow",
  "trunc", "Date", "now", "getTime", "getFullYear", "getMonth", "getDate",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "require",
  // array methods
  "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join",
  "reverse", "sort", "map", "filter", "reduce", "reduceRight", "forEach",
  "find", "findIndex", "some", "every", "includes", "indexOf", "lastIndexOf",
  "flat", "flatMap", "fill", "keys", "values", "entries", "from", "isArray",
  "of",
  // string methods
  "charAt", "charCodeAt", "toUpperCase", "toLowerCase", "trim", "trimStart",
  "trimEnd", "split", "replace", "replaceAll", "substring", "substr",
  "startsWith", "endsWith", "padStart", "padEnd", "repeat", "match",
  "matchAll", "search", "toString", "toFixed", "localeCompare",
  // object statics + misc
  "assign", "freeze", "hasOwnProperty", "create", "defineProperty",
  "getOwnPropertyNames", "length", "test", "exec", "then", "catch",
  "finally", "resolve", "reject", "Promise", "fetch",
]);

// Pull code-formatted spans only: fenced blocks first, then inline
// backticks. Prose mentions of made-up functions are lower-signal —
// the damaging hallucination is the one presented AS code.
function extractCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const fence = /```[a-zA-Z]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let rest = text;
  const fenced: string[] = [];
  while ((m = fence.exec(text)) !== null) fenced.push(m[1]);
  spans.push(...fenced);
  rest = text.replace(fence, "");
  const inline = /`([^`\n]{1,120})`/g;
  while ((m = inline.exec(rest)) !== null) spans.push(m[1]);
  return spans;
}

// Word tokens from the user's files + question: any symbol the learner
// already has on screen (or asked about) is legitimate for the tutor to
// reference, whether or not we recognize it.
function knownTokens(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    for (const tok of src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      out.add(tok);
    }
  }
  return out;
}

export interface SuspectApiInput {
  responseText: string;
  userFiles: Array<{ path: string; content: string }>;
  userQuestion: string;
  language: "python" | "javascript";
}

/** Pure detector — returns the distinct unrecognized call symbols. */
export function detectSuspectApis(input: SuspectApiInput): string[] {
  const allowed = input.language === "python" ? PYTHON_ALLOWED : JS_ALLOWED;
  const known = knownTokens([
    ...input.userFiles.map((f) => f.content),
    input.userQuestion,
  ]);
  const suspects = new Set<string>();
  for (const span of extractCodeSpans(input.responseText)) {
    // name( …  and  obj.method( … — capture the called identifier.
    const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(span)) !== null) {
      const sym = m[1];
      if (allowed.has(sym)) continue;
      if (known.has(sym)) continue;
      // Keywords that regex-parse like calls.
      if (["if", "for", "while", "return", "def", "class", "function", "elif", "else", "not", "and", "or", "in", "lambda", "switch", "catch", "new", "typeof", "await", "async", "print"].includes(sym)) continue;
      // snake_case / camelCase multi-word names are overwhelmingly the
      // tutor suggesting a function the LEARNER should define (e.g.
      // "write a get_total() function") — teaching, not hallucinating.
      if (/_/.test(sym) || /^[a-z]+[A-Z]/.test(sym)) continue;
      suspects.add(sym);
    }
  }
  return [...suspects];
}

/**
 * Fire-and-forget wrapper for the response-completion hooks. Never
 * throws; a detector bug must not break the tutor stream teardown.
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
        route: input.route,
        language: input.language,
        symbols: symbols.slice(0, 10),
      }),
    );
  } catch {
    // Detector must never take down the response path.
  }
}
