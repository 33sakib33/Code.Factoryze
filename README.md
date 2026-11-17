# Factoryze

Factoryze is a desktop code editor for learning to work with AI agents. It uses **its own Factoryze agent**. See [SPEC.md](SPEC.md), [PLAN.md](PLAN.md) and the dated [progress log](PROGRESS.md).

Contributions are welcome. Start with the [practice-problem map](docs/problem-library.md) to choose a distinct learning goal and the [contribution guide](docs/contributing-problems.md) to add a problem and open a PR, or see [CONTRIBUTING.md](CONTRIBUTING.md) for general setup and checks. Use [SECURITY.md](SECURITY.md) for private vulnerability reporting.

**Status, 2026-11-01:** the lab server and desktop completed a two-machine run over a real LAN with the owner acting as the student. Docker grading passed on the macOS server and in the Ubuntu workflow; Windows Docker grading is still unverified. Grading remains opt-in and off by default. The ten-machine classroom pilot, current task measurements, cross-OS release checks and required human review remain open; 0.1/0.2 are unreleased. See the [two-machine record](docs/verification/2026-11-01-two-machine-lab/README.md), [Docker setup](docs/docker-grading.md) and [progress log](PROGRESS.md).

## Use the preview

The Phase 2 lab software is on `main`: [desktop Join lab and IT setup](docs/lab-pilot.md), server agent/local approvals, separate budgets, workspace sync, immutable submissions and instructor report-release/CSV integration. A 60-client synthetic functional load and the owner-driven two-machine LAN run pass. The ten-machine dry run, classroom partner/date, current task measurements, cross-OS verification and human review remain pending; this is not a classroom-ready release. Solo BYOK and trial credits remain available.

Install the current artifact following [INSTALL.md](INSTALL.md). Python 3.11+ is required. The app opens to **Home** and never reopens your last task by itself:

- **Classroom** offers **Join a lab** and **Refresh lab results**. Lab submissions are saved for isolated grading and instructor release; grading requires an explicitly enabled, verified Docker grader on the server.
- **Continue** lists your three most recent attempts, with their token use. **Show all attempts** reveals older work, including unsubmitted retired tasks.
- **Practice tasks** lists bundled tasks and enabled tasks fetched from the Factoryze service. The catalog is searchable and can be refreshed while signed out; sign in under Model connection to download and start a hosted task. **Start** opens a sheet with the brief, a Python check and the attempt's token budget; **Start attempt** sets up a fresh copy of the starter code. **Open task folder…** and **Open task ZIP…** import your own task packs.
- **Results** lists every submission. Click one to read its report.

For a hosted task, the app verifies the downloaded archive's size and SHA-256 before import, stores an immutable task pack in its private data directory, and removes the temporary ZIP. The default data directory is `~/Library/Application Support/Factoryze/engine` on macOS, `%LOCALAPPDATA%\Factoryze\engine` on Windows, and `$XDG_DATA_HOME/factoryze/engine` (or `~/.local/share/factoryze/engine` when unset) on Linux. On first launch, existing data in `~/.factoryze` moves to the native location; a conflicting nonempty target stops startup so neither store is discarded. Each **Start attempt** creates a separate editable folder under `~/Factoryze Practice`; **Continue** reopens that folder. `FACTORYZE_DATA_DIR` and `FACTORYZE_PRACTICE_SESSIONS_DIR` can override those roots for managed installations. Problem files are kept on the PC, separate from the browser demo and the installer download.

The bundled practice tasks are **Library fines**, **Monthly revenue report**, **Read a Linux process snapshot**, **Stop a retry storm**, and **Guard a webhook allowlist**. Their public tests pass on the deliberately buggy starters; the brief supplies the symptom, and hidden checks verify the fix. Stable customer IDs and Pagination API are retired from Practice tasks. Their existing attempts, usage and reports remain available through Continue and Results, and can still be submitted.

Bundled task checks and benchmark references are part of this source repository. They are examples for practice and development, not secret material for a controlled assessment. Instructors should load separately held private task packs for graded labs; see [the lab guide](docs/lab-pilot.md#instructor-operations).

An attempt opens the editor: the Explorer with the task brief pinned at the top, the editor, the terminal and Tests panel, and the agent. The title bar shows the attempt, a budget meter with one segment per prompt (click it for input, cached input and output), the elapsed time, **Run tests** and **Submit**. **Home** returns to Home; the attempt stays in Continue.

To use the agent, connect a model from Home or **Settings**: OpenAI, Anthropic, OpenRouter, another OpenAI-compatible service, or a model on this computer. Keys stay in your system keychain and Factoryze's backend. **Settings → Appearance** switches between Match system (the default), Light and Dark. Factoryze uses only its own agent; it supports streaming OpenAI Chat Completions and Anthropic Messages. For OpenRouter use `https://openrouter.ai/api/v1`.

The same dialog offers **Trial credits**: sign in with an emailed code, claim an invitation and select an available sponsored model. Signup alone grants no credit or admin access. Your saved API-key connection remains available; switching is explicit. Trial credit is a server-enforced monetary allowance, separate from the local task token budget. Operators must deploy and enable the companion gateway before public use; see [trial setup](docs/trial-credits.md).

The agent reads and searches the attempt's files and proposes edits (shown as a diff) and commands for your approval. Each prompt shows what it cost. **Stop** cancels active work; **New session** in the agent's menu clears the conversation but keeps the usage. See [the harness tools and limits](docs/harness.md).

## Tasks, budgets and reports

Task folders and ZIPs follow [the task pack format](docs/task-packs.md). `budgetTokens` sets the weighted limit for each attempt; you can change it for a task on the start sheet. Raw input includes the agent's instructions, tool definitions, history and cache. Weighted usage counts fresh input, output and cache writes fully, plus 0.1 times cache reads.

Every attempt has its own usage and budget, even for the same task. New session, a restart and continuing an attempt keep its usage. When an attempt uses its budget, the agent pauses; in practice you can **Raise budget**, and the next report says so. If a response ends before the provider reports usage, the agent pauses until you **Fix token count** from the provider's record. Prompt feedback (judge) usage is separate and doesn't count against the budget.

**Run tests** runs the public tests in the Tests panel. In **solo practice**, Submit runs hidden checks and saves a report: checks passed, each check by name, tokens, prompts with their cost, activity and time. **Lab Submit** saves a synchronized snapshot for isolated grading and instructor release; production server grading is currently disabled. Reports contain no suggestions or prompt scores. You can keep working and submit again; every submission is kept. Background prompt feedback and Home result scores remain optional for BYOK and are off for trial/lab connections. Factoryze efficiency baselines have not been recorded yet. The task venv, agent shell and terminals use the curated package index. Solo/local tool execution is not an OS sandbox.

Each check has 10 seconds to finish. A timeout appears as a failed check, and the remaining checks continue. After 120 seconds of grading, remaining checks are marked as timed out; Submit still saves the results.

## Develop and verify

Use Node.js 22.12 or newer in the 22.x line, pnpm 10.28.2 and Python 3.11+.

Native builds need a C++ toolchain: Xcode Command Line Tools on macOS, or Visual Studio 2022 C++ Build Tools on Windows (the CI runner is Windows 2022). On Windows, select **Desktop development with C++** and the matching **MSVC v143 C++ x64/x86 Spectre-mitigated libs** under Individual components; `node-pty` requires those libraries. Before `pnpm install` on Ubuntu 24.04, install `build-essential pkg-config libx11-dev libxkbfile-dev libsecret-1-dev`. These are source-build prerequisites; the installer bundles the native modules. `pnpm build:app` downloads the pinned Electron executable before rebuilding the native modules.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:app
pnpm --filter @factoryze/app start /path/to/practice/workspace
pnpm --filter @factoryze/app package:installer
pnpm --filter @factoryze/app verify:package
pnpm --filter @factoryze/app smoke:installer
```

The installed smoke uses synthetic responses and an isolated credential account. It covers Home on launch and relaunch, the start sheet, diff and command approvals, reports and resubmission, raising the budget, task folder/ZIP import, connecting a model from Settings, dark appearance across a relaunch, and budget refusal across New session and restart. Linux needs Xvfb plus Secret Service. Generated screenshots/receipts are in `dist/smoke-<platform>/`. The recorded installed smoke passes on Windows/Linux in CI and macOS from a local DMG; saved receipts are in [`docs/verification/2026-10-23-platforms/`](docs/verification/2026-10-23-platforms/). That earlier three-OS unit suite is 176 tests plus typecheck. These existing results and their remaining manual gates are detailed in [the release evidence](docs/phase-1.md#release-evidence); the old receipts do not verify the new report slice. The full Phase 4 parity/distributed-protocol work remains pending.

The [2026-10-28 Windows audit](docs/verification/2026-10-28-windows-verification/checks.json) records 207/207 tests with no skips, typecheck/build, NSIS packaging/resource verification and the complete installed smoke including uninstall and temporary-folder removal under a path with spaces. Windows link fixtures use real directory junctions without changing OS privileges; ZIP file/directory symlink rejection is also covered. Fresh macOS/Linux verification, downloaded-installer/manual checks and human review remain open.

Reports now use the approved design: a prominent result with one perimeter segment per hidden check, a modal showing failed checks and reasons first, explained summary metrics, activity/token analysis and saved per-prompt costs. Pass/fail card dimensions stay stable. Reports show no suggestions or prompt-quality scores, including for scored historical submissions. Missing older data stays unknown. The app shares its production renderers/CSS with the [interactive HTML preview](mockups/report.html); build it with `node mockups/build-report.mjs` and check it with `node mockups/check-report.mjs` (Chrome, or set `FACTORYZE_PREVIEW_BROWSER` to an installed Playwright channel). [The app report audit](PROGRESS.md#2026-10-24--approved-report-design-in-the-app) records the implementation and earlier checks.

The owner resumed Docker on 2026-10-29. Its shared command executor and lab grader are implemented as an opt-in. The real container checks pass on macOS/arm64 and Ubuntu/amd64, and a full graded lab passes end to end on macOS; Windows remains unverified; see [Docker setup](docs/docker-grading.md). Sandboxed benchmark integration (PLAN 3a) remains pending. Today's `bench:variance` has no `--sandbox` option. The next task's deterministic content/checks/reference/scripts (3b) are implemented in experimental [Activity feed](tasks/benchmark/activity-feed/README.md); it is not bundled or model-benchmarked yet. Release gates and the Windows shell decision remain open. Lab mode still awaits a partner lab/date/server OS and its isolation prerequisites. Paid measurements require separate approval and a spending limit.

Backend environment configuration takes precedence over the keychain. Supply `FACTORYZE_PROVIDER_URL`, `FACTORYZE_MODEL`, `FACTORYZE_PROVIDER_API_KEY`; optional settings are `FACTORYZE_MODEL_API` (`openai-chat` or `anthropic-messages`), `FACTORYZE_CONTEXT_WINDOW`, `FACTORYZE_MAX_OUTPUT_TOKENS`, `FACTORYZE_TEMPERATURE` (0–2, unset by default), `FACTORYZE_TOKEN_BUDGET`, `FACTORYZE_DATA_DIR`, `FACTORYZE_PYTHON_BIN`, `FACTORYZE_JUDGE_ENABLED`, `FACTORYZE_JUDGE_MODEL` and `FACTORYZE_SCORING_ENABLED`. Provider URLs require HTTPS except loopback HTTP. Keep real keys out of commands/fixtures committed to the repository.

The model connection dialog exposes optional Temperature under Model limits and sampling. It applies to new agent sessions; blank uses the provider default. Reports retain the recorded harness version, model, provider host, temperature and OS for each distinct session configuration. See [harness safeguards](docs/harness.md). Paid model calls, spikes and benchmarks require explicit approval and an agreed spending limit.

Python setup checks the version and imports `venv`/`ensurepip` before starting. Linux users receive the matching Debian/Ubuntu venv package command when needed; Windows supports the `py` launcher and reports Store-alias setup guidance. Linux keychain errors explain the Secret Service prerequisite and backend environment fallback. See [platform setup](INSTALL.md).

`pnpm spike:harness:live --help` describes the live greeting without credentials or a model call. After explicit spending approval, `--existing` reuses the saved Factoryze connection; otherwise the spike uses backend environment settings. A historical MiniMax-M2.7 check completed in one request with 887 input / 9 output tokens (896 weighted), retained after SQLite restart. This verifies connectivity, not agent quality. `pnpm bench:record --profile factoryze --task library-fines` can record a baseline with interactive approval; existing baseline files are never overwritten. The version guard is implemented, but paid recording remains paused. The new tasks have no bundled efficiency baselines yet; reports still show correctness and actual usage when a matching baseline is absent. Parity/quality benchmarks remain pending.
