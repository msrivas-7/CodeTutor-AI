// S2 — Privilege & capability surface.
//
//  C1 non-root UID:     runner container runs as uid 1100, not root.
//  C3 capabilities:     CapDrop=["ALL"] — no CAP_SYS_ADMIN/PTRACE/etc.
//  C5 no-new-privs:     setuid bits can't escalate; capability files can't.
//
// Together these claims say: "even if a learner manages to exec
// arbitrary Linux syscalls or compile a setuid binary, they still can't
// become root, ptrace other processes, or mount filesystems."
//
// Style: we use Python's ctypes to reach raw syscalls. A clean `EPERM`
// from the kernel is the exact signal we want — proves the capability
// is dropped rather than just that the helper binary is absent.

import { test, expect } from "../harness/fixtures.js";

test.describe("S2 — privileges & capabilities", () => {
  test("S2a: process runs as non-root (uid 1100)", async ({
    attack,
    sessionId,
    scenario,
  }) => {
    scenario({
      id: "S2a",
      claim: ["C1 non-root UID 1100"],
      summary: "runtime uid must be the runner user, never 0",
    });
    const result = await attack.runAttack({
      sessionId,
      language: "python",
      files: [
        {
          path: "main.py",
          content: `
import os
print(f"UID:{os.getuid()}")
print(f"GID:{os.getgid()}")
print(f"EUID:{os.geteuid()}")
`.trim(),
        },
      ],
    });
    expect(result.stdout).toContain("UID:1100");
    expect(result.stdout).toContain("EUID:1100");
    expect(result.stdout).not.toContain("UID:0");
  });

  test("S2b: mount() syscall returns EPERM (CAP_SYS_ADMIN dropped)", async ({
    attack,
    sessionId,
    scenario,
  }) => {
    scenario({
      id: "S2b",
      claim: ["C3 capabilities dropped"],
      summary: "mount() must fail with EPERM — not just command-not-found",
    });
    const result = await attack.runAttack({
      sessionId,
      language: "python",
      files: [
        {
          path: "main.py",
          content: `
import ctypes, ctypes.util, os
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
# mount("tmpfs", "/mnt", "tmpfs", 0, NULL)
rc = libc.mount(b"tmpfs", b"/mnt", b"tmpfs", 0, None)
errno = ctypes.get_errno()
print(f"RC:{rc}")
print(f"ERRNO:{errno}")  # EPERM = 1
print(f"MSG:{os.strerror(errno)}")
`.trim(),
        },
      ],
    });
    expect(result.stdout).toContain("RC:-1");
    // EPERM or EACCES — both are "you do not have the capability"; we
    // accept either, but NOT EINVAL/ENOENT (those would mean mount got
    // further than it should).
    expect(result.stdout).toMatch(/ERRNO:(1|13)\b/);
  });

  // NOTE: S2c (ptrace attach on a sibling) was removed intentionally.
  // Same-UID ptrace is standard Unix behavior and does NOT require
  // CAP_SYS_PTRACE — it's gated by YAMA (ptrace_scope), which is
  // process-hierarchy-aware, not capability-aware. A single-tenant
  // sandbox that runs everything as uid 1100 would see ptrace-on-sibling
  // succeed regardless of cap drops, and that's fine — the sibling IS
  // the same attacker. The meaningful boundaries (no cross-tenant
  // ptrace, no PID-namespace escape) are enforced by the sandbox
  // topology itself: one container per session. See S2b, S2e for the
  // cap-drop verification.

  test("S2d: setuid-root binary cannot escalate (no-new-privs in effect)", async ({
    attack,
    sessionId,
    scenario,
  }) => {
    scenario({
      id: "S2d",
      claim: ["C5 no-new-privileges"],
      summary: "exec of a setuid binary must not change the effective uid",
    });
    // Phase 24B-resize: this property is now defended TWO ways:
    //   1. LocalDocker: --security-opt=no-new-privileges:true (kernel
    //      refuses setuid escalation regardless of bits on disk)
    //   2. ACI + LocalDocker: the runner image's Dockerfile strips ALL
    //      setuid + setgid bits at build time (find / -xdev ... chmod
    //      a-s). So even if no-new-privs is absent (ACI), there is no
    //      setuid bit on disk for the kernel to honor.
    // S2f below verifies the build-time strip directly. Here we still
    // run the kernel-level check because catching either layer's
    // regression is independently valuable.
    const result = await attack.runAttack({
      sessionId,
      language: "python",
      files: [
        {
          path: "main.py",
          content: `
import subprocess, os
candidates = ["/usr/bin/su", "/bin/su", "/usr/bin/passwd", "/bin/chsh"]
binp = next((c for c in candidates if os.path.exists(c)), None)
print(f"PRE_EUID:{os.geteuid()}")
if not binp:
    print("NOSETUID:none-available")
else:
    print(f"BIN:{binp}")
    st = os.stat(binp)
    is_setuid = bool(st.st_mode & 0o4000) and st.st_uid == 0
    print(f"HAS_SETUID_BIT:{is_setuid}")
# Exec a non-interactive shim — we just want to see whether the kernel
# honors the setuid bit. Invoking 'su' without stdin will exit quickly.
if binp:
    try:
        r = subprocess.run([binp, "--help"], capture_output=True, timeout=3)
    except Exception as e:
        print(f"EXEC_ERR:{type(e).__name__}")
print(f"POST_EUID:{os.geteuid()}")
`.trim(),
        },
      ],
    });
    expect(result.stdout).toContain("PRE_EUID:1100");
    expect(result.stdout).toContain("POST_EUID:1100");
    expect(result.stdout).not.toContain("POST_EUID:0");
  });

  test("S2f: image has no setuid/setgid binaries (build-time strip invariant)", async ({
    attack,
    sessionId,
    scenario,
  }) => {
    scenario({
      id: "S2f",
      claim: ["C5 no-new-privileges (structural — image-level)"],
      summary: "no setuid/setgid bits anywhere in the image — the structural backstop for ACI's missing no-new-privs",
    });
    // Walk the image rootfs and emit any file with mode bit 04000 (suid)
    // or 02000 (sgid). Pre-Phase-24B-resize the debian:bookworm-slim
    // base shipped 11 such binaries (su, mount, passwd, chsh, etc.).
    // The Dockerfile's `find / -xdev ... chmod a-s` strip line removes
    // them — this test asserts that strip stayed in place across image
    // rebuilds. A regression here means a future Dockerfile change or
    // base-image bump silently re-introduced the escalation surface
    // that ACI can't otherwise defend (no-new-privs unavailable on ACI).
    const result = await attack.runAttack({
      sessionId,
      language: "python",
      files: [
        {
          path: "main.py",
          content: `
import os, stat
hits = []
for root, dirs, files in os.walk("/", followlinks=False):
    # Skip mountpoints we don't care about; we only walk the image fs.
    if root.startswith("/proc") or root.startswith("/sys") or root.startswith("/dev"):
        dirs.clear()
        continue
    # Skip /workspace + /tmp — emptyDir mounts (ACI) or tmpfs (LocalDocker)
    # which a learner controls. Image-baked surfaces are what we care about.
    if root in ("/workspace", "/tmp") or root.startswith("/workspace/") or root.startswith("/tmp/"):
        dirs.clear()
        continue
    for f in files:
        p = os.path.join(root, f)
        try:
            st = os.lstat(p)
        except OSError:
            continue
        if not stat.S_ISREG(st.st_mode):
            continue
        if st.st_mode & (stat.S_ISUID | stat.S_ISGID):
            hits.append(p)
print(f"COUNT:{len(hits)}")
for h in hits[:10]:
    print(f"HIT:{h}")
`.trim(),
        },
      ],
    });
    expect(result.stdout).toContain("COUNT:0");
    // Defensive — if any hits print, this catches the test loosening
    // accidentally (e.g., someone changes COUNT:0 to COUNT:1).
    expect(result.stdout).not.toContain("HIT:/usr/bin/");
    expect(result.stdout).not.toContain("HIT:/usr/sbin/");
  });

  test("S2e: unshare(CLONE_NEWUSER) fails (cannot create new user namespace)", async ({
    attack,
    sessionId,
    scenario,
  }) => {
    scenario({
      id: "S2e",
      claim: ["C3 capabilities dropped"],
      summary: "user-namespace creation must fail",
    });
    const result = await attack.runAttack({
      sessionId,
      language: "python",
      files: [
        {
          path: "main.py",
          content: `
import ctypes, ctypes.util, os
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
CLONE_NEWUSER = 0x10000000
rc = libc.unshare(CLONE_NEWUSER)
errno = ctypes.get_errno()
print(f"RC:{rc}")
print(f"ERRNO:{errno}")
`.trim(),
        },
      ],
    });
    expect(result.stdout).toContain("RC:-1");
    // EPERM=1, EINVAL=22 (kernel rejecting flags under seccomp/caps),
    // ENOSYS=38 (seccomp outright blocks the syscall). Any of those
    // proves we didn't succeed.
    expect(result.stdout).toMatch(/ERRNO:(1|22|38)\b/);
  });
});
