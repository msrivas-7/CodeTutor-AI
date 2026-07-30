import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const SCRIPT = new URL("../../infra/scripts/vm-promote-candidate.sh", import.meta.url).pathname;
const PREVIOUS_SHA = "1".repeat(40);
const CANDIDATE_SHA = "2".repeat(40);
const BACKEND_DIGEST = "a".repeat(64);
const RUNNER_DIGEST = "b".repeat(64);
const BACKEND_REF = `ghcr.io/msrivas-7/codetutor-backend@sha256:${BACKEND_DIGEST}`;
const RUNNER_REF = `ghcr.io/msrivas-7/codetutor-runner@sha256:${RUNNER_DIGEST}`;

const MOCK = `#!/usr/bin/env bash
set -uo pipefail

state_get() {
  local key="$1"
  awk -F '|' -v key="$key" '$1 == key { value=$2 } END { if (value != "") print value }' "$MOCK_STATE_FILE"
}

state_set() {
  local key="$1" value="$2" next
  next="\${MOCK_STATE_FILE}.next"
  awk -F '|' -v key="$key" '$1 != key' "$MOCK_STATE_FILE" > "$next"
  printf '%s|%s\\n' "$key" "$value" >> "$next"
  mv "$next" "$MOCK_STATE_FILE"
}

command_name="$(basename "$0")"
case "$command_name" in
  sudo)
    if [[ "\${1:-}" == "-u" ]]; then shift 2; fi
    exec "$@"
    ;;
  git)
    if [[ "\${1:-}" == "rev-parse" ]]; then printf '%s\\n' "$MOCK_NEW_SHA"; exit 0; fi
    if [[ "\${1:-}" == "reset" && "\${2:-}" == "--hard" ]]; then
      printf '%s\\n' "$3" > "$MOCK_RESET_FILE"
      exit 0
    fi
    exit 0
    ;;
  docker)
    if [[ "\${1:-}" == "pull" ]]; then
      ref="$2"
      if [[ "\${MOCK_FAIL_PULL:-}" == "$ref" ]]; then exit 1; fi
      state_set "$ref" "sha256:\${ref##*@sha256:}"
      exit 0
    fi
    if [[ "\${1:-}" == "tag" ]]; then
      id="$(state_get "$2")"
      [[ -n "$id" ]] || exit 1
      state_set "$3" "$id"
      exit 0
    fi
    if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
      ref="\${@: -1}"
      id="$(state_get "$ref")"
      [[ -n "$id" ]] || exit 1
      if [[ "$*" == *"--format"* ]]; then printf '%s\\n' "$id"; fi
      exit 0
    fi
    if [[ "\${1:-}" == "inspect" ]]; then
      cat "$MOCK_RUNNING_FILE"
      exit 0
    fi
    if [[ "\${1:-}" == "compose" ]]; then
      if [[ "$*" == *" ps -q backend"* ]]; then printf '%s\\n' backend-container; exit 0; fi
      if [[ "$*" == *" up -d backend"* ]]; then
        if [[ "\${MOCK_FAIL_COMPOSE:-0}" == "1" ]]; then exit 1; fi
        state_get ghcr.io/msrivas-7/codetutor-backend:latest > "$MOCK_RUNNING_FILE"
        exit 0
      fi
      exit 0
    fi
    exit 1
    ;;
  curl)
    [[ "\${MOCK_HEALTH_FAIL:-0}" != "1" ]]
    ;;
  install)
    source_path="\${@: -2:1}"
    target_path="\${@: -1}"
    cp "$source_path" "$target_path"
    chmod 0755 "$target_path"
    ;;
  sleep)
    exit 0
    ;;
esac
`;

async function setup(extraEnv = {}) {
  const root = await mkdtemp(join(tmpdir(), "candidate-promotion-"));
  const mockBin = join(root, "bin");
  const repo = join(root, "repo");
  const state = join(root, "docker-state");
  const reset = join(root, "git-reset");
  const running = join(root, "running-image");
  const refreshTarget = join(root, "refresh-env");
  await mkdir(mockBin);
  await mkdir(join(repo, "infra", "scripts"), { recursive: true });
  await writeFile(
    join(repo, "infra", "scripts", "refresh-env.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
    "utf8",
  );
  await chmod(join(repo, "infra", "scripts", "refresh-env.sh"), 0o755);
  await writeFile(
    state,
    [
      "ghcr.io/msrivas-7/codetutor-backend:latest|sha256:old-backend",
      "ghcr.io/msrivas-7/codetutor-runner:latest|sha256:old-runner",
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(running, "sha256:old-backend\n", "utf8");

  for (const name of ["sudo", "git", "docker", "curl", "install", "sleep"]) {
    const target = join(mockBin, name);
    await writeFile(target, MOCK, "utf8");
    await chmod(target, 0o755);
  }

  return {
    root,
    state,
    reset,
    running,
    env: {
      ...process.env,
      PATH: `${mockBin}:${process.env.PATH}`,
      CODETUTOR_ROOT: repo,
      REFRESH_ENV_TARGET: refreshTarget,
      MOCK_STATE_FILE: state,
      MOCK_RESET_FILE: reset,
      MOCK_RUNNING_FILE: running,
      MOCK_NEW_SHA: CANDIDATE_SHA,
      ...extraEnv,
    },
  };
}

async function runPromotion(environment) {
  return execFileAsync("bash", [SCRIPT, PREVIOUS_SHA, CANDIDATE_SHA, BACKEND_REF, RUNNER_REF], {
    env: environment,
  });
}

test("promotes the exact backend and runner digests", async () => {
  const fixture = await setup();
  const { stdout } = await runPromotion(fixture.env);
  const state = await readFile(fixture.state, "utf8");

  assert.match(stdout, /PROMOTION_OK/);
  assert.match(state, new RegExp(`codetutor-backend:latest\\|sha256:${BACKEND_DIGEST}`));
  assert.match(state, new RegExp(`codetutor-runner:latest\\|sha256:${RUNNER_DIGEST}`));
  assert.equal((await readFile(fixture.running, "utf8")).trim(), `sha256:${BACKEND_DIGEST}`);
});

test("restores repository and both aliases when deep health fails", async () => {
  const fixture = await setup({ MOCK_HEALTH_FAIL: "1" });

  await assert.rejects(runPromotion(fixture.env), /Command failed/);
  const state = await readFile(fixture.state, "utf8");
  assert.equal((await readFile(fixture.reset, "utf8")).trim(), PREVIOUS_SHA);
  assert.match(state, /codetutor-backend:latest\|sha256:old-backend/);
  assert.match(state, /codetutor-runner:latest\|sha256:old-runner/);
});

test("leaves both aliases on the last-known-good images when a candidate pull fails", async () => {
  const fixture = await setup({ MOCK_FAIL_PULL: RUNNER_REF });

  await assert.rejects(runPromotion(fixture.env), /Command failed/);
  const state = await readFile(fixture.state, "utf8");
  assert.equal((await readFile(fixture.reset, "utf8")).trim(), PREVIOUS_SHA);
  assert.match(state, /codetutor-backend:latest\|sha256:old-backend/);
  assert.match(state, /codetutor-runner:latest\|sha256:old-runner/);
  assert.doesNotMatch(state, new RegExp(`sha256:${RUNNER_DIGEST}`));
});
