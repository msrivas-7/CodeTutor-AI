<div align="center">

<img src="https://img.shields.io/badge/CodeTutor_AI-Learn_to_Code_with_AI-0f172a?style=for-the-badge&labelColor=0f172a" alt="CodeTutor AI" />

<br />

**Learn to code with an AI tutor that guides you — without giving away the answers.**
<br />
Write code, run it in a sandboxed environment, and get structured help when you're stuck.
<br />
No account needed. Runs entirely on your machine.

<br />
<br />

[![Languages](https://img.shields.io/badge/9_Languages-Python_%7C_JS_%7C_TS_%7C_C_%7C_C++_%7C_Java_%7C_Go_%7C_Rust_%7C_Ruby-38bdf8?style=flat-square)](https://github.com/msrivas-7/CodeTutor-AI)
[![Docker](https://img.shields.io/badge/Runs_in-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/products/docker-desktop/)
[![OpenAI](https://img.shields.io/badge/AI_Tutor-OpenAI-412991?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/api-keys)

<br />

[**Architecture**](docs/ARCHITECTURE.md) &nbsp;&bull;&nbsp; [**Development**](docs/DEVELOPMENT.md)

<!-- TODO: Add screenshot/GIF here -->

</div>

<br />

---

## Editor Mode

> A full coding workspace with 9 languages. Each language comes with a starter project so you can jump right in.

- **Write code** in a professional editor with syntax highlighting, autocomplete, and multi-file support
- **Run instantly** in a sandboxed container — see output, errors, and execution time
- **Ask the AI tutor** about your code — highlight a section and press `Cmd+K` to ask about it
- **Provide input** via a dedicated stdin tab, pre-filled with sample data for each language
- **First-time tour** walks you through the workspace on your first visit

## Guided Learning

> Two structured beginner courses: 12-lesson **Python Fundamentals** (through mini-project + two capstones) and 8-lesson **JavaScript Fundamentals** (through a habit-tracker mini-project). Instructions, starter code, and auto-validated exercises across both — powered by a shared content pipeline, per-language harness registry, and authoring scripts. _(More courses on the way.)_

- **Learn by doing** — read the instructions, write code, run it, and check your work
- **AI tutor that teaches, not solves** — knows your lesson context, gives escalating hints, and never spoils the answer
- **Instant feedback** — "Check My Work" validates your code and shows what to fix. Pass to see a recap and practice challenges
- **Example test cases** — capstone lessons expose visible example cases in an Examples tab. Run them any time to see how your function behaves before submitting; Check My Work also runs extra hidden cases
- **Practice mode** — 30+ bite-sized challenges (3 per lesson) reinforce concepts with a different twist. Optional, tracked separately, visible per-lesson on the course page
- **Progress that sticks** — your code, completions, and progress persist in the browser. Pick up where you left off — with a visible warning if your browser storage fills up so nothing is silently lost
- **Guided onboarding** — contextual nudges help you figure out what to do next. A spotlight tour introduces the workspace on your first lesson
- **Learning dashboard** — see your progress, what's next, recent activity, and which lessons might need review

## Shared Features

<table>
<tr>
<td width="50%">

**Adaptive AI tutor** — adjusts vocabulary and depth to your experience level (beginner, intermediate, advanced)

</td>
<td width="50%">

**Highlight + ask** — select code and press <code>Cmd+K</code> / <code>Ctrl+K</code> to ask about it

</td>
</tr>
<tr>
<td>

**Stuckness detection** — repeated failures unlock stronger hints and concrete next steps

</td>
<td>

**Bring your own key** — uses your OpenAI API key, never stored on any server. Editor and run work without one

</td>
</tr>
<tr>
<td>

**Light & dark themes** — follows your system by default, or pick one in Settings. Editor and app chrome switch together

</td>
<td>

**Accessible by default** — WCAG AA color contrast, keyboard-navigable splitters, full ARIA labeling on every interactive surface

</td>
</tr>
</table>

---

## Getting Started

<table>
<tr>
<td>

**Prerequisites**

</td>
<td>

[Git](https://git-scm.com/downloads) and [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running). Optional: [OpenAI API key](https://platform.openai.com/api-keys) for the AI tutor.

</td>
</tr>
</table>

### macOS / Linux

```bash
git clone https://github.com/msrivas-7/CodeTutor-AI.git
cd codetutor-ai
./start.sh          # first build ~2-3 min, then ~10s
```

### Windows

```powershell
git clone https://github.com/msrivas-7/CodeTutor-AI.git
cd codetutor-ai
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

<br />

> First launch builds Docker images (~2-3 min). After that, startup takes ~10 seconds.
> Open **http://localhost:5173** and you're in. Stop with `./stop.sh` or `.\stop.ps1`.

### System requirements

| | Minimum |
| --- | --- |
| **RAM** | ~4 GB free while running |
| **Disk** | ~2 GB for Docker images (first build only) |
| **Network** | Internet for first build. After that, only the AI tutor needs internet. |

---

<details>
<summary><strong>Troubleshooting</strong></summary>

<br />

| Problem | Fix |
| --- | --- |
| "Cannot connect to the Docker daemon" | Docker Desktop isn't running. Open it and wait for the icon to settle. |
| "Bind mount failed" (Windows) | Docker Desktop > Settings > Resources > File Sharing > enable your drive. |
| Port 4000/5173 in use | Stop the other process, or remap ports in `docker-compose.yml`. |
| "running scripts is disabled" (Windows) | Use the full command: `powershell -ExecutionPolicy Bypass -File .\start.ps1` |
| First build is slow | Expected (~2-3 min). Subsequent launches use cache (~10s). |
| Nothing at localhost:5173 | Give it 10s for the Vite dev server to warm up. |

</details>

---

<div align="center">

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. Source available for personal viewing and learning. See <a href="LICENSE">LICENSE</a>.</sub>

</div>
