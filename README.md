<div align="center">

<img src="https://img.shields.io/badge/CodeTutor_AI-Learn_to_Code_with_AI-0f172a?style=for-the-badge&labelColor=0f172a" alt="CodeTutor AI" />

### [Try it live → codetutor.msrivas.com](https://codetutor.msrivas.com)

[![CI](https://github.com/msrivas-7/CodeTutor-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/msrivas-7/CodeTutor-AI/actions/workflows/ci.yml)
[![E2E](https://github.com/msrivas-7/CodeTutor-AI/actions/workflows/e2e.yml/badge.svg)](https://github.com/msrivas-7/CodeTutor-AI/actions/workflows/e2e.yml)
[![Languages](https://img.shields.io/badge/9_Languages-Python_%7C_JS_%7C_TS_%7C_C_%7C_C++_%7C_Java_%7C_Go_%7C_Rust_%7C_Ruby-38bdf8?style=flat-square)](https://codetutor.msrivas.com)
[![Azure](https://img.shields.io/badge/Hosted_on-Azure-0078D4?style=flat-square&logo=microsoftazure&logoColor=white)](https://codetutor.msrivas.com)
[![OpenAI](https://img.shields.io/badge/AI_Tutor-OpenAI-412991?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/api-keys)

[**Architecture**](docs/ARCHITECTURE.md) &nbsp;&bull;&nbsp; [**Development**](docs/DEVELOPMENT.md) &nbsp;&bull;&nbsp; [**Content authoring**](docs/CONTENT_AUTHORING.md)

</div>

---

## Why CodeTutor AI

Most coding assistants solve the problem for you. **CodeTutor AI teaches you to solve it yourself** — the tutor knows your lesson, your current code, and how many times you've tried, and escalates hints accordingly. You write the answer; it makes sure you understand why.

<p align="center">
  <img src="frontend/public/readme-hero.png" alt="CodeTutor AI — three-pane workspace: lesson instructions on the left, code editor in the middle, AI tutor on the right with structured explanation, example, and pitfalls sections." width="900" />
  <br/>
  <sub><b>Lesson workspace</b> — instructions, editor, and an AI tutor that guides without spoiling.</sub>
</p>

---

## Editor Mode

> A full coding workspace across nine languages. Each comes with a starter project so you can jump right in.

- **Professional editor** — syntax highlighting, autocomplete, multi-file projects, light + dark themes
- **Instant run** — sandboxed container returns stdout, stderr, and execution time
- **Highlight + ask** — select any code and press <kbd>Cmd</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> to ask the tutor about it
- **Dedicated stdin** — sample input pre-filled per language, or paste your own
- **First-time tour** — walks you through the workspace on your first visit

## Guided Learning

> Two structured beginner courses today: 12-lesson **Python Fundamentals** (through a mini-project + two capstones) and 8-lesson **JavaScript Fundamentals** (through a habit-tracker mini-project). Shared content pipeline, per-language test harness, and authoring scripts. _(More courses on the way.)_

- **Learn by doing** — read, write, run, check your work. Loop.
- **Tutor that teaches, not solves** — knows your lesson context, gives escalating hints, never spoils the answer
- **Instant validation** — "Check My Work" runs your code against the lesson's completion rules and shows what to fix
- **Visible + hidden tests** — capstone lessons show example test cases you can run any time; "Check My Work" also runs hidden cases
- **Practice mode** — 30+ bite-sized challenges (3 per lesson) reinforce each concept with a different twist
- **Progress that sticks** — code, completions, and progress save to your account and sync across devices
- **Guided onboarding** — contextual nudges and a spotlight tour introduce the workspace on your first lesson
- **Learning dashboard** — see what's next, recent activity, and lessons worth revisiting

## Shared features

<table>
<tr>
<td width="50%">

**Adaptive AI tutor** — adjusts vocabulary and depth to your experience level (beginner, intermediate, advanced).

</td>
<td width="50%">

**Highlight + ask** — select code and press <kbd>Cmd</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> to ask about it anywhere in the app.

</td>
</tr>
<tr>
<td>

**Stuckness detection** — repeated failures on the same step unlock stronger hints and concrete next steps.

</td>
<td>

**Tutor access** — signed-in learners get a small daily allowance on the hosted tier. Bring your own OpenAI key for unlimited use — encrypted at rest, never surfaced back. Editor and run always work without either.

</td>
</tr>
<tr>
<td>

**Light & dark themes** — follows your system by default, or pick one in Settings. Editor and app chrome switch together.

</td>
<td>

**Accessible by default** — WCAG AA contrast, keyboard-navigable splitters, full ARIA labeling on every interactive surface.

</td>
</tr>
</table>

## Under the hood

A full-stack TypeScript product shipping to real users at **[codetutor.msrivas.com](https://codetutor.msrivas.com)**.

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#1e293b',
    'primaryTextColor': '#f8fafc',
    'primaryBorderColor': '#334155',
    'lineColor': '#64748b',
    'clusterBkg': '#0f172a',
    'clusterBorder': '#334155'
  },
  'flowchart': {
    'curve': 'basis',
    'htmlLabels': true,
    'nodeSpacing': 55,
    'rankSpacing': 70
  }
}}%%
flowchart LR
    U((User<br/>Browser))
    SWA[Static Web Apps<br/>frontend bundle]
    SB[(Supabase<br/>Auth + Postgres)]
    AI[OpenAI<br/>Responses API]
    KV[Key Vault<br/>runtime secrets]

    subgraph VM[Azure VM · Ubuntu 24.04]
        direction TB
        CD[Caddy<br/>TLS + reverse proxy]

        subgraph BECTR[Backend container · Express + TS]
            direction TB
            API[HTTP / SSE routes]
            SM[SessionManager<br/>userId to runnerId]
            EB[ExecutionBackend<br/>Dockerode client]
            SW[Idle sweeper<br/>45 s tick]
            API --> SM
            SM --> EB
            SW -. reaps idle .-> SM
        end

        SP[socket-proxy<br/>endpoint allowlist]

        subgraph POOL[Runner pool · one per session]
            direction TB
            R1[Runner A<br/>non-root · no net<br/>read-only rootfs]
            R2[Runner B]
            R3[Runner ...]
        end

        CD --> API
        EB -->|tcp:2375| SP
        SP -->|docker.sock| R1
        SP --> R2
        SP --> R3
    end

    U --> SWA
    U ==>|HTTPS / SSE| CD
    U -.->|auth| SB
    BECTR -->|JWKS + DB| SB
    BECTR -->|json_schema| AI
    BECTR -. Managed Identity .-> KV

    classDef user fill:#1e293b,stroke:#0f172a,color:#f8fafc,stroke-width:2px
    classDef edge fill:#0284c7,stroke:#0369a1,color:#fff,stroke-width:2px
    classDef svc fill:#0078d4,stroke:#005a9e,color:#fff,stroke-width:2px
    classDef proxy fill:#f59e0b,stroke:#b45309,color:#0f172a,stroke-width:2px
    classDef runner fill:#10b981,stroke:#047857,color:#fff,stroke-width:2px
    classDef external fill:#475569,stroke:#334155,color:#fff,stroke-width:2px

    class U user
    class SWA edge
    class CD,API,SM,EB,SW,KV svc
    class SP proxy
    class R1,R2,R3 runner
    class SB,AI external
```

<details>
<summary><b>Session lifecycle — create → snapshot → run → reap</b></summary>

<br />

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'fontFamily': '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    'fontSize': '13px',
    'primaryColor': '#0284c7',
    'primaryTextColor': '#f8fafc',
    'primaryBorderColor': '#0369a1',
    'lineColor': '#64748b',
    'actorBkg': '#1e293b',
    'actorTextColor': '#f8fafc',
    'actorBorder': '#334155',
    'signalColor': '#cbd5e1',
    'signalTextColor': '#e2e8f0',
    'noteBkgColor': '#fef3c7',
    'noteTextColor': '#78350f',
    'noteBorderColor': '#f59e0b',
    'sequenceNumberColor': '#f8fafc',
    'activationBkgColor': '#10b981'
  }
}}%%
sequenceDiagram
    autonumber
    participant U as Browser
    participant BE as Backend
    participant SM as SessionManager
    participant SP as socket-proxy
    participant RN as Runner

    U->>BE: POST /api/session (JWT)
    BE->>SM: create(userId)
    SM->>SP: /containers/create (allowlist check)
    SP->>RN: spawn · non-root · --network none · read-only
    RN-->>SP: containerId
    SP-->>SM: handle
    SM-->>BE: sessionId
    BE-->>U: { sessionId }

    U->>BE: POST /api/project/snapshot (files)
    BE->>RN: write workspace

    U->>BE: POST /api/execution/run (code, stdin)
    BE->>SP: exec
    SP->>RN: run · CPU · mem · PID capped
    RN-->>BE: stdout · stderr (SSE)
    BE-->>U: streamed output

    Note over SM,RN: Idle sweeper ticks every 45 s —<br/>reaps sessions past idle timeout
    SM->>SP: /containers/{id} DELETE
    SP->>RN: stop · remove
```

</details>

| Layer | Stack |
| --- | --- |
| **Frontend** | React + Vite + Tailwind + Monaco + Zustand. React Router, SSE streaming, optimistic DB writes with server reconciliation. |
| **Backend** | Node + Express + TypeScript. Auth + Postgres via Supabase. OpenAI Responses API with strict `json_schema` + intent classifier (debug · concept · howto · walkthrough · checkin). |
| **Execution** | Per-session Docker runner container — non-root, `--network none`, read-only rootfs, CPU / memory / PID capped. Dockerode goes through a `socket-proxy` sidecar with an endpoint allowlist, not the raw socket. |
| **Content pipeline** | File-based courses with Zod schemas, a concept graph (used-before-taught detection), per-language function-test harness with HMAC-signed result envelopes, and golden-solution verification in CI. |
| **Infra** | Azure VM + Static Web Apps + Key Vault (managed-identity secret delivery); Caddy + Let's Encrypt TLS. GHCR images, OIDC deploys, Log Analytics + metric alerts + weekly VM backups. |
| **Tests** | Vitest (unit) + content validation + Playwright (end-to-end, real Docker stack). |

Full system design, security posture, and API surface: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Get started

> [!TIP]
> **You don't need to install anything.** Click the live link, sign in, and you're coding in seconds — a small daily allowance of tutor questions is included.

### Try it live

Head to **[codetutor.msrivas.com](https://codetutor.msrivas.com)** and sign in with an email magic-link or Google OAuth. The editor and run-code work instantly; drop in your own [OpenAI API key](https://platform.openai.com/api-keys) for unlimited tutor use.

### Build it locally

Full dev setup (Docker Desktop + Supabase project credentials + frontend/backend install) is documented in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. Content authoring (lessons + practice exercises) is in **[docs/CONTENT_AUTHORING.md](docs/CONTENT_AUTHORING.md)**.

---

<div align="center">

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. Source available for personal viewing and learning. See <a href="LICENSE">LICENSE</a>.</sub>

</div>
