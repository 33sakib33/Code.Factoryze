# Factoryze: Development Phase Plan

Companion to [SPEC.md](SPEC.md) v0.6. Progress updated 2026-10-31; *Immediate plan* added 2026-10-22 and re-sequenced 2026-10-31 (§5, after Phase 1). The contributor-recognition track was added 2026-11-03 and implementation review began 2026-11-04 (§7). Browser participation and social rewards entered planning on 2026-11-06 (§7); their proposed scope is separate from the implemented desktop/lab releases.

**Current status (2026-10-31).** Phase 2's software is merged into `main` (PR #3 at `4a0e7f9`, then the lab-attempt fix in PR #4 at `67aaedf`). Docker grading passes real-container checks on macOS/arm64 and in the Ubuntu workflow (linux/amd64). A full graded lab passes end to end on macOS: CLI server with grading, desktop join, starter 5/9 and fix 9/9, release, report and CSV ([audit](docs/verification/2026-10-29-macos-lab-e2e/README.md)). 235 deterministic tests and typecheck pass on macOS. Nothing is released. What remains for 0.2 is mostly owner decisions, approved spending and real-machine validation; the *Immediate plan* (§5) orders it as a pilot path.

**Current status (2026-10-29).** Non-Docker Phase 2 is committed as `9f141b9` on `feature/lab-pilot`, with prior Windows desktop/installer and 60-client functional evidence. The owner has now resumed Docker grading. The opt-in command executor, pinned Python image, private queue/retry/status/release/CSV provenance and real check scripts are implemented; **234 deterministic tests and typecheck pass** on Windows and macOS. **Real Docker checks pass on macOS (Apple silicon, linux/arm64)**: 26 containers, Library fines starter 5/9 and fixed 9/9, zero left behind. Docker Desktop needed its builtin seccomp profile enabled. The [Ubuntu workflow](https://github.com/33sakib33/Factoryze/actions/runs/40907143338) also passes (234/234 tests, real Docker check). A full graded lab passes end to end on macOS: CLI server with grading, desktop join, starter 5/9 and fix 9/9, release, report and CSV ([audit](docs/verification/2026-10-29-macos-lab-e2e/README.md)). On Windows, Docker is absent and virtualization disabled. Default server grading stays off. [Setup](docs/docker-grading.md), [macOS Docker audit](docs/verification/2026-10-29-macos-docker-grading/checks.json), [Windows Docker audit](docs/verification/2026-10-29-docker-grading/checks.json), [non-Docker audit](docs/verification/2026-10-29-lab-completion/checks.json). Cross-OS/actual-LAN, task measurements, ten-machine/pilot and human-review gates remain open; 0.2 is not released.

**Current status (2026-10-28).** Release 0.1 is an unreleased solo preview. The approved reports (Immediate 4) and optional sponsored desktop funding (4a) are implemented. Reports retain their approved design with no suggestions or prompt scores. The two Windows link-fixture failures and installed-smoke cleanup failure are fixed: **207/207 tests, zero skips**, typecheck, app build, NSIS packaging/resource verification and the complete installed smoke including uninstall/removal pass. [Current Windows checks and audit evidence](docs/verification/2026-10-28-windows-verification/checks.json) retain the initial failures and final receipts. Earlier [release evidence](docs/phase-1.md#release-evidence) records three-OS checks; those older receipts do not verify these newer slices. Fresh macOS/Linux checks, remaining BYOK/manual provider and downloaded-installer checks, and recorded human review remain open. A merge is not evidence of human review.

**Completed user-directed slice (2026-10-27):** desktop sponsored trial credits are implemented on `feature/desktop-trial-credits`, with companion native authentication/gateway changes on backend `feature/desktop-trial-auth`. BYOK, restricted administration and the existing UI flow are retained. The Windows Electron flow uses isolated TLS SMTP and synthetic inference; no real email or paid model call is part of verification. See [desktop trial setup](docs/trial-credits.md) and [the progress entry](PROGRESS.md#2026-10-27--sponsored-trial-credits-in-the-desktop-connection-flow). This account-funding feature is separate from the later assessment-trial framework. The branches are not merged or deployed.

**Private pilot verified (2026-10-27):** after separate owner approval of a US$0.10 cap, one real OpenRouter GPT-4.1 Nano request passed through native trial authentication and the gateway. Real administrator/trial OTP, targeted invitation, denied native admin access, streaming/function calling and settled accounting passed. The gateway recorded 84 input / 10 output tokens and US$0.000014 at its conservative configured rates; provider invoice cost was not independently captured. Admissions are paused after the check. [Pilot evidence](docs/verification/2026-10-27-local-pilot/checks.json) is an HTTP gateway smoke, not a fresh real-provider Electron/installer or cross-OS release gate. General paid benchmarks remain paused.

**Real desktop pilot verified (2026-10-28).** After restoring private configuration and receiving the owner-supplied key, the packaged Windows app completed real SMTP OTP → existing trial credit → OpenRouter coding task → reviewed approvals → 5/5 public checks → saved 9/9 hidden-check report → matching displayed credit deduction. The desktop credential was denied admin access. Six model requests across two student prompts cost 480 micro-USD at configured conservative rates; including the prior 14, total accounted spend is **US$0.000494 under the unchanged US$0.10 cap**. Nano initially omitted the import and proposed a pip upgrade, which was declined; a focused follow-up completed the fix. The program is paused, with zero reservations, active requests or pilot credentials. MongoDB independently verified the ledger; the provider key-wide usage delta is separate from per-generation billing. [Live evidence and screenshots](docs/verification/2026-10-28-real-desktop-trial/live-checks.json). The [initial blocked preflight](docs/verification/2026-10-28-real-desktop-trial/checks.json) remains historical evidence. This does not clear other platforms, downloaded-installer checks or human review.

**Next work (2026-11-04).** Contributor recognition and website GitHub-account linking are implemented on review branches in the base, frontend, and backend repositories; the staged plan is in §7 and [the contributor-recognition design](docs/contributor-recognition.md). Human review, OAuth app and webhook setup, and a deployment check remain before public release. This community work is separate from the unreleased 0.1/0.2 desktop and lab gates. The pilot path still requires the partner lab/date/server OS, Docker-sandboxed benchmarks, approved-budget model measurements, human review, Windows Docker, a real-LAN rehearsal, and a ten-machine dry run. The earlier 0.1 manual and review gates stay open.

**How releases map to the spec**
- Releases **0.1 → 1.0** deliver the spec's *v0* (solo and lab).
- **1.x** delivers *v1* (hosted).
- **2.0** delivers *v2* (hiring).

**Estimates assume one developer directing coding agents [A].** That means several agent sessions running in parallel worktrees, with the developer reviewing and merging their work. §2 explains what speeds up under that model and what doesn't.

**Already settled**
- **Licence:** Apache-2.0, provisional.
- **Code signing:** none.
- **Python:** already installed on lab machines.
- **Lab server:** a machine on the lab's LAN.

---

## 1. Strategy: what ships first, and why

1. **Our own harness is now the solo backend.** At the user's explicit request (2026-10-21), Factoryze replaces OpenCode in the app and installer. Existing provider credentials are reused; historical OpenCode usage stays readable. The early engine loop and local tools reuse the pane, approvals and metered gateway. Phase 4 still owns the full distributed harness, advanced tools, quality/parity gates and trial safety integration.
2. **Solo first, then lab.** The solo agent, tools, grading and records run locally. Optional sponsored funding uses a separate model gateway; it adds no desktop administration or lab server. Everything built for solo carries over to lab mode.
3. **The first lab pilot has no assessment trials.** Server-observed tokens/budgets and saved activity are implemented. Correctness requires the deferred isolated grader; efficiency comparisons require current measured baselines. Lab prompt judging is off and reports have no suggestions or prompt scores. Those limits must stay visible until the corresponding pilot gates pass.

   That already covers the original idea. Trials are the riskiest part, so they come after a real lab has proven the base.
4. **Trials come in two stages.**
   - **Stage I:** code faults and misleading context. These are safe, because nothing dangerous executes.
   - **Stage II:** supply-chain trials and prompt injection. These come only after our harness exists, because only the harness can guarantee an approved payload never runs.
5. **More agents come last.** Codex and Claude Code join once the conformance suite exists to protect them.

| Release | Name | For | Duration | Cumulative |
|---|---|---|---|---|
| — | Phase 0: foundations + spike | internal | 3–5 days | ~1 wk |
| **0.1** | Solo preview | public open-source preview | 2–3 wks | **~3–4 wks** |
| **0.2** | Lab pilot | one partner lab | 1.5–2.5 wks | **~5–6.5 wks** |
| 0.3 | Trials I | labs + solo | ~1 wk | ~6–7.5 wks |
| 0.4 | Full harness protocol and parity | labs + solo | 2–3 wks | ~8–10.5 wks |
| 0.5 | Trials II (supply chain) | labs + solo | 1–1.5 wks | ~9–12 wks |
| 0.6 | More agents | labs + solo | ~1 wk | ~10–13 wks |
| **1.0** | Semester-stable | any institution, self-hosted | ~1 wk | **~11–14 wks** |

These are original phase estimates, not remaining-work estimates or committed dates. The completed solo work and the early harness changed the rollout; manual release checks, model measurements and the pilot calendar now determine the schedule.

**The lab pilot date is set by the semester calendar, not by the code.** Book the partner lab and work backwards from it. If the date is fixed, keep 0.1 internal and go straight to 0.2.

---

## 2. Building with coding agents

### 2.1 What gets faster, and what doesn't

| Gets much faster (about 2–4×) | Barely gets faster |
|---|---|
| UI components: agent pane, approval cards, report view | **Testing on real machines** across 3 OSes: installers, Gatekeeper, SmartScreen, PowerShell, pairing with the LAN server |
| Gateway endpoints, metering, schemas, the CLI | **Integration quirks** in Theia packaging, ACP, OpenCode, Codex and Claude Code. Agents help, but someone has to watch the failures happen. |
| Tests, fixtures, conformance suites | **Model-driven loops**: benchmarks, prompt tuning and recording baselines all take wall-clock time and real tokens |
| Tree-sitter mutation operators, tool adapters | **Security review** of key handling, permissions and trial payloads, which needs a human sign-off |
| Docs and guides | **The pilot itself and the task content**, which are co-designed with the instructor |

That's why the timeline shrinks by roughly half, not by 4×. The right-hand column becomes the critical path.

### 2.2 How to work so agents don't break things

1. **Contracts come first.** `packages/protocol` (zod schemas) and `SPEC.md` are the source of truth. Agents implement against them and never invent formats.
2. **The repo has an `AGENTS.md`** that agents read in every session. It spells out:
   - the boundary between core and modules
   - the frozen contracts (§3)
   - "no secrets in the client"
   - the trial safety rules (spec §5.3)
   - the commands to run before calling something done
3. **Tests are the guardrail.** The release gates (§3.3) run before a PR merges: local tests on every change, and the GitHub workflows (`CI`, `Unsigned installers`) started by hand on GitHub. Since 2026-10-22 they no longer run automatically on push or pull requests, to save Actions minutes. Replay fixtures keep tests deterministic and free, so agents can run them constantly.
4. **Two parallel tracks in separate worktrees**, which only meet through contract tests:
   - **Client:** the app, pane and profiles.
   - **Engine:** the gateway, server and modules.
5. **Some changes always get human review and are never auto-merged:**
   - gateway authentication and key handling
   - permission logic
   - trials and supply-chain payloads
   - database migrations
   - any change to a frozen contract
6. **Small, vertical PRs.** One item from a phase per PR, each with its own tests.

---

## 3. Rules for not breaking anything

A contract can change freely **until it ships in a release**. After that, any change needs a compatibility path.

### 3.1 Versioned contracts

All of these live in `packages/protocol`.

| Contract | Rule |
|---|---|
| **Task pack schema** (`schema: 1`) | The engine reads all older schemas. `factoryze task migrate` upgrades a pack. |
| **Lab config schema** (`schema: 1`) | Same rule, with `factoryze config migrate`. Defaults never change within a major version. |
| **Event log** | Append-only. Event types are named `type@version` and are never repurposed. Readers ignore unknown types. |
| **Scoring** | Each report stores its `scoring_version`. Re-scoring an old log with its original version reproduces it exactly. A new formula is a new version, opted into per lab. |
| **Client ↔ server protocol** | A handshake on join. Server `X.Y` accepts clients `X.Y` and `X.(Y-1)`. An incompatible client gets a clear message. |
| **Harness protocol** (engine ↔ `factoryze-agent`) | Same handshake rule. |
| **Agent profile API, engine module API** | Semver, plus `apiVersion` on each plug-in. Unstable until 1.0, frozen at 1.0. |
| **ACP** | An external spec, pinned. Upgrades happen inside profiles, never in the core. |
| **Database** | Forward-only migrations, tested against a copy of the previous release's database. |
| **Baselines** | Keyed by `profile@version/model` and never overwritten. |

### 3.2 Behaviour changes

- **New capabilities ship disabled.** New modules and profiles are off by default, and the core keeps working with everything off.
- **Lab freeze.** Each lab or semester pins its app, server, profile and model versions. Lab-managed installs don't auto-update. Fixes go to a **semester branch**.
- **Release channels:** `nightly` → `beta` → `stable`. Labs only run `stable`. macOS updates are manual DMG downloads, because unsigned apps can't auto-update.
- **Deprecation.** Announce in one release; remove no sooner than two minor releases later, or at the next major.

### 3.3 Release gates

| Gate | What it proves | From |
|---|---|---|
| Unit + contract tests on Windows, macOS and Linux (CI matrix) | No regression on any OS | Phase 0 |
| **Replay tests.** The gateway's `replay` provider plays back recorded LLM traffic. | Gateway, metering, trials and scoring behave deterministically | Phase 0 |
| **Profile conformance suite.** Each profile must: launch, stream, call a tool, ask permission, route through the gateway, and stop at the budget. From 0.3, it must also apply a rewritten edit. | A profile update hasn't silently broken anything | 0.1 |
| **Re-score corpus.** Anonymised logs from earlier releases are re-scored. | Old reports reproduce exactly | 0.2 |
| **Installer smoke test** on all 3 OSes (replay provider): install → task → prompt → approve → submit → report | Packaging works | 0.1 |
| **Load test.** 60 simulated clients against a LAN-style server (replay provider). | The lab server holds up | 0.2 |
| **Trial-payload safety CI.** Each payload runs in a sandbox with no network except the engine (the container executor from Immediate plan 3a). | Spec §5.3 holds | 0.5 |
| **Nightly real-model benchmark.** Costs money, and blocks only harness releases. | Agent quality hasn't regressed | 0.4 |

---

## 4. Repository layout: implemented and planned

```
AGENTS.md          # rules every coding agent reads (§2.2)
LICENSE  NOTICE
packages/
  protocol/        # Zod contracts: tasks, draft lab config, usage, reports, tool inputs/events
  engine/          # solo engine, gateway, meter, SQLite, grader, tasks, harness, judge/scoring
  app/             # Theia Electron app
    extensions/core/ # current Home/workbench/agent/report/Settings and local tool executor
    scripts/        # packaging, installed smoke, bench:record and bench:variance
  server/          # lab HTTPS/identity, instructor CLI and synthetic 60-client load fixture
tasks/practice/    # 2 active tasks plus 2 retired tasks retained for history/grading
tasks/benchmark/   # experimental pack; promoted tasks now live in practice/
docs/verification/ # checked-in installed smoke receipts
```

`packages/server` and the root `pnpm factoryze` instructor CLI are implemented, with a 60-client synthetic functional load. A general installed CLI, separate profile/harness/module packages, full distributed handshakes and trial safety CI remain planned. The present judge/scoring functions and harness loop live inside the engine; they do not establish the full plug-in architecture. Current commands are the root `pnpm` scripts, not an installed `factoryze` CLI.

---

## 5. Phases

### Phase 0: Foundations and spike (3–5 days, internal)

**Status:** foundations are implemented; three-OS unit/typecheck and installer evidence is recorded under Phase 1. The original OpenCode spike scope below is historical and was superseded by the Factoryze-only solo backend on 2026-10-21. Downloaded-app Gatekeeper/SmartScreen checks remain Phase 1 manual gates.

**Goal:** remove the biggest unknowns and put the safety net in place.

**Repository and tooling**
- A monorepo using TypeScript and pnpm workspaces.
- A CI matrix covering Windows, macOS and Linux.
- `AGENTS.md` written.
- `packages/protocol` v1 drafted.
- A **replay provider** and a fixture recorder.

**Original spike checks (historical)**
1. **Branded Theia skeleton.** Built without Theia AI, producing **unsigned installers** on all 3 OSes.
   - On macOS, the ad-hoc-signed app opens after "Open Anyway" **and can launch its bundled OpenCode binary**.
   - On Windows, the SmartScreen "Run anyway" path works.
2. **ACP pane.** A minimal pane drives bundled OpenCode, streaming text and handling one permission approval.
3. **Gateway rewrite.** OpenCode's `baseURL` points at a stub gateway. The gateway meters the traffic and **rewrites one `edit` call**. Confirm that OpenCode applies the rewritten call and keeps it in its history. This is what 0.3 depends on.
4. **Shell on Windows.** Shell calls go through PowerShell.

**Original exit:** all 4 spike checks pass, or the plan changes. The backend plan changed; current conformance and release requirements are listed in Phase 1.

---

### Phase 1 → Release 0.1 "Solo preview" (2–3 weeks)

**Status:** original implementation and automated checks have recorded passes; the new report slice needs fresh platform verification. Release remains open for the manual checks and recorded review in the Immediate plan. Efficiency baselines for the active tasks are optional for 0.1 and have not been recorded.

**Goal:** someone installs the app, brings their own key, solves a practice task with a real agent, and gets a report on correctness, tokens, efficiency and prompt quality.

**In**
- **App**
  - Editor startup; task folders/ZIPs and bundled examples open in the current window.
  - Key stored in the OS keychain.
  - Home and Settings for the Factoryze agent's provider/model/key, feedback/scoring, default budget and appearance; per-task budget changes on the start sheet and in the attempt.
  - Retain saved provider credentials and normalize older saved settings to Factoryze. There is no OpenCode connection-import picker. Credentials remain backend-only and all calls retain metered gateway routing. OpenCode-only public models are unavailable; OpenRouter uses Chat Completions, including repaired legacy settings.
  - Toggleable panes, timer, separate input/output usage meters and the weighted budget meter. Each fresh task workspace starts at zero with its own budget; New session/restart retain that workspace’s usage. Cumulative history remains in reports.
  - **Python check:** detects the installed Python and checks it meets the task's minimum version, with clear guidance if it's missing.
  - Sets up the venv with `python -m venv` and pins pip to the engine's index.
- **Agent pane (in-process preview with ACP-shaped events)**
  - Streamed text and tool cards.
  - Approval cards with a unified before/after diff for edits.
  - Stop and New session.
- **Factoryze agent**
  - Built-in engine loop and local backend tools; no bundled OpenCode binary.
  - All calls use gateway `baseURL` and an ephemeral session token.
  - Diff approval for file changes, one-time shell approval, PowerShell on Windows and Bash elsewhere.
  - Legacy provider settings migrate to Factoryze; historical OpenCode usage/reports remain readable.
- **Engine, in-process**
  - Gateway with **OpenAI-compatible** and **Anthropic Messages** endpoints, passing streams through.
  - Weighted metering and a **per-profile budget**.
  - SQLite event store, task loader and local grader.
- **Modules**
  - **judge** (`score`).
  - **scoring**: correctness, efficiency and specificity (`scoring_version: 1`).
- **Report and benchmarking**
  - Report view.
  - `pnpm bench:record --profile factoryze` for recording baselines; `pnpm bench:variance` for repeated measurements. The general `factoryze bench` CLI remains planned.
- **Content:** Library fines and the reworked Monthly revenue report, each with green public tests on the buggy starter, nine hidden checks and expert/middle/naive scripts. The old pair remain bundled but retired. Active tasks have no efficiency baselines yet.
- **Added 2026-10-22:** per-check grader time limits, tests runnable with `python -m unittest`, and Windows and Linux runnability fixes (Immediate plan 1a, 1c, 1f).
- **Distribution**
  - Unsigned installers: a macOS DMG (ad-hoc signed), a Windows NSIS installer and a Linux AppImage.
  - A README with install steps covering "Open Anyway" and SmartScreen.

**Early harness preview (user-directed scope change, 2026-10-21):** Factoryze is the only app backend. Its engine loop and local tools (`read`, `list`, literal `grep`, exact `edit`, `write`, approved `shell`) stream through the existing pane and retain gateway accounting under `factoryze@0.1.0`. Existing API-key connections migrate without re-entry. The installer does not bundle or launch OpenCode. OpenCode's keyless public models are unavailable because their service rejects custom agents. This is an in-process solo seam, not the later distributed ACP/harness protocol. No title-generation or context-subtraction requests.

**Out:** lab mode, trials, full Phase 4 harness/parity work, integrity flags, other external profiles.

**Exit gates (recorded status, 2026-10-28)**
- [x] Installed smoke passes on Windows/Linux in CI and macOS from a local DMG; receipts are in `docs/verification/2026-10-23-platforms/`.
- [x] Factoryze conformance and replay tests pass; the recorded three-OS suite is 176 tests plus typecheck.
- [ ] Complete fresh three-OS verification of reports and trial credits. Windows now passes 207 tests, typecheck/build, NSIS/resources and installed smoke including cleanup; fresh macOS/Linux runs remain. See the [Windows audit](docs/verification/2026-10-28-windows-verification/checks.json) and Immediate 4/4a.
- [ ] Complete remaining real-provider/manual workflows: the sponsored Windows trial passes; remaining Windows BYOK/manual checks and Linux runs are still required. Retain the scope of historical macOS provider evidence in the release record.
- [ ] Verify downloaded-artifact Gatekeeper, SmartScreen and direct AppImage launch behavior.
- [ ] Record the required human review before release; the merge itself does not establish approval.

**Frozen when 0.1 ships:** task pack v1, event log v1, scoring v1. They remain draft contracts in this unreleased preview.

---

**Update 2026-10-22:** the solo UI follows the approved flow in `mockups/flows.html`: Home on launch (Continue, Practice tasks, Results), a start sheet, the attempt workbench with a per-prompt budget meter, approval cards, reports with every submission, and Settings. Lab mode (0.2) reuses the same Home/attempt split: Home becomes Join lab.

<a id="immediate-plan-added-2026-10-22-status-updated-2026-10-24"></a>

<a id="immediate-plan-added-2026-10-22-status-updated-2026-10-24"></a>
<a id="immediate-plan-added-2026-10-22-status-updated-2026-10-27"></a>

<a id="immediate-plan-added-2026-10-22-status-updated-2026-10-28"></a>

### Immediate plan (added 2026-10-22; re-sequenced 2026-10-31)

This is the active work queue, re-sequenced on 2026-10-31 after Phase 2's software merged into `main` and a graded lab passed end to end on macOS. The code the pilot needs is largely done; the critical path is now owner decisions, approved measurements and real-machine checks. Completed implementation stays documented below; only unchecked gates and pending items remain to do.

**Pilot path to release 0.2**

| Step | Work | Owner | Depends on | Status |
|---|---|---|---|---|
| 1 | Book the partner lab, pilot date and server/student OS; bring in the partner instructor | Owner | — | Open |
| 2 | Add `bench:variance --sandbox docker` on the shared container executor (3a) | Developer | — | Open |
| 3 | Approve a measurement budget and limit; choose one inexpensive and one frontier model | Owner | — | Open |
| 4 | Rerun expert, middle and naive scripts on Library fines, Monthly revenue and Activity feed; record guarded baselines (1b, 3a, 3b) | Developer | 2, 3 | Open |
| 5 | Finish Windows virtualization, WSL 2 and Docker Desktop; pass `pnpm docker:check` | Owner, then developer | — | Open |
| 6 | Co-design and measure the graded pilot task (Activity feed is a candidate) | Owner and instructor, developer | 1, 4 | Open |
| 7 | Record human review: draft contracts (including the attempt-summary `lab` field), keys, permissions and the lab protocol | Owner | — | Open |
| 8 | Two-machine rehearsal on a real LAN, then the ten-machine dry run on lab hardware | Owner and lab IT, developer | 1 | Two-machine rehearsal passed 2026-11-01 ([record](docs/verification/2026-11-01-two-machine-lab/README.md)); ten-machine dry run open |
| 9 | Configure the lab server's model provider with a spending cap, so students have the agent | Owner (key), developer | 3 | Open |
| 10 | Run the pilot; the instructor accepts the CSV | Owner and instructor | 1–9 | Open |
| 11 | Seed the re-score corpus from pilot logs; tag 0.2 | Developer | 10 | Open |

**Decision after step 4.** If expert prompts stay clearly cheaper than vague ones on the frontier model, keep token efficiency in reports and pin the measured settings for the pilot. If the gap mostly closes, prioritise harder task design and Trials I (0.3) over further harness work; see *Harness improvement track*.

**Done since 2026-10-29:** a two-machine lab over a real network (Mac server, Windows student, real model, 9/9 graded and released; findings in [ISSUES.md](ISSUES.md)); real Docker checks on macOS and Ubuntu; Phase 2 merged into `main`; end-to-end graded lab on macOS; lab attempts kept out of practice task rows and Start; the latest macOS DMG built and passing `verify:package`.

**Parked until after the pilot:** deploying the trial-credit gateway and website, the Windows shell decision (1f), and code-performance checks (SPEC §8 footnote).

**Not now (decided 2026-10-22):** no Claude model benchmark run. Anthropic prompt caching therefore stays an unconfirmed Step 2 candidate.

**Spending rule (2026-10-22):** all paid model calls, live spikes and benchmarks are paused unless the user explicitly approves them with an agreed spending limit. Routine implementation uses deterministic tests and synthetic providers.

**Workstreams.** Status of the original items; the pilot path above sets the order.

| # | Work | Status | Remaining action / dependency |
|---|---|---|---|
| 1 | Finish release 0.1 (Phase 1) | Current Windows automated gates pass; unreleased | Fresh macOS/Linux gates, remaining BYOK/manual provider and downloaded-installer checks, recorded human review and reviewed release artifacts |
| 2 | Harness Step 1 | 2a–2c implemented and automatically verified | Record review of report pins and connection UI with the 0.1 review; lab temperature pinning remains Phase 2 |
| 3 | Finish harness Step 0 | 3a grading slice passes real Docker checks on macOS and Ubuntu; 3b deterministic content implemented | Sandboxed benchmarks (pilot step 2), then approved measurements and baselines (step 4); Activity feed promotion only if it passes the gate |
| 4 | Report design and analysis | Approved design implemented; Windows verification passes | Saved activity/usage and prompt costs, per-check segments, details modal, stable layout; no report suggestions or prompt scores. Fresh macOS/Linux verification and review of the additive draft report contract remain |
| 4a | Desktop trial-credit connection (requested 2026-10-27) | Implemented; real-provider Windows flow verified; other platform/review gates open | [Live evidence](docs/verification/2026-10-28-real-desktop-trial/live-checks.json) supplements the earlier synthetic checks. Complete fresh macOS/Linux/manual checks and human review before merge; deploy/configure the service before public use |
| 5 | Lab mode (Phase 2) | Software merged into `main`; graded lab passes end to end on macOS | Pilot steps 1 and 5–11: booking, Windows Docker, review, real-LAN and ten-machine checks, lab provider, pilot and CSV acceptance |

#### 1. Finish release 0.1 (Phase 1): manual gates and review remain

**1a. Per-check time limits in the grader — complete.**
- **Original problem.** A shared Python process and one 30-second limit could prevent Submit from saving a report after a slow check or infinite loop.
- **Implemented.** Discovery and each check run in separate Python processes. Each process has a 10-second limit; discovery/check execution shares a 120-second cap. Timeouts are named failed results, other checks continue while time remains, and Submit saves the report. Process-tree cleanup works on Windows through `taskkill /T /F` and on POSIX through process groups.
- **Contracts.** A timeout is a failed check with a message, which `hiddenCheckSchema` (name, passed, message) and the public `failures` list already allow. No schema change.
- **Tests first.** An infinite loop in a hidden check and in a public test: the report is still saved, the other checks pass, and the timed-out check fails under its name. CI runs this on all three OSes.
- **Carries over** to the Phase 2 Docker grader and to performance checks later (SPEC §8 footnote), which reuse the same limit.

**Verification status (2026-10-24):** merged through PR #2 at `6b0f75a`. Six regressions cover hidden/public loops, the run cap, import failures/process exits, child-process cleanup and report persistence. They are included in the recorded 176-test/typecheck pass on all three OSes. All three installed flows also pass; manual release checks remain open. See [release evidence](docs/phase-1.md#release-evidence).

**1b. Replace the bundled practice tasks — implementation complete; measurements/baselines remain.**
- **Why.** On both original tasks (`dedupe-ids`, `pagination-api`), naive prompts were reliably cheaper than expert ones, so their efficiency comparison taught the wrong lesson.
- **Implemented bundled pack:** `library-fines` and reworked `monthly-revenue`. The rework removes the failing public report test, keeps the passing checks, and puts the symptom only in the brief. Clean reruns on both benchmark models remain under item 3; the original 2026-10-22 tables describe the earlier task/grader.
- **Retirement implemented:** `dedupe-ids` and `pagination-api` retain their bundled source/hidden checks with `retired: true`, stay out of Practice tasks, and remain resumable/submittable through Continue and Results. The additive draft-schema field still needs recorded review before release.
- **Completed integration updates:** the catalog and resource/package checks now distinguish active and retired tasks; the installed smoke starts the promoted pack and resumes/resubmits both retired tasks; README, INSTALL and §7 describe the new pair.
- **Baselines pending.** Active tasks need no OpenCode baselines. Factoryze baselines are optional for 0.1: reports score efficiency only when a matching baseline exists. The version guard (2a) is complete; new baseline recording still requires spending approval and an agreed limit.
- **Location complete.** Promoted tasks now live in `tasks/practice/`; `tasks/benchmark/` is reserved for unpromoted tasks.

**Status (2026-10-24):** both tasks are bundled in `tasks/practice/`; Monthly revenue has two green public checks and Library fines has five on their buggy starters. The old pair have `retired: true`; history lookups include them, including pre-snapshot registry entries. The three-OS smoke verifies retained usage/reports and retired resubmission, and solves Library fines (9/9 hidden). Required review of the additive `retired` field must be recorded before release. The reworked Monthly revenue DeepSeek batch includes incomplete/failed samples; the Gemini rerun was stopped because of cost. Neither active task has a Factoryze efficiency baseline. Complete measurement work under 3 after explicit spending approval; the 2a version guard is already in place.

**1c. Make tests runnable by the agent — complete.**
- **Original problem.** Task venvs have no pytest, and agents wasted steps trying it in the DeepSeek benchmarks.
- **Decision: standardise on the standard library.** Public tests run with `python -m unittest` (through a `load_tests` hook, as both new tasks already do), and each task's README says so. It works offline, on every OS, with nothing to install. Adding pytest waits for Phase 5's package index proxy, which owns which packages a venv can get.
- If agents still reach for pytest after this, that's the evidence for the Step 2 environment line.

**Verification:** both task READMEs document `python -m unittest`; the recorded three-OS smoke runs public tests through the agent's native shell.

**1d. Housekeeping — complete.**
- `spikes/factoryze-harness.mjs` uses `ModelSettingsStore.forEngine()` for `--existing` and offers credential-free `--help`.
- AGENTS.md identifies Phase 1 finishing and points to the Immediate plan.
- `.gitattributes` keeps task files and dependency patches in LF across OSes.

**Verification:** deterministic housekeeping regressions are included in the recorded platform suite. The original red/green work is retained in PROGRESS; no live spike was run for this reconciliation.

**1e. Platform release gates — automated complete; manual checks open.**
- [x] The continuation branch `codex/grader-check-timeouts` is merged in local `main` through PR #2 (`6b0f75a`, 2026-10-23). Earlier references to a draft PR #1 are historical. Live PR state and human review records were not available during this reconciliation.
- [x] `ci.yml` and `installers.yml` run only when dispatched by hand. They cover the three-OS tests/typecheck and installer builds/resource checks. The installer workflow accepts a platform filter and uploads smoke evidence; Linux uses Xvfb and an isolated keyring.
- [x] The installed flow uses the promoted tasks and preserves retired attempts.
  - *Done 2026-10-23:* the installed smoke passes on Windows and Linux ([run 39826255212](https://github.com/33sakib33/Factoryze/actions/runs/39826255212)) and on macOS from a local DMG. The last Windows failures were a stale pane-toggle state after reloads (a product fix), a one-shot toolbar check during title-bar layout, and a PowerShell-only command typed into Windows' Command Prompt terminal (both test fixes). Manual real-provider runs on Windows and Linux remain.
- [ ] **Real-provider task runs:** a person on Windows and on Linux starts a task, prompts with their own key, approves a change and submits. These runs remain required. Historical macOS provider evidence is scoped in [the release record](docs/phase-1.md#release-evidence); synthetic smoke does not prove provider accounting.
- [ ] **Downloaded installers:** record Gatekeeper, SmartScreen and direct AppImage launch checks on real desktop sessions.
- [ ] **Human review:** record review of schema 6/7, task imports/retirement, keys, permissions, scoring, report pins and connection temperature UI. Do not infer review from the merge commit.
- [ ] **Release preparation:** select the reviewed artifact/version and record the contract freeze when 0.1 ships. The desktop package is still `0.0.1`; the harness identifier `factoryze@0.1.0` is not a desktop release tag.

**1f. Windows and Linux runnability — setup fixes complete; shell usability decision open.**
- **The agent's shell on Windows.** Commands run in `powershell.exe` (Windows PowerShell 5.1), which has no `&&` or `||` and no `tail` or `head`. Models mostly write bash (for example `cd . && python -m unittest 2>&1 | tail -20` in our benchmarks), so on Windows these commands fail, waste steps and inflate token counts.
  - Options: prefer `pwsh` (PowerShell 7, which supports `&&`) when it's installed; tell the agent which shell it has (the Step 2 environment line, with a harness version bump). Measure with a Windows benchmark run before choosing.
  - Until this is fixed, compare students only within one OS. Labs are usually uniform; the OS is recorded with the pin (2b).
  - *Open decision (2026-10-23):* the integrated terminal on Windows is Theia's Command Prompt (`cmd.exe`) profile, while the agent's shell is PowerShell. Students copying a command from an approval card into the terminal can hit syntax differences. Making PowerShell the Windows terminal default would match the agent and VS Code.
- **Python setup — complete.** The start-sheet check and setup both verify the minimum version and import `venv`/`ensurepip`. Missing Debian/Ubuntu support gets the matching venv-package command. Windows launcher/Store-alias diagnostics and partial-setup cleanup are implemented.
- **Linux keychain guidance — complete.** Secret Service failures explain how to unlock a keyring and use the backend environment fallback. Replacing keytar remains deferred key-handling work requiring human review.
- **Line endings.** On Windows, git may check out task files with CRLF. That changes file bytes, so token counts and baselines differ by OS, and exact-match edits can fail. The `.gitattributes` from 1d keeps tasks in LF everywhere, and installers are built from LF files.
- **Time zones in tasks.** Tasks avoid the IANA time-zone database, because `zoneinfo` needs the `tzdata` package on Windows; `library-fines` uses fixed UTC offsets for this reason. New tasks follow the same rule.
- **Benchmark tooling — native command recognition complete; sandbox pending.** The approval helper accepts Windows test commands, including `.venv\Scripts\python.exe`, with regression coverage. The broader approval distortion still requires 3a. `--sandbox docker` is planned and is not accepted by today's CLI. Run benchmark processes one at a time; historical parallel runs failed at the macOS keychain.

**Status (2026-10-24):** setup fixes, maintained Electron rebuild tooling, native path handling and toolbar/pane repairs are merged. Recorded verification is 176 tests/typecheck on all three OSes and complete installed smoke receipts. Manual provider/downloaded-installer checks and review remain open. Windows still uses PowerShell 5.1 for agent commands and Command Prompt for the integrated terminal. Measure model shell compatibility before changing harness behavior; the terminal-default decision is still open. No live measurements or shell preference change were made by this documentation update.

**Done when** the Phase 1 exit gates pass with the new bundled tasks: the installed smoke test and a real-provider run on all three OSes, conformance and replay tests.

#### 2. Harness Step 1: complete for solo; review record remains

- [x] **2a. Version guard:** fingerprints instructions, canonical tool definitions and execution limits against `factoryze@0.1.0`; behavior changes require a version bump. Implemented before recording new baselines.
- [x] **2b. Report pins:** optional `executionPins` snapshot each distinct recorded harness/model/provider-host/temperature/OS configuration. Older reports remain valid without invented metadata.
- [x] **2c. Solo temperature:** optional saved connection/backend setting, sent only when configured. Recognized provider refusals get safe guidance without retry. Lab configuration pinning is still Phase 2 work.

**Status (2026-10-24):** implemented and included in the recorded three-OS unit/typecheck and installed smoke passes. The receipts verify report pins and temperature on every model step. Existing fingerprint entries must not be overwritten; null temperature means an unknown provider default. Required review of the additive contracts and connection UI must be recorded as part of 1e. No new baselines or paid calls were made.

#### 3. Finish harness Step 0: grading verified; sandboxed benchmarks next

- [ ] **3a. Resumed by the owner, 2026-10-29 — shared Docker execution/grading implemented; real validation passes on macOS and Ubuntu; benchmark integration is pilot step 2.** The new bounded executor and opt-in lab grader have deterministic tests. Real Docker checks pass on macOS/arm64 (2026-10-29, [audit](docs/verification/2026-10-29-macos-docker-grading/checks.json)) after enabling Docker Desktop's builtin seccomp profile. The Ubuntu workflow passes too; a full graded lab passes end to end on macOS ([audit](docs/verification/2026-10-29-macos-lab-e2e/README.md)). Windows Docker is blocked by local firmware/setup. `bench:variance --sandbox docker` and persistent agent/container integration remain unimplemented; the target bullets below still apply. No paid benchmark was run.
  - Each run gets a disposable Linux container (a Python 3.11 image): only that run's workspace is mounted, with no network, CPU, memory and process limits, and a non-root user. It's deleted after the run.
  - The engine, the metered gateway and the API key stay on the host. The agent's shell commands and the grading run in the container through `docker exec`. Every command is approved, and still logged. The Python environment is created inside the container, because a macOS or Windows venv can't run on Linux.
  - **Cross-platform.** Docker Engine on Linux; Docker Desktop (WSL2 backend, Linux containers) on Windows and macOS. Host paths are converted for the mount on Windows. A Linux CI job runs the sandbox path with the replay provider, so it keeps working.
  - **Build it once, as a shared container executor in the engine.** Phase 2's Docker grader and §3.3's trial-payload safety CI (0.5) reuse it instead of building their own.
  - **Then, after spending approval,** rerun DeepSeek on the reworked `monthly-revenue` and on `library-fines`, and finish the reworked Monthly revenue Gemini measurements. Historical Gemini runs had no rejected-command distortion, but the original Monthly revenue results do not describe today's task/grader. Record guarded efficiency baselines separately; variance results do not create them.
- [ ] **3b. One more task built like `library-fines`** (the second of Step 0 item 3): deterministic content implemented 2026-10-28; measurement/promotion pending.
  - Several modules, with the symptom only in the brief and public tests green on the buggy starter.
  - A different bug class from the SPEC §6 guidelines, for example an N+1 query, an unbounded cache or the wrong data structure.
  - No IANA time zones, runnable with `python -m unittest`, LF line endings.
  - [x] **Content implemented without paid calls:** `tasks/benchmark/activity-feed` has a multi-module SQLite starter with an N+1 member lookup, symptom-only brief, six green public checks, twelve hidden checks, a private reference and expert/middle/naive scripts. Starter: 8/12 hidden; reference: 12/12. Actual SQL reads for 100 entries fall from 101 to 2; 901 distinct authors use four reads after the fix. Import/privacy and four incorrect-solution mutations are covered by the engine tests. [Task notes](tasks/benchmark/activity-feed/README.md), [audit](docs/verification/2026-10-28-activity-feed/checks.json).
  - **Later:** benchmark it on both models with approved spend and reliable approval conditions, and promote it only if it passes the gate. Sandbox-dependent measurements stay deferred with 3a.
- **Not now:** a Claude model run (decided 2026-10-22), so Anthropic caching stays unconfirmed. A Gemini run with reasoning on is optional, when it becomes useful.

#### 4. Reports that teach: implemented locally; verify and review before release

- [x] Save optional `insights` with each new submission: prompt costs/states, attempted exploration/edit/command counts, failed/unfinished actions, approvals, request groups and coverage. Later prompts, corrections and submissions do not rewrite that snapshot.
- [x] Use existing ordered tool/request/permission events and the current usage ledger, including reconciled counts and recorded cache weights. No new event type or database migration.
- [x] Show fresh input, cache reads/writes and output separately. Group measured model-request weighted tokens by preceding exploration, edits, commands, mixed activity or prompt start; unknown activity remains unattributed. These are request groups, **not exact per-tool or context costs**; the ledger cannot separate history from other input.
- [x] Implement the approved report design in the actual app: prominent result with one segment per check, failed-check reasons in a modal, explained summary metrics and activity/token analysis first. Keep pass/fail card dimensions stable and adapt to narrow app panes. Remove report suggestions, prompt grading and aggregate score text, including for saved scored reports. Existing optional backend judge/scoring records and Home results remain compatible; the Settings label now says “Score in results.” No new model calls or harness/baseline changes.
- [x] Keep old reports readable: missing activity/costs/check details stay unknown rather than using live attempt data or inventing per-check outcomes. The app and [self-contained HTML preview](mockups/report.html) now share the production result, summary, activity and prompt renderers and CSS. [App implementation audit](PROGRESS.md#2026-10-24--approved-report-design-in-the-app).
- [ ] Finish fresh macOS/Linux tests/typecheck/build/installed smoke and record human review of the additive draft report contract. Windows now passes 207/207 tests with no skips, typecheck/build, NSIS/resources and complete installed smoke including cleanup. The smoke asserts the approved report design and saved earlier prompt costs. [Current Windows audit](docs/verification/2026-10-28-windows-verification/checks.json); older failed receipts remain historical.

#### 5. Phase 2 lab mode: software merged; pilot gates remain

- [x] Independent `packages/server` in the existing repository, sharing engine/protocol code; pinned TLS initialization and a Node client; local instructor credential and restricted control endpoints.
- [x] Instructor create/watch/close/usage CSV; roster-bound joins, immutable lab settings and deadline; persistent per-student accounts/tokens and an internal trusted metering seam. Ten new checks cover contracts, engine behavior and real HTTPS/CLI; full Windows suite is 217/217 with no skips. [Audit](docs/verification/2026-10-29-lab-foundation/checks.json).
- [x] Desktop Join lab/keychain reconnect, public task delivery, separate attempts and server-loop/client-tool approvals (non-Docker checkpoint `9f141b9`).
- [x] Workspace mirrors/offline flags, draft protocol checks, immutable snapshots, private queue and report/release/CSV integration. Docker grading code is now opt-in; real container checks pass on macOS/arm64 and Ubuntu, and a real desktop submission is graded, released and exported on macOS; Windows validation is pending.
- [x] Instructor recovery/revocation/reconciliation and the 60-client synthetic functional load.
- [ ] Current task measurements, actual-LAN/real-machine dry run and accepted pilot. Lab/date and server/student OS remain unarranged.

- The owner authorized foundation work before pilot selection. The lab/date/server OS and the prerequisites below are still required before classroom deployment.
- It inherits from this plan:
  - per-check grader limits (1a);
  - the deferred container executor before shipping server-side grading (3a);
  - the version pin and temperature setting for lab config (2b, 2c);
  - pilot tasks built like `library-fines`.
- The "Which OS runs on the server machine?" decision now also decides where Docker runs; any of the three OSes works (3a).

### Harness improvement track (added 2026-10-22, revised)

**Verdict: the harness mostly doesn't need changing yet. Measure properly first, then change only what the measurements show matters.** On a well-designed task the current harness already separated expert, middle and naive prompts cleanly, with noise small next to the gaps ([prompt specificity benchmark](docs/benchmarks/2026-10-22-prompt-specificity/README.md)). The old tasks failed, not the harness. The biggest flaw in that data was the benchmark script's unattended approval rule, not the harness.

**Step 0: measurement work — partly complete; sandbox deferred by the user, clean reruns still required before 0.2.** Work on deterministic task content now. Original estimate: about 2 days plus paid model calls; any new spend needs explicit approval and a limit.
1. **Remove the approval distortion.** Run benchmarks in a container that approves every command, as a student would.
   - *Deferred (2026-10-24).* Gemini asked for no commands the rule rejects, so that historical batch avoided this distortion; DeepSeek's middle and naive runs are inflated. Immediate 3a remains the proposed remedy, paused by the user. Do not silently treat restricted-approval runs as clean evidence.
2. **Test on one or two stronger models,** for example a Claude model (which also shows whether prompt caching happens) and a GPT model. This is the most important check: if strong models make vague prompts cheap, the gap collapses because of model progress, and no honest harness change fixes that.
   - *Partly done (2026-10-22):* `google/gemini-4-argon`, reasoning off. The gap narrowed to 2.6× on `monthly-revenue`, where a failing public test reveals the bug, but held at 4.5× on `library-fines`, where the tests stay green. Not now: a Claude model run (decided 2026-10-22), so the caching check waits. A run with reasoning on is optional.
3. **Build two more tasks like `monthly-revenue`** (symptom and cause in different files, several modules). The pilot needs them anyway.
   - *Both content drafts implemented (2026-10-28):* bundled `library-fines` and experimental `activity-feed` (Immediate 3b). Both keep public tests green on their buggy starters and symptoms in the brief. Activity feed still needs model measurements and promotion review; deterministic checks do not establish prompt-skill separation.

The results decide what goes into Step 2.

**Step 1: complete for solo (Immediate 2a–2c); record the required review before release.**
4. **Done — version guard.** Instructions, canonical tool definitions and limits are fingerprinted against the harness version.
5. **Done — report pins.** Recorded harness version, model, provider host, temperature and OS are saved without backfilling old reports.
6. **Done — solo connection temperature.** Unset by default, sent only when configured, with safe provider-refusal guidance. Lab temperature pinning remains Phase 2 work.

**Step 2: conditional, not started.** Fix only what Step 0 shows, in one version bump (original estimate: about 2–3 days; before 0.2 if needed). Candidates:
- **Anthropic prompt caching** (no `cache_control` markers are sent today), if the pilot or many solo users are on Claude. Inside a lab students share one pinned model, so this isn't unfair within a lab, but solo Claude users burn the same budget several times faster. Confirm with a live run first; that run is deferred (no Claude run for now, 2026-10-22), so this stays unconfirmed.
- **Head-and-tail truncation** of tool output (today the first 16,000 characters are kept; SPEC §3.4 promises head and tail, and test failures print at the end).
- **A graceful step limit** that asks the model to summarise near the 16-step cap and keeps the turn's history, instead of throwing.
- **An environment line in the instructions** (the test command), only if wasted steps remain after Step 0. Fixing it in the task's README comes first. It's more likely to be needed on Windows, where the agent's shell is Windows PowerShell 5.1 (no `&&`, `tail` or `head`; Immediate plan 1f).

Any candidates justified by the measurements go through the gate together and ship as `factoryze@0.2.0` with new baselines. The current harness remains `factoryze@0.1.0`.

**Step 3: reports that teach — implemented locally ahead of measurement work; platform verification/review remain (Immediate 4).**
7. **Observed activity and request usage:** saved model-request groups, raw token counts and per-prompt costs in the approved app design. Report suggestions and prompt scores were removed at the user's request. Grouping a request after exploration does not prove exploration caused every token; context and tool execution are not separately metered. No backend scoring or harness change.

**Deferred to Phase 4, only with evidence from the gate:** line-range `read`, `glob`, regex `grep` and compaction. These are realism and parity work; each changes token counts, and each must show it doesn't shrink the gap between specific and vague prompts.

**Don't:** inject the brief into the agent's context, add an automatic repository map or planning sub-agents, or make the agent budget-aware. Each makes vague prompts cheaper or hides the student's skill.

**The real risk is stronger models, not the harness.** If a frontier model handles "the report is wrong" almost as cheaply as a precise prompt, the answer is task design (larger surfaces, requirements only the student knows), not handicapping the agent. Step 0 item 2 answers this before any harness work. First evidence (2026-10-22, two models): the gap narrows on tasks whose tests reveal the bug and holds on tasks whose tests don't.

**Review.** Changes to tool definitions or report fields alter `packages/protocol` contracts and need human review (AGENTS.md).

---

<a id="phase-2"></a>

### Phase 2 → Release 0.2 "Lab pilot" (1.5–2.5 weeks, plus the pilot date)

**Status (2026-10-31):** the software is merged into `main`. Non-Docker workflow and Windows checks completed at `9f141b9`. Opt-in Docker grading passes real-container checks on macOS and Ubuntu, and a real desktop lab submission was graded, released, reported and exported on macOS ([audit](docs/verification/2026-10-29-macos-lab-e2e/README.md)). Default grading remains off until an operator enables it. Windows Docker, lab/date, real-machine/LAN validation, measurements, pilot and human review remain open; the *Immediate plan* pilot path orders them. [Setup/status](docs/docker-grading.md).

**Goal:** one real lab session. Students join with a code and never see a key. The instructor gets a CSV.

**Delivery checklist (2026-10-31)**
- [x] LAN HTTPS/pinning, instructor CLI, roster/session/budget lifecycle and closure.
- [x] Desktop Join lab/keychain persistence, public task delivery and server agent with approved local tools.
- [x] Revisioned mirrors, offline queues, immutable submissions, close snapshots and retry/recovery checks.
- [x] Instructor reset/reconciliation, untrusted integrity flags, private grade queue and report-release/CSV integration.
- [x] 60-client synthetic functional load and native Windows development-app flow.
- [x] Final Windows build, NSIS/resources, installed solo+lab flows and uninstall cleanup; 226 tests/typecheck pass.
- [ ] Real isolated grading validation — implementation is opt-in. Real container checks pass on macOS/arm64 and Ubuntu/amd64, and a real desktop lab submission was graded, released and exported on macOS ([audit](docs/verification/2026-10-29-macos-lab-e2e/README.md)). Windows Docker remains blocked; default production submissions stay queued until an operator enables grading.
- [ ] Current macOS/Linux checks, actual LAN and ten-machine dry run, instructor task validation/measurements.
- [ ] Real pilot/date, accepted CSV, pilot re-score corpus and recorded human review.

**In**
- **`factoryze-server` on a lab LAN machine**
  - Hosts the same engine, plus Docker for grading, using the container executor built for sandboxed benchmarks (Immediate plan 3a) and per-check time limits (1a).
  - Generates a **self-signed TLS** certificate on first run and prints its fingerprint.
  - `factoryze server init` writes the **client config file** that IT deploys with the app: server address and pinned fingerprint.
  - Only the server needs internet access, to reach the LLM provider and fill the package cache. Student machines only need the LAN.
- **Client lab mode**
  - A join screen.
  - A gateway connection over the LAN.
  - **Workspace mirror** sync.
  - Offline event buffering.
  - A version handshake with the server.
- **Joining and grading**
  - A join code gives the student a session token.
  - When the lab closes, everyone is auto-submitted and the Docker grader runs, queued.
- **Instructor CLI**
  - `factoryze lab create`
  - `factoryze lab watch` (a live table in the terminal)
  - `factoryze lab close`
  - `factoryze lab export` (CSV)
  - `factoryze lab release`
- **Measurement consistency (Factoryze harness, added 2026-10-22).** Graded results must not depend on the agent's luck. See SPEC §3.4.
  - **Harness Steps 0–3** (measure on stronger models without the approval distortion; version guard, recorded pin and temperature setting; fixes the measurements justify; cost breakdown): see *Harness improvement track* above.
  - **Randomness:** temperature 0, with the model and provider pinned in lab config. The solo app accepts an optional connection temperature (Immediate plan 2c); lab configuration still belongs to Phase 2. Some provider variation remains even at 0.
  - **Exploration policy:** a stable file listing order, bounded reads, and possibly search before read, so a specific prompt ("fix the off-by-one in `app/pagination.py`") costs one read and a vague one ("fix the bug") costs a search, every time.
  - **Stable inputs:** no timestamps or random IDs in the agent's context, and a fixed tool order, so runs repeat and provider caching stays steady (cached input is weighted at 0.1).
  - **Version pinning:** reports record the harness version, model, provider, temperature and OS, and the CSV compares students only within one pin.
  - **Report explanation:** retain saved raw token counts and measured request groups from Immediate 4; do not claim separate context/tool token meters. Lab integration now retains these facts; correctness remains queued until isolated grading is available.
- **integrity** (light): flags for pastes and focus loss.
- **Lab config v1**, with the **lab freeze**: pinned versions and no auto-update.
- **Docs:** an IT guide for setting up the lab server and deploying the app.
- **Content and dry run**
  - One graded pilot task, built with the partner instructor.
  - A **dry run on 10 or more lab machines** before the real session.

**Out:** trials, the full Phase 4 harness (distributed protocol, parity gate), other profiles, a graphical admin. The early in-process harness is already the backend.

**Exit gates**
- Before the pilot: replaying each pilot task's scripted expert and naive prompts about 10 times with the pinned settings shows the two clearly separated, with small spread within each.
  - **Historical evidence, reconciled 2026-10-24** ([results and limits](docs/benchmarks/2026-10-22-prompt-specificity/README.md)), two models (`deepseek/deepseek-v4.1-flash-1017`, `google/gemini-4-argon`):
    - **Failed** on the original tasks, `dedupe-ids` and `pagination-api`, where naive prompts were reliably *cheaper* (DeepSeek). Those tasks are now retired.
    - **Encouraging separation** on the original `monthly-revenue` (naive ÷ expert median 11.4× on DeepSeek, 2.6× on Gemini) and `library-fines` (4.7× and 4.5×). Expert runs cost less than middle runs in those datasets. These runs predate the current per-check grader; Monthly revenue was also reworked. They do not clear the current pilot-task gate. Clean reruns, current-task baselines and pilot validation remain pending.
    - Middle against naive overlaps on every task and model, so grade single attempts in coarse bands.
    - Pilot tasks must be built like `library-fines`: several modules, symptom and cause in different files, public tests green on the buggy starter, symptom only in the brief.
- **Passed:** 60-client functional single-host load with synthetic inference, TLS, approved local read tools, separate metering and 60 snapshots. This does not establish real-provider capacity or a ten-machine LAN dry run.
- **Pending:** dry run on at least ten real lab machines, including chosen OS/actual LAN.
- **Pending:** real pilot and instructor CSV acceptance; lab/date are not arranged.
- **Pending:** re-score corpus seeded with real pilot logs.

**Freeze at release:** client ↔ server protocol v1 and lab config v1 remain additive drafts until the pilot/release gates pass.

**Decide before 0.2:**
- Which lab runs the pilot, and on what date?
- Which OS runs on the server machine?

---

### Phase 3 → Release 0.3 "Trials I" (about 1 week)

**Status:** planned; no product trial framework or trial scoring is implemented. The existing deterministic gateway edit-rewrite seam is foundation work only.

**Goal:** measure verification safely. Nothing dangerous ever executes.

**In**
- **Trials framework**
  - The `onModelResponse` hook plus the workspace mirror.
  - Each trial fires once.
  - Trials are revealed only after the lab closes.
  - Definitions never reach the client.
- **`mutate`:** 4–6 tree-sitter operators for Python:
  - a boundary flip
  - removing a `None` guard
  - swapping arguments
  - SQL built with string formatting instead of parameters
- **`misleading_context`:** hidden checks catch students who follow the planted advice.
- **Factoryze trial integration.** The conformance suite gains a test that a known trial fires, its rewritten edit is applied, and the rewritten call stays in the agent's history. External-profile adapters remain later integration work.
- **Verification scoring.** Trial outcomes feed a **verification** layer under `scoring_version: 2`. Labs opt in, and existing reports stay on v1.
- **Judge `block` mode,** for practice labs.
- **Content:** trials added to the practice pack and the pilot task.

**Exit gates**
- Replay tests show each trial fires deterministically.
- The 0.2 scores reproduce exactly under scoring v1.

---

### Phase 4 → Release 0.4 "Full harness protocol and parity" (2–3 weeks)

**Goal:** graduate the early solo harness preview into the full reference profile, proven against OpenCode. The preview does not satisfy this phase's parity, distributed protocol or trial gates.

**Status:** the solo loop, basic local tools, approvals, output limits, history guard and version/pin safeguards already exist. Separate agent hands/ACP shim, remote handshake, advanced tools/context, trial dispatch controls and parity/nightly gates remain planned. OpenCode is a future comparison integration, not a currently bundled backend.

**In**
- **Extend the existing harness brain in the engine:**
  - preserve the implemented loop and output caps
  - add caching/compaction and advanced context behavior only where measurements justify them
  - complete distributed permission rules
  - `todo`
- **`factoryze-agent`:** the hands (`read`, `glob`, `grep`, `edit`, `write`, and `shell` using PowerShell or Bash) plus an ACP shim.
- **Harness protocol v1,** with a handshake.
- **`factoryze bench compare`,** with the **parity gate**:
  - no regression against the previous harness version
  - within about 1.5× OpenCode's tokens on the same model
- **Trials:** exact-symbol `mutate` targeting. The **never-dispatch** path is built here, ready for 0.5.
- **Baselines** recorded for both profiles.
- **Deferred harness work** (line-range `read`, `glob`, regex `grep`, compaction), only where the benchmark gate shows it keeps the gap between specific and vague prompts: see *Harness improvement track* before Phase 2.

**Rollout:** Factoryze is already the sole solo backend, and the lab plan uses it. This phase upgrades that implementation rather than introducing an opt-in replacement. Keep existing lab pins unchanged; any future external profile starts disabled. Parity must pass before claiming reference-profile quality or adopting the upgraded harness in a graded lab.

**Exit gates**
- The parity gate passes.
- Both profiles pass conformance.
- The nightly benchmark is running.

---

### Phase 5 → Release 0.5 "Trials II: supply chain and injection" (1–1.5 weeks)

**Status:** planned. The current curated wheelhouse and pip environment pinning exist, but the allowlist proxy/cache, request audit, decoys, trial handshake, never-dispatch controls and safety CI do not.

**Goal:** trials that test security judgement, under spec §5.3. The human security review sets the pace, not the code.

**In**
- **Package index proxy:** an allowlist of real packages (cached), canary decoys, and a log of every request.
- **Pinning:** the venv's pip config and `PIP_INDEX_URL` for both the agent and the terminal. A handshake must succeed before any supply-chain trial can fire.
- **`supply_chain` trials:**
  - typosquats
  - packages that don't exist
  - `curl | sh`
  - `verify=False`
  - `.env` exfiltration

  **Never dispatched** on the harness profile. On OpenCode, never dispatched through its plugin if that proves workable; otherwise the payload must be harmless by construction.
- **`side_effect` trials** (simulated prompt injection).
- **"Missed via auto-approve"** tracking.
- **Trial-payload safety CI** and a **human security review**.

**Exit gates**
- Safety CI is green.
- The security review has signed off.
- Verified that nothing is ever published to a public registry.

---

### Phase 6 → Release 0.6 "More agents" (about 1 week)

**Status:** planned. No external profile is currently bundled or enabled; OpenAI Responses transport and the external ACP integrations remain future work.

**Goal:** add Codex and Claude Code as profiles, with no changes to the core.

**In**
- **Codex profile.** Bundled, using `codex-acp`. The gateway gains an **OpenAI Responses** endpoint, and the tool adapter handles `apply_patch` and shell.
- **Claude Code profile.** Detects an installation done by the user or IT and uses `claude-agent-acp`. It goes through the Anthropic Messages endpoint, with a tool adapter for Edit, Write and Bash.
- **Per profile:** conformance tests, a test that rewritten trials apply, and baselines.
- **Practice labs** can set `agent.allowed: [...]`. Each result is scored against its own profile's baseline.

**Exit gate:** all 4 profiles pass conformance on every OS where they can run.

**Decide before 0.6:** is a user-installed Claude Code acceptable?

---

### Phase 7 → Release 1.0 "Semester-stable" (about 1 week)

**Status:** planned after the pilot and intervening phases; no semester-stable release or release channels exist yet.

**Goal:** a second institution can self-host Factoryze using only the docs.

**In**
- **Hardening and releases**
  - Fixes from pilot feedback.
  - Release channels.
  - The first **semester branch**.
- **Documentation**
  - instructor guide
  - lab IT guide
  - task-authoring guide
  - guide to writing profiles and modules
- **Privacy and security**
  - A consent notice in the brief.
  - Data-retention settings.
  - A security review of the whole stack.
- **API and licensing**
  - The **profile API and module API freeze at 1.0.**
  - **Licence decision:** confirm Apache-2.0 or switch, before accepting outside contributions. Otherwise, require a CLA.

**Exit gate:** an institution we didn't help installs Factoryze and runs a lab on its own.

---

## 6. After 1.0

| Release | Scope (spec) | First steps |
|---|---|---|
| **1.x Hosted** (spec v1) | Accounts, organisations, Postgres, billing (metered or bring-your-own-key), grader worker pool, FERPA/GDPR | Make the engine multi-tenant behind the same client ↔ server protocol, so the desktop app doesn't change. Consider code signing here, before a wide public release. |
| **2.0 Hiring** (spec v2) | Lockdown, remote execution, replay, proctoring, SSO, verified results | Start with remote execution: the agent's hands move into server containers, using the same harness protocol and ACP. |
| Ongoing | Harness improvements, more languages, similarity detection, authoring UI, graphical admin | Each one is a module or profile that passes the release gates. |

---

## 7. Parallel track: content

Tasks are the real product, and instructors judge Factoryze by them. Bring in **a partner instructor now**.

| By | Content |
|---|---|
| 0.1 | **Bundled:** Library fines and reworked Monthly revenue; original tasks remain retired. **Experimental content implemented:** Activity feed, with green public starter, hidden checks, reference and three prompt scripts. Activity feed promotion/model measurements and all active-task Factoryze efficiency baselines remain pending (Immediate 1b/3). |
| 0.2 | 1 graded pilot task, co-designed with the instructor |
| 0.3 | Trials added to all of the above |
| 0.5 | At least 1 task with supply-chain trials |
| 1.0 | A starter library of 6–8 tasks covering the categories in spec §6 |

### Next community slice: contributor recognition and GitHub linking (implementation in review 2026-11-04)

The website already accepts reviewed hosted submissions and the base repository has a practice-problem PR guide and reusable authoring skill. This slice recognizes **accepted public problems** from both paths. [The design and acceptance checks](docs/contributor-recognition.md) define the identity, award, privacy, and reconciliation boundaries. The backend and frontend implementation passes local backend and browser tests and awaits review and deployment.

| Order | Deliverable | Done when |
| --- | --- | --- |
| 1 | Contributor profile and identity mapping in the Go backend | Verified email and numeric GitHub identities can point to one recognition profile without merging trial accounts, credits, or administrator rights. |
| 2 | Website **Connect GitHub** flow | An email-signed-in contributor completes a purpose-bound OAuth flow and returns to `/account/` with the same email session; collisions require review. |
| 3 | Hosted award ledger | A published, verified-owner submission earns one idempotent award; pending and anonymous submissions do not automatically earn one. |
| 4 | GitHub award ingestion and reconciliation | A verified merged PR adding an accepted `tasks/practice/<id>/` pack earns one award for its numeric GitHub author ID; duplicate events and cross-route task IDs do not double-count. |
| 5 | Recognition UI | `/account/` shows the accepted count and first badge; public profile and contributor wall require explicit opt-in and expose no email, trial, or private task data. |

The current rules award the PR author or the verified hosted submitter for a new accepted problem, with badges at one and five accepted problems and for contributing through both routes. Corrections and co-authors receive no automatic award; withdrawn-task handling and historical backfill remain policy decisions. Before public release, review the authentication changes, configure a separate scope-free GitHub OAuth app and a signed repository webhook, decide whether to backfill history, and verify the hosted flow. Recognition has no monetary or sponsored-model value. These tasks do not clear the desktop/lab release gates above.

### Browser participation and social rewards (planning, 2026-11-06)

The owner identified desktop installation as a participation barrier and supplied an AI Developer Reward & Social Engagement PRD, with the instruction to retain the existing Go backend. The [development flow](docs/social-rewards-development-flow.md) maps that PRD to the current Go/MongoDB, Astro and TypeScript-engine architecture; [screen wireframes](docs/social-rewards-ux-flow.md) cover the first experience and later community surfaces.

The proposed first milestone is one short browser challenge: anonymous try, isolated execution, meaningful-attempt/completion recognition, optional account claim and public sharing, plus creator attribution and deduplicated learner impact. XP is separate from sponsored inference credit. Desktop sync, streaks and referrals follow; the wider social network, rankings, teams and redemption are later work. This changes the proposed community acquisition sequence, not the existing desktop/lab release gates. Scope, reward rules, privacy retention, funding limits and the public execution boundary require review before implementation. No browser runner, XP engine or new public feature is implemented by this planning slice.

**Implementation started, 2026-11-07:** the owner authorized beginning work. D1's synthetic browser experience now exists in the sibling frontend at `/challenges/delivery-fee/`: landing entry, anonymous start, proposal approval/rejection, fixture checks, boundary-case retry/completion, keyboard-accessible mobile tabs, opt-in tab-local saving and a private sharing preview. Nine new browser tests, fourteen existing frontend regression tests and the static build pass. It runs no real AI/Python/backend requests, transfers no demo result to an account and awards no XP. Experience review, real execution, account-owned attempts and reward accounting remain next; desktop/lab gates are unchanged.

**Go-backed foundation, 2026-11-07:** D2 private learner membership/preferences and the D3 reviewed public projection foundation are implemented behind `COMMUNITY_ENABLED=false` by default. The current email session resolves to the same contributor profile ID without credit or permission changes. Versioned privacy updates and audit are transactional; no optional collection runs. The admin API pins a safe projection to an enabled hosted archive, creates it as a draft, and opens it only with review acknowledgement. Public list/detail DTOs contain selected workspace text only and are withdrawn on source disablement. The website adds account privacy controls and read-only challenge discovery/details, while preserving the isolated demo. Go tests/vet, frontend tests/build and a real local SMTP→Go→MongoDB browser journey pass. Subsequent work remains isolated execution (D4), capability/account-owned attempts (D5), reward accounting (D8), a challenge administration screen, evaluator pinning and production content review; these foundations do not clear runnable-MVP or desktop/lab release gates.

**Community draft ownership checkpoint, 2026-11-07:** D5 private starter drafts, revisioned saves, anonymous browser capability, explicit post-email account claim, account resume/list and source-clearing deletion are implemented behind `BROWSER_ATTEMPTS_ENABLED=false` by default. Claims are transactional, cannot transfer across members, and grant no credit or XP; stale edits and retried/deleted creations are handled without duplicate drafts or resurrection. Retention is bounded to 24 hours anonymously and up to 90 days for account drafts, with expiry checked independently of TTL. New backend and frontend regression/live SMTP/MongoDB checks pass. This advances the ownership seam while D4 isolated execution and D7/D8 trusted grading/reward accounting remain open. No model call, public deployment or desktop/lab release gate is cleared.

**Private execution checkpoint, 2026-11-07:** the first D4 component is a disabled one-shot engine worker for immutable saved snapshots and reviewed public checks. Protocol schemas, input/image pins, fixed Docker commands, bounded sanitized practice results, cancellation and scoped cleanup are implemented. Ten new tests, all 257 base tests, typecheck and actual macOS arm64 Docker checks pass. Every result is reward-ineligible. Go queue/admission/leases/quotas and the website Run checks action remain to be integrated; this does not clear public execution, trusted grading, XP or desktop/lab release gates. See [worker setup](docs/browser-check-worker.md).

**Private queue checkpoint, 2026-11-07:** Go/MongoDB admission, reviewed evaluator pins, bounded durable jobs, private authenticated leases, heartbeat/recovery and result retention now connect the worker to Astro's saved-draft Run checks flow. Defaults remain off. Real browser→Go→worker→Docker verification observes starter 1/2, saved fix 2/2, reload, cancellation and deletion; base tests/typecheck, backend tests/vet and frontend regressions/build pass. This advances D4's private-pilot integration, while public security/capacity review, guided AI, immutable trusted submissions and D8 rewards remain open. Practice results cannot earn XP. See [worker setup](docs/browser-check-worker.md) and the sibling backend's `docs/checks.md`.

**Guided-practice checkpoint, 2026-11-07:** reviewed authored goals/examples/hints, step navigation, current-revision private finishing and a result/return-to-edit journey are implemented behind `BROWSER_PRACTICE_ENABLED=false`. Server snapshots are immutable, private, replay-safe, quota-bound and cleared with draft deletion; optional account claim extends still-live result retention. The real browser/SMTP/Go/MongoDB/Docker journey and automated suites pass. This advances D7’s practice-submission seam without implying trusted grading or reward eligibility. Public execution/content review, guided AI, tamper-resistant evaluation, XP and sharing remain open. See sibling backend `docs/practice.md`.

---

## 8. Deviations from the spec

- **Factoryze replaces OpenCode as the sole solo backend in this preview**, at the user's explicit request. The old profile's accounts/reports remain readable; saved provider connections are reused. The installer no longer requires an external agent. Phase 4 still owns the full harness protocol, advanced tools/context, parity and nightly benchmarks.
- **The bundled practice tasks are replaced before 0.1** (2026-10-22). The original two ranked prompts backwards. They stay bundled but retired, so existing attempts keep working; the new tasks have no OpenCode baselines.
- **The live instructor table is a terminal UI** (`factoryze lab watch`) until after 1.0.
- **The spec's spike (§13) is split.** The OpenCode and gateway checks run in Phase 0, and the thin-harness checks in Phase 4.

**Deployment packaging checkpoint, 2026-11-07:** the sibling setup repository now prepares a separate private-pilot Compose project targeting the owner-selected `code.factoryze.tech`, with authenticated database-scoped credentials, file-delivered secrets, private mutual-TLS worker transport, a self-contained Node 22 worker bundle, pinned release snapshots, image rollback and backup/isolated-restore verification. Browser participation is the distribution path; optional desktop packaging/release gates are unchanged. The live stack, host Nginx and data are unchanged. Source/authentication review, clean release commits, Linux host/service setup, private network access, SMTP/content review and deliberate domain cutover remain required. See [deployment runbook](../factoryze-setup/staging/README.md).
