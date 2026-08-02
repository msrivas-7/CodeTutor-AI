import {
  TEST_SENTINEL,
  RESULT_MARKER,
  RESULT_ERR_MARKER,
  type HarnessBackend,
  type HarnessFile,
  type HarnessSuite,
} from "./types.js";

export const HARNESS_PY = "__codetutor_tests.py";
export const HARNESS_JSON = "__codetutor_tests.json";

/**
 * Python harness (Phase 17 trust model).
 *
 * The Phase 16 design passed the HMAC nonce through the env (HARNESS_NONCE)
 * and relied on `del os.environ[...]` to prevent leakage into child
 * subprocesses. That wasn't enough: the kernel's mm_struct.env_start..env_end
 * region stays visible through /proc/<ppid>/environ even after unsetenv, so a
 * user-code child could open /proc/self/../<ppid>/environ and recover the
 * nonce. Phase 17 moves the nonce to stdin — reading it from stdin consumes
 * the pipe and leaves no trace in /proc.
 *
 *   1. Parent runHarness.ts writes the nonce as the first line of the
 *      harness's stdin, then closes the pipe. HARNESS_PER_TEST_TIMEOUT_MS
 *      remains in env (non-secret).
 *   2. Harness reads stdin to EOF, splits on the first newline, and treats
 *      everything before it as the nonce. Stdin is then closed.
 *   3. Reads __codetutor_tests.json into memory, then os.remove()s the file
 *      (hides C3 — hidden-test expected values stay in parent RAM).
 *   4. For each test, spawns a fresh `python3 -c DRIVER TEST_JSON`
 *      subprocess with stdin=DEVNULL so the child inherits no readable pipe.
 *      DRIVER loads main.py via runpy, runs setup, evaluates call, and
 *      writes `repr(actual)` between a RESULT_MARKER pair on its own stdout.
 *   5. The parent extracts the LAST RESULT_MARKER block from each child's
 *      stdout and compares it (via ast.literal_eval) to the in-memory
 *      expected.
 *   6. The parent builds the full report, HMAC-signs the body with the
 *      nonce, and emits `SENTINEL + base64(envelope) + SENTINEL + "\n"` to
 *      stdout.
 *
 * Why stdin beats env:
 *   - /proc/<pid>/environ reflects the kernel env region, not os.environ.
 *     unsetenv updates environ[] but doesn't zero the memory.
 *   - /proc/<pid>/cmdline reflects argv, so we can't put the nonce there.
 *   - stdin is a pipe. Once read to EOF and closed, there is no further
 *     path to recover the data — the pipe buffer is drained, /proc/<pid>/fd/0
 *     points at a closed pipe inode, and the child subprocess's own fd 0 is
 *     DEVNULL.
 */
export function harnessPython(): string {
  return `import base64, hashlib, hmac, json, os, subprocess, sys, traceback

SENTINEL = ${JSON.stringify(TEST_SENTINEL)}
RESULT_MARKER = ${JSON.stringify(RESULT_MARKER)}
RESULT_ERR_MARKER = ${JSON.stringify(RESULT_ERR_MARKER)}

# --- Read nonce from stdin (Phase 17); close immediately ---------------
# stdin wire format: "<nonce>\\n"; we read to EOF so the pipe is drained
# and no residue is visible via /proc/<pid>/fd/0 to any later child.
try:
    _stdin_data = sys.stdin.read()
except BaseException:
    _stdin_data = ""
try:
    sys.stdin.close()
except BaseException:
    pass
_nonce = _stdin_data.split("\\n", 1)[0].strip() if _stdin_data else ""

# --- Per-test timeout stays in env (non-secret) ------------------------
try:
    _per_test_timeout = float(os.environ.get("HARNESS_PER_TEST_TIMEOUT_MS", "5000")) / 1000.0
except (TypeError, ValueError):
    _per_test_timeout = 5.0
if "HARNESS_PER_TEST_TIMEOUT_MS" in os.environ:
    del os.environ["HARNESS_PER_TEST_TIMEOUT_MS"]

# --- Read tests into memory, then delete the file (hides C3) ----------
_tests_path = ${JSON.stringify(HARNESS_JSON)}
_suite = {"tests": [], "sourceChecks": []}
_load_err = None
try:
    with open(_tests_path, "r", encoding="utf-8") as _f:
        _suite = json.load(_f)
    os.remove(_tests_path)
except BaseException as _e:
    _load_err = "could not load test specs: " + repr(_e)
_tests = _suite.get("tests") or []
_source_checks = _suite.get("sourceChecks") or []

# --- Static source-contract checks -----------------------------------
# These checks run in the signed parent process before learner code. Python's
# own AST gives technique-focused lessons honest structural evidence while the
# ordinary runtime tests continue to prove behavior. Nodes placed under a
# statically-false branch do not count as mastery evidence.
def _qualified_name(node):
    import ast
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value)
        return (parent + "." if parent else "") + node.attr
    return ""

def _constant_truth(node):
    import ast
    if isinstance(node, ast.Constant):
        return bool(node.value)
    if isinstance(node, (ast.List, ast.Tuple, ast.Set, ast.Dict)):
        return bool(getattr(node, "elts", None) or getattr(node, "keys", None))
    return None

def _is_descendant_in(node, branch):
    return node in branch

def _is_reachable(node, parents):
    import ast
    current = node
    while current in parents:
        parent = parents[current]
        if isinstance(parent, ast.If):
            truth = _constant_truth(parent.test)
            if truth is False and _is_descendant_in(current, parent.body):
                return False
            if truth is True and _is_descendant_in(current, parent.orelse):
                return False
        if isinstance(parent, ast.While):
            truth = _constant_truth(parent.test)
            if truth is False and _is_descendant_in(current, parent.body):
                return False
        current = parent
    return True

def _scope_for(node, parents):
    import ast
    names = []
    current = node
    while current in parents:
        current = parents[current]
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.append(current.name)
    return ".".join(reversed(names))

def _check_source(check):
    import ast
    shell = {
        "name": check.get("name", ""),
        "hidden": bool(check.get("hidden", False)),
        "category": check.get("category"),
        "passed": False,
        "actualRepr": None,
        "expectedRepr": None,
        "stdoutDuring": "",
        "error": None,
        "feedback": check.get("feedback"),
        "evidence": "source",
    }
    path = check.get("file") or "main.py"
    try:
        with open(path, "r", encoding="utf-8") as source_file:
            tree = ast.parse(source_file.read(), filename=path)
    except BaseException:
        shell["error"] = "Could not inspect " + path + "."
        return shell
    parents = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    kind = check.get("kind") or ""
    target = check.get("target") or ""
    scope = check.get("scope") or ""
    required = int(check.get("minCount") or 1)
    node_types = {
        "python_list_comprehension": (ast.ListComp,),
        "python_dict_comprehension": (ast.DictComp,),
        "python_set_comprehension": (ast.SetComp,),
        "python_generator_expression": (ast.GeneratorExp,),
        "python_while_loop": (ast.While,),
        "python_with_statement": (ast.With, ast.AsyncWith),
        "python_yield": (ast.Yield, ast.YieldFrom),
        "python_lambda": (ast.Lambda,),
    }
    matches = []
    for node in ast.walk(tree):
        if not _is_reachable(node, parents):
            continue
        node_scope = _scope_for(node, parents)
        if scope and node_scope != scope:
            continue
        if kind in node_types and isinstance(node, node_types[kind]):
            if kind == "python_with_statement" and target:
                context_calls = [
                    item.context_expr
                    for item in node.items
                    if isinstance(item.context_expr, ast.Call)
                ]
                if not any(_qualified_name(call.func) == target for call in context_calls):
                    continue
            matches.append(node)
        elif kind == "python_specific_except" and isinstance(node, ast.ExceptHandler):
            if node.type is not None and _qualified_name(node.type) == target:
                matches.append(node)
        elif kind == "python_raise" and isinstance(node, ast.Raise) and node.exc is not None:
            exc = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
            if _qualified_name(exc) == target:
                matches.append(node)
        elif kind == "python_call" and isinstance(node, ast.Call):
            if _qualified_name(node.func) == target:
                matches.append(node)
    shell["passed"] = len(matches) >= required
    shell["actualRepr"] = str(len(matches))
    shell["expectedRepr"] = "at least " + str(required)
    return shell

# --- Driver run by each per-test subprocess ---------------------------
# The driver reads the test spec from sys.argv[1] (setup + call only — the
# expected value stays with the parent, so user code in the subprocess
# cannot read it). We use python3 -c so driver source and test JSON are on
# argv rather than stdin; /proc/self/cmdline exposes argv but nothing here
# is secret (sentinel markers, user's own setup/call).
_DRIVER = (
    "import sys, runpy, traceback, contextlib, io, json\\n"
    "_test = json.loads(sys.argv[1])\\n"
    "_out = io.StringIO()\\n"
    "try:\\n"
    "    with contextlib.redirect_stdout(_out):\\n"
    "        _ns = {}\\n"
    "        _before = _test.get('beforeLoad') or ''\\n"
    "        if _before:\\n"
    "            exec(_before, _ns)\\n"
    "        _ns = runpy.run_path('main.py', init_globals=_ns, run_name='__codetutor_main__')\\n"
    "        _setup = _test.get('setup') or ''\\n"
    "        if _setup:\\n"
    "            exec(_setup, _ns)\\n"
    "        _actual = eval(_test.get('call') or '', _ns)\\n"
    "    sys.stdout.write(_out.getvalue())\\n"
    "    sys.stdout.write('\\\\n' + " + json.dumps(RESULT_MARKER) + " + repr(_actual) + " + json.dumps(RESULT_MARKER) + " + '\\\\n')\\n"
    "except BaseException:\\n"
    "    sys.stdout.write(_out.getvalue())\\n"
    "    sys.stdout.write('\\\\n' + " + json.dumps(RESULT_ERR_MARKER) + " + traceback.format_exc(limit=2) + " + json.dumps(RESULT_ERR_MARKER) + " + '\\\\n')\\n"
)

def _extract_between(text, marker):
    # Last marker block wins: the driver writes exactly one pair at the end
    # of its happy-path flow. If user code emits fake pairs earlier (e.g. a
    # module-level print), they're ignored.
    end = text.rfind(marker)
    if end == -1:
        return None
    start = text.rfind(marker, 0, end)
    if start == -1:
        return None
    return text[start + len(marker):end]

def _strip_markers(text):
    for m in (RESULT_MARKER, RESULT_ERR_MARKER):
        while True:
            a = text.find(m)
            if a == -1:
                break
            b = text.find(m, a + len(m))
            if b == -1:
                break
            text = text[:a] + text[b + len(m):]
    return text.strip()

def _probe_main():
    # stdin=DEVNULL so the probe child cannot read the parent's stdin pipe.
    try:
        return subprocess.run(
            ["python3", "-c", "import runpy; runpy.run_path('main.py', run_name='__codetutor_main__')"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=_per_test_timeout,
        )
    except subprocess.TimeoutExpired:
        return None
    except BaseException:
        return None

def _result_shell(test):
    return {
        "name": test.get("name", ""),
        "hidden": bool(test.get("hidden", False)),
        "category": test.get("category"),
        "passed": False,
        "actualRepr": None,
        "expectedRepr": None,
        "stdoutDuring": "",
        "error": None,
        "feedback": None,
        "evidence": "behavior",
    }

def _run_one(test):
    shell = _result_shell(test)
    # Only send setup + call into the subprocess. Expected stays in parent RAM.
    payload = json.dumps({
        "beforeLoad": test.get("beforeLoad") or "",
        "setup": test.get("setup") or "",
        "call": test.get("call") or "",
    })
    try:
        # stdin=DEVNULL so the child cannot read the parent's drained stdin
        # pipe (where the nonce arrived). Belt-and-suspenders — by this point
        # the parent's stdin is closed and at EOF anyway.
        r = subprocess.run(
            ["python3", "-c", _DRIVER, payload],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=_per_test_timeout,
        )
    except subprocess.TimeoutExpired:
        shell["error"] = "Test timed out."
        return shell
    except BaseException as e:
        shell["error"] = "Could not spawn test subprocess: " + repr(e)
        return shell

    child_out = r.stdout or ""
    actual_repr = _extract_between(child_out, RESULT_MARKER)
    err_blob = _extract_between(child_out, RESULT_ERR_MARKER)
    shell["stdoutDuring"] = _strip_markers(child_out)

    expected_src = test.get("expected")
    expected_error = test.get("expectedError")
    if actual_repr is not None:
        if expected_error is not None:
            shell["actualRepr"] = actual_repr
            shell["expectedRepr"] = "raises " + str(expected_error.get("type") or "exception")
            return shell
        try:
            import ast
            expected = ast.literal_eval(expected_src or "")
        except BaseException:
            shell["error"] = "invalid expected (must be a Python literal): " + expected_src[:200]
            shell["actualRepr"] = actual_repr
            return shell
        try:
            import ast as _ast
            actual = _ast.literal_eval(actual_repr)
            shell["passed"] = actual == expected
        except BaseException:
            # Non-literal repr — fall back to string equality.
            shell["passed"] = actual_repr == repr(expected)
        shell["actualRepr"] = actual_repr
        shell["expectedRepr"] = repr(expected)
        return shell

    if err_blob is not None:
        tail = (err_blob.strip().splitlines() or [""])[-1]
        if expected_error is not None:
            expected_type = str(expected_error.get("type") or "")
            expected_message = expected_error.get("message")
            expected_tail = expected_type + ((": " + str(expected_message)) if expected_message else "")
            shell["passed"] = tail == expected_tail if expected_message else tail.startswith(expected_type + ":")
            shell["actualRepr"] = tail or "no exception"
            shell["expectedRepr"] = "raises " + expected_tail
            return shell
        shell["error"] = tail or "Test raised an exception."
        return shell

    # No marker at all — the subprocess exited before the driver could write
    # anything (os._exit, SIGKILL, etc). Fail closed.
    stderr_tail = ""
    if r.stderr:
        lines = r.stderr.strip().splitlines()
        if lines:
            stderr_tail = lines[-1]
    shell["error"] = stderr_tail or "Test produced no result (the subprocess exited before finishing)."
    return shell

# --- Drive the tests --------------------------------------------------
_results = []
_harness_error = _load_err
_clean_stdout = ""

if _harness_error is None:
    _probe = _probe_main()
    if _probe is None:
        _harness_error = "Your code could not be loaded (probe timed out or crashed)."
    elif _probe.returncode != 0:
        _msg = (_probe.stderr or "").strip() or "Your code could not be loaded."
        _harness_error = _msg
    else:
        _clean_stdout = _probe.stdout or ""
        for _check in _source_checks:
            _results.append(_check_source(_check))
        for _t in _tests:
            _results.append(_run_one(_t))

# --- Sign + emit the envelope ----------------------------------------
_body = json.dumps({
    "results": _results,
    "harnessError": _harness_error,
    "cleanStdout": _clean_stdout,
})
_sig = hmac.new(_nonce.encode("utf-8"), _body.encode("utf-8"), hashlib.sha256).hexdigest()
_inner = json.dumps({"body": _body, "sig": _sig})
_encoded = base64.b64encode(_inner.encode("utf-8")).decode("ascii")
sys.stdout.write(SENTINEL + _encoded + SENTINEL + "\\n")
`;
}

export const pythonHarness: HarnessBackend = {
  language: "python",
  prepareFiles(suite: HarnessSuite): HarnessFile[] {
    return [
      { name: HARNESS_PY, content: harnessPython() },
      { name: HARNESS_JSON, content: JSON.stringify(suite) },
    ];
  },
  execCommand(): string {
    return `python3 ${HARNESS_PY}`;
  },
};
