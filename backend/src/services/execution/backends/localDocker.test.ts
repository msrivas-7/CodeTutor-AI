import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalDockerBackend,
  ensureNoSymlinkInPath,
  joinHostPath,
} from "./localDocker.js";
import type { SessionHandle } from "./types.js";

describe("joinHostPath", () => {
  describe("Unix-style roots (macOS / Linux)", () => {
    it("joins with forward slash", () => {
      expect(joinHostPath("/Users/foo/temp/sessions", "abc123"))
        .toBe("/Users/foo/temp/sessions/abc123");
    });

    it("trims a single trailing forward slash", () => {
      expect(joinHostPath("/var/sessions/", "id"))
        .toBe("/var/sessions/id");
    });

    it("trims multiple trailing forward slashes", () => {
      expect(joinHostPath("/var/sessions///", "id"))
        .toBe("/var/sessions/id");
    });

    it("preserves a Linux home path", () => {
      expect(joinHostPath("/home/user/AICodeEditor/temp/sessions", "sess-xyz"))
        .toBe("/home/user/AICodeEditor/temp/sessions/sess-xyz");
    });
  });

  describe("Windows-style roots (Docker Desktop)", () => {
    it("joins with backslash when the root contains backslashes", () => {
      expect(joinHostPath("C:\\Users\\foo\\temp\\sessions", "abc123"))
        .toBe("C:\\Users\\foo\\temp\\sessions\\abc123");
    });

    it("trims a trailing backslash", () => {
      expect(joinHostPath("C:\\sessions\\", "id"))
        .toBe("C:\\sessions\\id");
    });

    it("trims multiple trailing backslashes", () => {
      expect(joinHostPath("C:\\sessions\\\\\\", "id"))
        .toBe("C:\\sessions\\id");
    });

    it("handles drive-root paths without extra backslashes", () => {
      expect(joinHostPath("D:\\sessions", "abc"))
        .toBe("D:\\sessions\\abc");
    });
  });

  describe("separator detection precedence", () => {
    it("prefers backslash if any backslash is present in the root", () => {
      // Mixed-separator root (unusual but defensive): if the root contains
      // any backslash we treat the root as Windows-shaped and append a
      // backslash — we never append mixed separators.
      expect(joinHostPath("C:\\weird/mixed\\path", "id"))
        .toBe("C:\\weird/mixed\\path\\id");
    });

    it("uses forward slash when there are no backslashes at all", () => {
      expect(joinHostPath("/pure/unix/path", "id"))
        .toBe("/pure/unix/path/id");
    });
  });
});

// Phase 17 / C-A1: writeFiles must not be trickable into dereferencing a
// symlink planted in the session workspace. ensureNoSymlinkInPath is the
// walk-and-reject helper used by writeFiles before it opens the target.
describe("ensureNoSymlinkInPath", () => {
  let tmp: string;

  it("succeeds on a normal nested directory path", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "no-symlink-ok-"));
    try {
      const target = path.join(tmp, "a", "b", "c");
      await ensureNoSymlinkInPath(tmp, target);
      const st = await fs.lstat(target);
      expect(st.isDirectory()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when any parent segment is a symlink", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "no-symlink-bad-"));
    try {
      // Simulate a learner planting /tmp/xxx/sneaky -> /etc
      await fs.symlink("/etc", path.join(tmp, "sneaky"));
      const target = path.join(tmp, "sneaky", "passwd-like");
      await expect(ensureNoSymlinkInPath(tmp, target)).rejects.toThrow(
        /symlink/i,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when a path segment is a regular file, not a directory", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "no-symlink-file-"));
    try {
      await fs.writeFile(path.join(tmp, "not-a-dir"), "hello");
      await expect(
        ensureNoSymlinkInPath(tmp, path.join(tmp, "not-a-dir", "x")),
      ).rejects.toThrow(/not a directory/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects if the target escapes the workspace root", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "no-symlink-esc-"));
    try {
      await expect(
        ensureNoSymlinkInPath(tmp, path.join(os.tmpdir(), "elsewhere")),
      ).rejects.toThrow(/escapes workspace/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("LocalDockerBackend handle cast", () => {
  // Guards the abstraction boundary: if a second backend ever ships, we must
  // never silently accept another backend's handle.
  it("rejects a handle from a different backend kind", async () => {
    const backend = new LocalDockerBackend({
      runnerImage: "irrelevant:test",
      workspaceRoot: "/workspace-root",
      runner: { memoryBytes: 0, nanoCpus: 0 },
    });
    const foreign: SessionHandle = {
      sessionId: "fake",
      __kind: "ecs-fargate",
    };
    await expect(backend.isAlive(foreign)).rejects.toThrow(
      /different backend/,
    );
  });
});
