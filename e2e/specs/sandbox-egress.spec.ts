// Phase 27 §3c — sandbox egress controls.
//
// Verifies that user code running in the execution sandbox cannot:
//   1. Make outbound HTTP requests via urllib / requests / http.client
//   2. Open raw TCP sockets to external hosts
//   3. Resolve external hostnames via DNS
//   4. Pull from cloud-metadata endpoints (AWS / Azure IMDS exfiltration)
//   5. Shell out to network tools (curl, wget) via subprocess
//   6. Read sensitive host files (/etc/shadow, /proc/1/environ)
//
// Why this exists as a precondition for the anonymous lesson route
// (§3a): unauthenticated traffic running arbitrary code in the sandbox
// represents a meaningfully expanded abuse surface. We THINK the
// container backend (localDocker for dev, ACI for prod) blocks egress
// at the network layer (NSG rules in prod, default Docker bridge with
// no inbound port mapping for dev). We have not had a test that PROVES
// it. This is that test.
//
// This spec runs the attack bundle as an AUTHENTICATED user via the
// editor route — there is no anon route to test against yet. The
// egress controls live at the network layer (NSG rules, Docker bridge
// config) and apply identically to authed and anon traffic, so this
// authed-path test stands in for the anon-path guarantee.
//
// Test design: ONE big Python program runs all attacks sequentially,
// each printing a tagged line:
//
//   ATTACK_<name>:BLOCKED:<exception class>   (good — blocked at any layer)
//   ATTACK_<name>:SUCCESS:<details>           (BAD — egress reached the wire)
//
// We assert NO line starts with "SUCCESS:" and EVERY attack reports
// "BLOCKED:". A single bundled run is faster than 8 separate sessions
// (each session-start is ~5–10s of harness setup). If any attack
// succeeds, the failure message names the specific attack.
//
// Notes on dev vs prod:
//   - In prod (ACI), egress is locked at the NSG layer — connections
//     time out / refuse without ever reaching the wire.
//   - In local dev (Docker on a developer's machine), the default
//     bridge network often allows outbound. If this spec FAILS in dev,
//     it is signaling that local dev egress controls drift from prod.
//     That drift is itself a bug — fix the dev config, not the test.
//   - The runner enforces RUN_TIMEOUT_MS=10_000 (backend/src/config.ts).
//     Per-attack timeouts are tightened to 1s so the cumulative
//     worst-case (8 attacks all hitting their timeout) is ~8s,
//     comfortably inside the runner ceiling. A real connection
//     refusal/DNS deny resolves in ms, so 1s is plenty.
//   - All prints use flush=True. When the runner captures stdout via
//     non-tty Docker exec, Python block-buffers print() — a SIGKILL
//     at the runner ceiling would discard buffered prints. If a real
//     egress leak ("urllib succeeded fast, then a later attack
//     blocked-and-timed-out") happened with buffered prints, the
//     SUCCESS line would be lost and the test would misdiagnose the
//     leak as a "bundle exited early" infra issue. flush=True forces
//     each verdict line to disk before the next attack starts.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";

// All attacks bundled into one Python program. Each prints a line of
// the form `ATTACK_<name>:<verdict>[:<detail>]`. The "BLOCKED:" prefix
// covers ANY exception path — TimeoutError (network blocked at NSG),
// ConnectionRefusedError (port-blocked), gaierror (DNS denied),
// PermissionError (filesystem denied), ImportError (lib not present),
// etc. Any of those is a successful defense; only an actual response
// reaching back to the sandbox is a real failure.
const ATTACK_BUNDLE = `
import sys

# Force line-buffering so each verdict reaches the captured stdout
# stream IMMEDIATELY, not on process exit. If a SIGKILL fires at the
# runner's RUN_TIMEOUT_MS ceiling (10s default), block-buffered
# prints would be lost — a real egress leak whose SUCCESS line was
# in the buffer would surface as "bundle exited early" instead of
# "egress leaked." Defense in depth: reconfigure for line-buffering
# AND pass flush=True on every print() in case reconfigure isn't
# available on the interpreter version that runs.
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

def attack(name, fn):
    try:
        result = fn()
        print(f"ATTACK_{name}:SUCCESS:{repr(result)[:120]}", flush=True)
    except BaseException as e:
        print(f"ATTACK_{name}:BLOCKED:{type(e).__name__}", flush=True)

# 1. urllib.request to a public host. Successful response would return
#    HTML bytes; any timeout / refusal / DNS denial is a pass.
def t_urllib():
    import urllib.request
    r = urllib.request.urlopen("https://example.com", timeout=1)
    return r.read(80).decode("utf-8", errors="ignore")
attack("urllib", t_urllib)

# 2. http.client low-level. Bypasses urllib niceties.
def t_httpclient():
    import http.client
    conn = http.client.HTTPConnection("example.com", timeout=1)
    conn.request("GET", "/")
    return conn.getresponse().status
attack("httpclient", t_httpclient)

# 3. Raw TCP socket connect to an external host on port 80.
def t_tcp80():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1)
    s.connect(("example.com", 80))
    return "connected"
attack("tcp80", t_tcp80)

# 4. DNS lookup against a public name. Pure A-record query.
def t_dns():
    import socket
    socket.setdefaulttimeout(1)
    return socket.gethostbyname("example.com")
attack("dns", t_dns)

# 5. AWS / Azure IMDS exfiltration attempt. The metadata endpoints sit
#    on link-local (169.254.169.254). Both AWS and Azure use this IP
#    for instance metadata; reaching it from a sandbox would leak
#    credentials, instance roles, or environment data.
def t_imds():
    import urllib.request
    r = urllib.request.urlopen("http://169.254.169.254/latest/meta-data/", timeout=1)
    return r.read(120).decode("utf-8", errors="ignore")
attack("imds", t_imds)

# 6. Subprocess shell-out: curl. Even if Python's socket layer is
#    contained, a process exec'ing curl could escape if egress is
#    enforced only at the Python level.
def t_curl():
    import subprocess
    r = subprocess.run(
        ["curl", "-sS", "--max-time", "1", "https://example.com"],
        capture_output=True, timeout=2,
    )
    return r.stdout[:80].decode("utf-8", errors="ignore")
attack("curl", t_curl)

# 7. Read /etc/shadow — the canonical "would expose system passwords"
#    file. Containers may or may not have it; either ImportError-style
#    blocked (file missing) or PermissionError is fine. Reading the
#    contents is what we care about preventing.
def t_shadow():
    with open("/etc/shadow", "r") as f:
        return f.read(80)
attack("shadow", t_shadow)

# 8. Read /proc/1/environ — would expose the parent process's env vars
#    (potentially including secrets injected at container start, depending
#    on backend). PermissionError or FileNotFoundError both pass.
def t_proc_environ():
    with open("/proc/1/environ", "rb") as f:
        return repr(f.read(80))
attack("proc_environ", t_proc_environ)

print("ATTACK_DONE", flush=True)
`.trim();

test.describe("sandbox egress controls (Phase 27 §3c)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  test("user code cannot reach external hosts, IMDS, or read sensitive host files", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, ATTACK_BUNDLE);
    await S.runButton(page).click();

    // Wait for the sentinel — every attack ran (or threw, which is fine).
    // Bundle worst-case wall time is ~8s with the per-attack 1s
    // timeouts (5 network attacks × 1s + 1 subprocess × 2s + 2 fast
    // file ops). Comfortably below RUN_TIMEOUT_MS=10s. Test-side wait
    // budget includes session start + harness overhead.
    await expect(S.outputPanel(page)).toContainText(/ATTACK_DONE/, {
      timeout: 30_000,
    });

    const output = (await S.outputPanel(page).textContent()) ?? "";

    // Hard fail: ANY attack reporting SUCCESS means egress is leaking.
    // The match list names the attack so the failure message is
    // immediately diagnostic.
    const successes = output.match(/ATTACK_\w+:SUCCESS:[^\n]*/g) ?? [];
    expect(
      successes,
      `Egress NOT contained — the following attacks reached their target:\n${successes.join("\n")}`,
    ).toEqual([]);

    // Soft check: every attack reported. If any attack is missing from
    // the output, the bundle stopped early (likely an unhandled
    // exception in the attack-runner machinery itself, not in an
    // attack). That's a test-infra issue, not an egress issue.
    const expected = [
      "urllib", "httpclient", "tcp80", "dns",
      "imds", "curl", "shadow", "proc_environ",
    ];
    for (const name of expected) {
      expect(
        output,
        `attack "${name}" produced no verdict line — bundle exited early`,
      ).toMatch(new RegExp(`ATTACK_${name}:(BLOCKED|SUCCESS)`));
    }
  });
});
