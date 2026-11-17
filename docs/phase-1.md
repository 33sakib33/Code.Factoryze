# Solo preview: Phase 1

Status reconciled 2026-10-28. Factoryze is the only app backend. Reports and optional sponsored trial credits are implemented. Current Windows automated verification passes, including all 207 tests and installed-app uninstall/cleanup; the real-email/OpenRouter desktop trial also passed. Fresh macOS/Linux gates, remaining BYOK/manual checks and recorded human review are outstanding. Release 0.1 remains unreleased. The desktop package is still `0.0.1`; `factoryze@0.1.0` identifies the harness, not a published desktop release.

**Recorded evidence before the report improvements:** 176/176 tests and typecheck passed on Windows, macOS and Linux ([CI](https://github.com/33sakib33/Factoryze/actions/runs/39810458037)). Installed smoke passed on Windows/Linux ([run 39826255212](https://github.com/33sakib33/Factoryze/actions/runs/39826255212)) and macOS arm64 from a local DMG, at 683×512. It solves Library fines (9/9 hidden), verifies retained retired attempts, and covers Home, Settings, report pins, approvals, native-shell public tests, metering, budgets, restarts and appearance. These receipts do not cover the newer report/trial slices. Current Windows evidence is linked below; the older failures in [the report audit](../PROGRESS.md#2026-10-24--report-improvements-and-docker-deferral) remain historical. The installed smoke uses synthetic providers.

## Implemented scope

| Requirement | Implementation |
| --- | --- |
| Solo launcher, task/model selection, OS keychain | Home-first startup, explicit Continue, current-window folder/ZIP task opening and a model connection dialog in Settings; backend-only credential storage |
| Python check and venv | Python 3.11+ plus `venv`/`ensurepip` preflight; Windows `py` launcher and Store-alias guidance; matching Debian/Ubuntu venv-package remedy; partial-folder cleanup |
| Engine pip index | Loopback curated wheelhouse; venv config plus agent/terminal environment; no external-index fallback |
| Workbench | Pane toggles, elapsed timer, persisted budget display, streamed replies and tool cards |
| Edit and command approvals | Unified before/after diff; one-time approval/rejection; Stop and New session; in-process pane events rather than a separate ACP agent process |
| Factoryze harness | Built-in engine loop and local tools; metered gateway; streamed replies; approved edits and shell; Stop; bounded context/output; no external agent binary |
| Harness safeguards | Version fingerprint for instructions, canonical tool definitions and shared limits; recorded session configurations in report snapshots; optional connection temperature with safe provider-refusal guidance and no retry |
| Engine | OpenAI Chat and Anthropic Messages streaming/JSON; raw/weighted usage; durable scoped budget; SQLite events and reports; independent public/hidden checks with 10-second limits and a 120-second run cap |
| Modules | Opt-in judge `score` and scoring v1; no blocking judge, trials, or integrity module |
| Content and benchmarks | Library fines and reworked Monthly revenue, green public tests on buggy starters, nine hidden checks each, expert/middle/naive scripts; retired tasks and their graders remain bundled for old attempts; new efficiency baselines optional and not yet recorded |
| Distribution | macOS DMG, Windows NSIS, Linux AppImage targets; clean native builds using maintained Electron rebuild tooling; three-OS build/conformance/installed-smoke workflow |

## Using this build

Build with `pnpm install --frozen-lockfile`, `pnpm build:app`, then `pnpm --filter @factoryze/app package:installer`. Install the artifact for your OS using the instructions in INSTALL.md. Use File → Open Task Folder / ZIP, or start a bundled example. Task opening reuses the window. Chat requires a supported provider/model/key connection; manual editing, tests and reports work without a key. Trust only the task folder you just created. Use the Agent pane or edit manually, Run tests, then Submit for report for a saved, unverified practice report. Stop interrupts the active agent and judge request. Starting a new task workspace resets input/output/cache/weighted meters and gives that run its own budget, even when repeating a task. New session, restart and reopening the workspace preserve that run’s usage. Reports retain cumulative history.

Enable **Prompt feedback** for optional assessments in the agent pane. An optional judge model uses the same provider/key as the main model; leaving it blank uses the main model. Assessments see up to three recent prompts (4,000 characters each) and 16,000 characters of the current prompt as untrusted data. A failed/unavailable judge does not block Factoryze. Judge usage is recorded separately from student usage and still costs provider tokens. The approved report view displays no prompt grades or suggestions, including from older saved assessments.

Enable **Score in results** to save optional scoring v1 with new submissions and show available aggregate scores in Home results. The approved report itself shows correctness and usage without aggregate/prompt score text. Settings affect new sessions/submissions; saved reports are never silently re-scored. Both modules start disabled. Explicit backend provider settings are labelled in the form and disable desktop setting edits; this path does not access the desktop keychain. Earlier or partially assessed histories retain unavailable scores rather than invented zeroes.

## Draft scoring version 1

All values are on a 0–100 scale, rounded to one decimal. The exact inputs, baseline/history eligibility (`scoringContext`), and score are saved in the report snapshot.

- Correctness: `100 × passed / total` hidden checks. Any failed check gates the overall score to zero.
- Efficiency: `100 × min(1, 2 / (token_ratio + turn_ratio))`, using the expert baseline for the exact task, profile version, model and prompt-script hash. Token ratio is weighted workspace tokens / expert tokens; turn ratio is completed workspace prompt turns / expert turns. Mixed models, missing/stale baselines, unknown turns, or incomplete accounting make efficiency unavailable.
- Specificity: the mean judge specificity, with weight 2 for a prompt that produced an explicitly approved and completed edit and weight 1 for other assessed prompts. Every prompt must have a valid assessment and the completed-turn history must be fully covered.
- Overall: `(10 × correctness + 4 × efficiency + 3 × specificity) / 17`. This normalizes the spec's 0.5/0.2/0.15 weights while verification is absent in Phase 1. If a solved submission lacks either efficiency or specificity, its overall score is unavailable.

This formula is a draft until the first release and human review. A later released formula change must receive a new scoring version. Scores reproduce from the saved correctness, baseline comparisons, assessments and scoring context without asking the judge again. Trial verification and detailed efficiency breakdown by tool kind belong to later work; model response usage cannot reliably assign tokens to individual ACP tools.

## Pip and usage recovery

The engine serves vetted `.whl` files from `<FACTORYZE_DATA_DIR>/wheels`. Current tasks need no third-party packages. Put only reviewed wheels and their required dependencies there; their project pages include SHA-256 links. Missing packages fail locally. The index does not download, execute, or upload packages, and supplies no decoys. The Phase 5 allowlist proxy, request audit and supply-chain handshake remain separate work.

The engine refreshes its loopback URL when a workspace reopens. Both the agent shell and new workbench terminals receive `PIP_INDEX_URL`, an empty `PIP_EXTRA_INDEX_URL`, and an engine-owned `PIP_CONFIG_FILE`; each venv also has its own pip config. An already-running terminal must be reopened after an engine restart. Solo users can change their own environment; this is not a network sandbox.

Missing/truncated usage preserves observed counts and blocks further model calls. In Task → Resolve incomplete token accounting, enter full raw counts from the provider's request record, its reference, and confirmation. Counts cannot decrease; a live pending request is refused. A pre-schema-6 pending request additionally requires confirmation that its original process has stopped. Corrections produce an append-only audit event, keep the original budget, and can leave the account exhausted. Stop before reconciliation, start a new session after it, and resubmit to save an updated report. Earlier report snapshots remain unchanged. This is a local unverified practice recovery flow.

## Release evidence

**Current Windows verification, 2026-10-28:** 207/207 tests with no skips, typecheck, app build, fresh NSIS packaging/resource verification and the complete installed smoke pass, including synchronous uninstall and removal of its owned temporary root under a path with spaces. Reports, approvals, budgets, imports, restarts and appearance are exercised in the installed app. Independent post-cleanup checks find no smoke root, Factoryze installation registration or running Factoryze app. The two link-fixture `EPERM` failures and wrapper cleanup failure are closed; production link rejection remains unchanged. [Checks, initial failures and receipts](verification/2026-10-28-windows-verification/checks.json).

The separate [real Windows desktop trial](verification/2026-10-28-real-desktop-trial/live-checks.json) verifies SMTP OTP, restricted roles, OpenRouter, approvals, a 9/9 report and matching credit deduction within the approved cap. That pilot is paused. Fresh macOS/Linux checks and remaining BYOK/manual/downloaded-artifact checks are still required. **The following table preserves the earlier three-OS baseline; it is not current verification of all slices.**

| Gate | macOS arm64 | Windows | Linux |
| --- | --- | --- | --- |
| Unit/contracts/replay and typecheck | 176 tests + typecheck passed | 176 tests + typecheck passed | 176 tests + typecheck passed |
| Installer builds and packaged resources | DMG built; resource verification passed locally and in CI | NSIS installer built; resource verification passed in CI | AppImage built; resource verification passed in CI |
| Factoryze launch/stream/edit/shell/metering/budget conformance | Passed locally with synthetic provider | Covered by the 176 CI tests (PowerShell shell) | Covered by the 176 CI tests |
| Installed task → prompt → approve → submit → saved report | Passed from a local DMG at `59e5b3d` ([receipt](verification/2026-10-23-platforms/darwin.json)); terminal index and Stop verified too | Passed in CI at `59e5b3d`, run 39826255212 ([receipt](verification/2026-10-23-platforms/windows.json)) | Passed in CI under Xvfb with an isolated keyring, run 39826255212 ([receipt](verification/2026-10-23-platforms/linux.json)) |
| Real-provider usage and task baselines | Historical OpenCode/MiniMax metering/baselines and judge 88/100; Factoryze/MiniMax greeting: 887 input / 9 output, persisted after restart. Greeting proves connectivity, not an end-to-end task or parity. Active tasks have no Factoryze baselines | Manual real-provider task run required | Manual real-provider task run required |
| Gatekeeper / SmartScreen on downloaded artifact | Manual Gatekeeper check required | Manual SmartScreen check required | AppImage launch required |
| Human review | Required review evidence for schema 6/7, task imports/retirement, keys/permissions, scoring, report/session pins, temperature UI and historical baselines must be recorded before release. PR #2 is merged; approval cannot be inferred from that commit | Same review | Same review |

Run `pnpm test`, `pnpm typecheck`, `pnpm build:app`, `pnpm --filter @factoryze/app package:installer`, `pnpm --filter @factoryze/app verify:package`, and `pnpm --filter @factoryze/app smoke:installer`. The installer smoke mounts/copies the DMG, silently installs NSIS into a temporary location, or extracts AppImage, then drives the real application with synthetic model responses. It checks a 683×512 window, accessible toolbar controls across workspace reloads and public tests through the native agent shell. Headless Linux CI uses Xvfb inside a D-Bus session with an isolated, unlocked GNOME keyring; see `.github/workflows/installers.yml`. Evidence is saved in `dist/smoke-<platform>/`. The automated test does not prove downloaded-app security warnings, direct FUSE launch or real-provider accounting.

Phase 1 can be released after all required OS gates pass and the human review is recorded. No Phase 2 lab networking, instructor UI or trials are included. The early solo harness is now the only backend; the full Phase 4 protocol, tools and parity work remain pending.

## Remaining work and next steps

- [x] Grader process limits; active/retired task pack; standard-library test commands; setup/packaging/platform repairs; version guard, report pins and solo temperature (PLAN 1a–1d, setup portion of 1f, and 2a–2c).
- [x] Recorded three-OS unit/typecheck and installed-smoke gates. Receipts are linked above; this is not a new verification run.
- [x] Approved report design implemented in the app: per-check segments, failed-details modal, stable pass/fail layout, explained metrics, saved activity/request groups and immutable prompt costs. No report suggestions or prompt grades. [HTML preview](../mockups/report.html) shares the production report renderers and CSS.
- [x] Current Windows report/trial-slice automated tests/typecheck/build/NSIS/resources and complete installed smoke, including cleanup. [207/207 tests, zero skips and receipts](verification/2026-10-28-windows-verification/checks.json). Earlier Windows symlink/cleanup failures remain in their dated receipts as historical evidence.
- [ ] Fresh macOS/Linux report/trial-slice tests/typecheck/build/installed smoke and recorded contract/authentication/key-handling review.
- [ ] Complete remaining Windows BYOK/manual and Linux task → real provider → approval → submission checks. The separate sponsored Windows trial passed; retain its scope and historical macOS evidence explicitly.
- [ ] Record downloaded DMG Gatekeeper, NSIS SmartScreen and direct AppImage launch checks.
- [ ] Record the required human review and prepare the reviewed 0.1 version/artifacts/contract freeze. Release is not cleared by the existing merge.
- [ ] Resolve the Windows terminal-default decision: terminal is Command Prompt; agent shell is PowerShell 5.1. Model compatibility changes need measurement before a harness version bump.
- [x] Another task's deterministic starter/brief/checks/reference/prompt scripts (PLAN 3b): experimental Activity feed, with [content evidence](verification/2026-10-28-activity-feed/checks.json).
- [ ] Activity feed promotion, model measurements and guarded baselines still need review, clean evidence and approved spend. **Docker installation, shared executor and sandboxed benchmarks are deferred by the user (3a); do not start them now.** Today's CLI has no `--sandbox` option.
- [ ] Start lab mode (5) after choosing the partner lab, pilot date and server OS and completing its measurement/executor prerequisites. Solo temperature support does not implement lab pinning.

The [active plan](../PLAN.md#immediate-plan-added-2026-10-22-status-updated-2026-10-24) owns the work order. The [2026-10-24 audit entry](../PROGRESS.md#2026-10-24--project-status-and-documentation-reconciliation) records this documentation change and verification limits.


## Solo flow (2026-10-22)

The approved flow from `mockups/flows.html` replaces the earlier launcher, task sidebar and Configuration page.

- **Home on launch.** The workspace server no longer restores the most recent workspace, so every launch and relaunch opens Home. A folder passed on the command line still opens directly. Home lists Continue (the three most recent attempts with usage), Practice tasks (with each task's open attempt or best result), and Results (every submission). Home and the pages opened from it render in a full-window layer below the title bar.
- **Start sheet.** Brief, time hint, a Python check (`findPython`, no venv created), and the token limit for the task's attempts, then real setup steps. Folder and ZIP imports open their attempt directly.
- **Attempt.** Explorer with the task brief pinned above the file tree; Tests panel beside the terminal; title bar with Home, the attempt number, a budget meter with one segment per prompt rebuilt from the engine's per-prompt costs, a popover for input, cached input and output, elapsed time, Run tests and Submit. Theia workspace trust prompts are off (Factoryze creates the folders) and `.venv` and `__pycache__` are hidden.
- **Agent pane.** Tool rows use paths relative to the attempt. Edits are approved from a unified diff; commands from a "Run a command" card. Send turns into Stop while the agent works; New session and Model settings are in the menu. Each turn shows its token cost. Banners pause the agent when the budget is used up (Raise budget, practice only, recorded on the report) or a token count is incomplete (a guided Fix token count dialog).
- **Reports.** The approved design shows a prominent correctness result with one evenly spaced segment per check. A modal lists failed checks with reasons first and expandable passed checks. Pass/fail card dimensions stay equal. Explained metrics lead into activity, raw fresh/cache/output counts, request groups and saved per-prompt text/cost/state. Reports contain no suggestions, prompt grades or aggregate score text; optional saved scoring data and Home results remain compatible. Mixed/unknown activity remains explicit; tools/context are not independently metered. Students can keep working and submit again; saved activity/cost snapshots survive later work and usage corrections. Older reports show absent costs/history/check details as unknown. Prompt text stays in window-local storage; the ledger never stores prompts.
- **Settings.** Model connection (connect dialog with five provider choices), prompt feedback, score in reports, the default token budget, and Appearance (Match system, Light or Dark, applied to the whole window through Theia's theme). The OpenCode connection import and the OpenCode adapter code were removed.

Engine additions: `listAttempts`, `listReports`, `report(workspace, n)`, per-prompt usage from the event log order, per-check grading results, and a `budget` field on reports when the limit changed during the attempt. The new optional `insights` schema freezes metadata and ledger usage at submission without a new event type or database migration. Protocol additions are optional fields and new schemas only.

Historical verification when this flow landed on 2026-10-22 used 133 tests and a macOS DMG smoke. It is superseded for current status by the 176-test three-OS results and passing installed receipts in [Release evidence](#release-evidence). Manual provider/downloaded-artifact checks and recorded human review remain open.
