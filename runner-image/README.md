# Runner Image

Polyglot execution container used by the backend, one per active editor session.

Included toolchains (Debian bookworm-slim base):
- Python 3 (`python3`)
- Node.js (`node`) + `tsx` (global) for TypeScript execution
- GCC (`gcc`)
- G++ (`g++`, C++17)
- JDK (`javac`, `java`) — `default-jdk-headless`
- Go (`go`)
- Rust (`rustc`)
- Ruby (`ruby`)

The container is intentionally dumb: it starts with `sleep infinity` as non-root
user `runner` (uid/gid 1100) and waits for the backend to drive it via
`docker exec`. The backend is responsible for:

- starting / stopping the container
- syncing the project snapshot into `/workspace` (bind mount, owned by `runner`)
- running compile/run commands
- enforcing resource & network limits (`--network none`, `CapDrop: ALL`,
  `no-new-privileges`, `ReadonlyRootfs`, PidsLimit, NanoCpus, Memory)

Build locally:

```bash
docker build -t codetutor-ai-runner ./runner-image
```

In prod, images are built by `.github/workflows/deploy.yml` and pushed to
GHCR under both `:<github.sha>` and `:latest`. The VM pulls the specific
SHA tag and retags locally so compose always runs immutable.
