# Factoryze: Spec (v0.6)

**Status:** draft v0.6, originally 2026-10-20; implementation status reconciled 2026-10-29. Items marked **[A]** are assumptions that still need confirming.

**Implemented today:** an unreleased solo desktop preview with Factoryze as its only agent, task imports, local grading, persistent usage/budgets, optional BYOK judge/scoring, saved reports and Settings. The model connection offers BYOK or sponsored trial credits with email OTP, targeted invitations and a separate restricted gateway; see [trial setup](docs/trial-credits.md). Report activity/token explanations are implemented without report suggestions or prompt scores. Current checks and remaining platform/review gates are recorded in [PROGRESS.md](PROGRESS.md). The [current plan](PLAN.md#immediate-plan-added-2026-10-22-status-updated-2026-10-24) and [release evidence](docs/phase-1.md#release-evidence) distinguish completed work from the remaining gates. Docker was deferred on 2026-10-24 and resumed by the owner on 2026-10-29; the opt-in grader code is implemented, with real container verification blocked by local setup.

**Phase 2 software (2026-10-29):** the desktop joins a pinned HTTPS lab, receives public tasks, uses the server harness with local approved tools, persists keychain sessions, synchronizes revisioned mirrors and saves immutable submissions. Server-observed budgets, deadlines/closure, instructor reset/reconciliation, untrusted paste/focus flags, private grade queue, report release and CSV are implemented; 60 synthetic functional clients pass. Production grading remains off by default. The new Docker executor/grader requires an immutable image and a successful real-container self-check; local verification is blocked by missing Docker/disabled virtualization. No student code executes natively on the lab host. Lab/date are not arranged; real-machine/cross-OS validation, paid task measurements, pilot and human review remain open. [Lab guide](docs/lab-pilot.md), [completion audit](docs/verification/2026-10-29-lab-completion/checks.json).

**Target scope:** architecture diagrams, profile capability matrices, module interfaces and lab/hosted flows below describe the later v0/v1/v2 design unless explicitly marked implemented. The preview has the non-Docker lab workflow above, but no completed classroom pilot, verified Docker grader rollout, full distributed ACP/harness handshake, external profiles, assessment-trial framework or trusted integrity/proctoring module. See [the documentation audit](PROGRESS.md#2026-10-24--project-status-and-documentation-reconciliation).

**Decisions so far**
- **Existing solo/lab client:** a desktop app for Windows, macOS and Linux. A separate simulated browser challenge entry point now exists on the website; real hosted execution and rewards remain proposed in the community plan below.
- **Three modes, one engine:**
  - **solo:** a single PC
  - **lab:** client-server, with a self-hosted lab server
  - **hosted:** we run the server
- **Open source** under **Apache-2.0**. This is provisional and can change (§11). BYOK users supply their LLM key; sponsored users use an operator-funded gateway whose upstream key stays on the server.
- **Target: pluggable agents.** The current solo app uses only Factoryze. The later agent-profile architecture includes:
  - our own lightweight **Factoryze harness**
  - **OpenCode**
  - **Claude Code**
  - **Codex**

  Two target seams make this work; the current solo preview uses an in-process loop and pane events plus the authenticated gateway:
  - **ACP** (Agent Client Protocol) between the IDE and the agent.
  - **The engine's model gateway** between the agent and the LLM.
- **Per-profile measurement.** Budgets and baselines are set per **(task, profile@version, model)**.
- **One pinned profile per graded lab.** Practice can allow a choice.
- **Agent shell:** PowerShell on Windows; Bash on macOS and Linux. Windows agents do not require Git Bash.
- **Python is already installed** on lab machines, and is a prerequisite in solo mode. The app checks the version and does not bundle Python.
- **Lab server:** a machine on the lab's local network (LAN).
- **Unsigned builds for now.** There is no Apple Developer account, so the macOS and Windows installers are unsigned (§10).
- **Our harness improves over time.** It is benchmarked against the other profiles on the same tasks.
- **Token budget per student,** visible to them.
- **Modules plug in.** The core is complete on its own.
- **Trials** cover faulty code, prompt injection, misleading context and the supply chain.
- **First audience:** students in labs. Hiring comes later.

---

## 1. Thesis

When people code with AI, how specifically they ask for things shows what they understand. "Replace the nested loop in `dedupe()` with a set lookup" costs a real agent little. "Make it faster" sends it reading, grepping and retrying.

The second skill is **judgement over the agent**. Does the student:
- check its diffs?
- catch its mistakes?
- refuse dangerous commands and suspicious packages?

Trials test this.

---

## 2. Deployment modes

| | **Solo** | **Lab** (self-hosted) | **Hosted** |
|---|---|---|---|
| Who | One person, own PC | An instructor and 20–60 students on lab machines **[A]** | Institutions and individuals; companies later |
| Engine runs | Inside the desktop app | Lab server: a machine on the lab LAN | Our cloud |
| **LLM key supplied by** | The person using it | **The instructor or admin, on the server.** Students never enter a key. | Us (metered) or the organisation (bring your own key) |
| Hidden tests and trials | On the user's disk (practice only) | On the server only | On our servers only |
| Results | Personal report, **practice (unverified)** | Graded, with a CSV export | Graded; later verified results and hiring |

**Roadmap**
- **v0:** solo and lab.
- **v1:** hosted.
- **v2:** hiring, adding lockdown, remote execution (remote-exec), proctoring, SSO and replay.

---

## 3. Architecture

### 3.1 Two seams make agents pluggable

**Target architecture.** The diagram and external ACP process boundary are planned. The current solo loop and local tools are described in §3.4; no separate `factoryze-agent` process ships today.

```
 Desktop app
┌────────────────────────────────────────────────────────────────────────────────┐
│ Theia workbench: Explorer │ Editor │ Terminal │ Agent pane (ACP client)        │
│                                                                                │
│ ACP (JSON-RPC over stdio) — seam #1                                            │
│                            ▼                                                   │
│ Agent profile: factoryze-agent │ opencode acp │ claude-agent-acp │ codex-acp   │
│ Tools run here, in the workspace                                               │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ model API calls — seam #2
                                       │ Anthropic Messages / OpenAI Chat /
                                       │ OpenAI Responses, base URL → engine;
                                       │ harness uses its native protocol
                                       ▼
 factoryze-engine: in-app (solo) │ lab server │ our cloud
┌────────────────────────────────────────────────────────────────────────────────┐
│ Model gateway ─► provider (Anthropic, OpenAI, OpenRouter, Ollama, …)           │
│   ├ token meter + budget (per profile)                                         │
│   ├ tool adapters (agent's tool calls ↔ canonical form)                        │
│   └ module hooks: judge · trials · …                                           │
│ Factoryze harness loop (brain of the factoryze profile)                        │
│ Package index proxy · Workspace mirror · Event store                           │
│ Grader · Task store · Lab admin                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Seam 1: [ACP](https://agentclientprotocol.com/).** This open protocol plays the role for agents that LSP plays for language servers. The target pane is one ACP client for all supported profiles. ACP covers streamed messages, tool calls tagged by kind (read, edit, search, execute and so on), diffs, plans and **permission requests**. Every permission decision passes through the pane, so we can log it consistently. Planned profile integrations:
  - OpenCode supports ACP natively.
  - Codex and Claude Code connect through ACP adapters.
  - The full Factoryze harness will speak ACP through its separate agent shim.
- **Seam 2: the model gateway.** Every profile's base URL points at the engine. The agent gets a **session token** in place of an API key, and the gateway swaps it for the real key. One choke point then handles metering, the budget, trials and key custody, whichever agent is running.

**Current solo connections:** Settings supports saved API-key connections or backend environment configuration for Factoryze. OpenCode's keyless public endpoints reject the custom harness and are unavailable. OpenRouter requires an OpenRouter key and uses Chat Completions; legacy settings selecting Anthropic Messages for its URL are normalized on read. Historical OpenCode usage/reports remain readable, and older saved Factoryze provider settings are retained without a connection-import picker.

**Sponsored desktop credits (2026-10-27, user-requested addition).** The solo app also offers email/OTP sign-in and a server-funded model connection in the existing model dialog, retaining BYOK. A separate web backend owns trial identity, invitations, monetary allowances and upstream keys. The agent/tools/grading, task token budget and reports remain local. Native sessions are trial-only and cannot authorize administrators. The account allowance and task budget are independent; requests stop at either limit without an automatic switch to BYOK. See [desktop trial credits](docs/trial-credits.md) and the dated progress/check record for implementation and release gates. Sponsored trial credit does not implement the fault-injection assessment trials described later in this spec.

OpenRouter configuration accepts the API prefix or full Chat Completions endpoint, normalizing the latter before appending the request path. Known routing/data-policy/account errors are mapped to safe static guidance; raw provider diagnostics remain backend-only. The Factoryze harness does not discover personal skills, external agent instructions or project plug-ins, and makes no background title requests. The header separates raw input/output counts, identifies cached input, and retains one weighted attempt budget. Agent instructions, tool definitions, history and tool results are real input usage; a dummy baseline does not reduce the meter or budget. Comparative assessment belongs in the per-profile/model baseline scores when a matching baseline exists.

### 3.2 Agent profiles

```ts
interface AgentProfile {
  id: 'factoryze' | 'opencode' | 'claude-code' | 'codex' | string;
  version: string;                       // pinned per lab; baselines are per version
  distribution: 'bundled' | 'user-installed';
  modelApi: 'native' | 'anthropic-messages' | 'openai-chat' | 'openai-responses';
  launch(ctx: { workspace; gatewayUrl; sessionToken; model; policy }): AcpConnection;
  writeConfig(policy): ConfigFiles;      // our permission policy → the agent's native config
  tools: ToolAdapter;                    // agent's tool calls ↔ canonical read/search/edit/write/patch/shell
  capabilities: Capabilities;
}
```

**Capability matrix (v0 targets)**

| | **Factoryze harness** | **OpenCode** | **Claude Code** | **Codex** |
|---|---|---|---|---|
| Licence and distribution | Ours; bundled | MIT; bundled | Proprietary; **user or IT installs it**, under Anthropic's terms | Apache-2.0; bundled |
| ACP | Native (`factoryze-agent`) | Native | `claude-agent-acp` adapter | `codex-acp` adapter |
| Gateway API | Native protocol | Any provider (via `baseURL`) | Anthropic Messages (`ANTHROPIC_BASE_URL`) | OpenAI Responses (custom provider `base_url`) |
| Models | Any | Any | Anthropic | OpenAI, plus others that are compatible |
| Metering and budget | ✅ | ✅ | ✅ | ✅ |
| Judge (runs in the pane, before the prompt reaches the agent) | ✅ | ✅ | ✅ | ✅ |
| `mutate` / `side_effect` trials | ✅ exact symbol targeting | ✅ gateway rewrite through the tool adapter | ✅ gateway rewrite | ✅ gateway rewrite (`apply_patch`) |
| `supply_chain`: approved payload **never dispatched** | ✅ | ⚠️ through an OpenCode plugin **[A]** | ❌ relies only on payloads being harmless by construction | ❌ the same |
| Where the agent's brain runs in labs | **Lab server** | Student machine | Student machine | Student machine |
| Tamper resistance | High | Medium (gateway-side data still holds) | Medium | Medium |

**Rules**
- **Graded labs pin one profile, version and model.** Practice labs and solo mode may set `agent.allowed: [...]`, and every result is then scored against its own profile's baseline.
- **Each profile carries its own budget**, because each agent's fixed overhead differs: system prompt size, background calls and how it uses tools.
- **Windows profiles use PowerShell for shell calls.** The profile adapter configures the agent accordingly. A profile is enabled on Windows only when it can use PowerShell and enforce the configured shell permissions.
- **A profile is a plug-in.** Adding Gemini CLI or anything else that speaks ACP means adding a profile and a tool adapter. No core changes.

### 3.3 Where the agent runs in a lab

| Profile | Agent process | Tools execute | Model calls | API key |
|---|---|---|---|---|
| **Factoryze harness** | Loop ("brain") on the **lab server**. A thin ACP shim with the tool executor ("hands") runs on the **student machine**. | Student machine | Lab server → provider | Lab server |
| **OpenCode / Claude Code / Codex** | The **student machine**, as a child process of the desktop app (ACP over stdio) | Student machine | Student machine → **lab server gateway** → provider | Lab server. The agent only holds a session token. |
| **Any profile with remote-exec (v2)** | A per-student container on the server | Container | Inside the server | Server |

**Why most of it runs on the student machine.** An agent needs the files and a shell. In a lab, both live on the student's machine. Everything that has to be trusted stays on the server:
- the key
- metering and the budget
- the judge and the trials
- the grader and the hidden tests

The external agents are mostly I/O-bound, so lab machines have the capacity to run them.

**Remote-exec is for hiring, and it is optional for labs.** It suits labs with weak machines or ones that need strict control. In return, the server runs 20–60 containers, each with an agent and the student's code. That calls for a much bigger lab server.

**Lab network**
- **Only the server needs the internet.** The lab server sits on the lab LAN, and student machines only need to reach it. Model calls, package installs, events and grading all go through the server. The server itself needs internet access for two things:
  - reaching the LLM provider (unless the lab uses a local model)
  - filling its package cache
- **Encrypted connections.** On first run, the server generates a self-signed TLS certificate. Its fingerprint is pinned in the client config that IT deploys alongside the app, together with the server address.

### 3.4 The Factoryze harness (our reference profile)

**Current solo preview (2026-10-21, requested scope change):** `factoryze@0.1.0` is the app's only backend agent. OpenCode is not bundled or launched; earlier saved provider credentials automatically use Factoryze. The engine loop calls the authenticated loopback gateway directly, while the app backend executes local tools and reuses the pane's streaming/approval events. Chat Completions and Anthropic Messages are supported, with exact model IDs and safe provider errors. No personal skills, plugins or background title calls run.

The preview tools are UTF-8 `read`, bounded `list`, literal `grep`, unique exact-match `edit`, `write` and approved Bash/PowerShell `shell`. Every file change shows a diff and every shell command requires one-time approval. Stop cancels requests, approvals and shell process trees. File tools stay in the workspace; approved shell runs with the user's OS permissions, not in a sandbox. Files are capped at 64 KB, tool output at 16,000 characters, shell at 30 seconds and prompts at 16 model steps. A conservative byte guard drops whole older turns and refuses oversized current context; actual provider usage alone determines the meter and budget.

Existing saved model/key/budget settings and historical OpenCode accounts/reports remain readable without resetting or reattributing usage. New requests use the distinct Factoryze profile, retaining totals across sessions/restarts. Settings retains saved provider credentials and normalizes the saved agent to Factoryze; the earlier OpenCode connection-import picker was removed. OpenCode's keyless free endpoint rejected the custom harness with HTTP 403, so those connections are unavailable. OpenRouter free models still require an OpenRouter key. No raw provider diagnostic or private key reaches the renderer.

This early solo slice supersedes the original OpenCode-first rollout below. The full separate agent process, remote handshake, advanced tools, trials, benchmarks and parity gate remain Phase 4 work. The preview is not a lab/assessment security boundary.


**Target distributed shape (Phase 4):** the brain is in the engine and the hands are on the client. This is separate from the implemented in-process solo loop.
- **Brain (engine):** the loop, context, permission rules and trials.
- **Hands (client):** a local `factoryze-agent` process that:
  - speaks ACP to the pane;
  - speaks the harness protocol to the engine;
  - executes tools in the workspace.

This is the deepest integration, and the only profile where:
- approved trial payloads are guaranteed never to run;
- trial targeting is exact;
- the client can't tamper with the loop.

**Turn flow**
1. The student sends a prompt. The judge scores it, or blocks it in `block` mode.
2. The engine calls the model, and the text streams to the pane.
3. The trials hook may rewrite or inject tool calls.
4. The engine checks each call against its permission rules (allow, deny or ask). For "ask" it sends an ACP permission request, which shows as an approval card with an edit diff. The current solo pane renders a unified before/after diff.
5. Approved calls are dispatched to the hands. Trial payloads are not dispatched; the engine returns scripted output instead.
6. Results are truncated and added to the context.
7. The loop repeats until no tool calls remain, the budget runs out, or the student presses **Stop**.

**Target tools (full v0 harness; not all implemented).** These follow mainstream agents, so students build habits that transfer. Today's bounded whole-file `read`, `list`, literal `grep`, exact `edit`, `write` and approved `shell` are described above; line ranges, `glob`, regex search, whitespace fallback, `todo` and head/tail output remain later work.

| Tool | Behaviour |
|---|---|
| `read` | Path plus offset/limit, line-numbered, with size caps |
| `glob` | File pattern match |
| `grep` | Regex search via ripgrep (bundled with Theia) |
| `edit` | `old_string` → `new_string`: exact match first, then a whitespace-tolerant fallback adapted from OpenCode (MIT). An ambiguous match is an error, so the model retries. |
| `write` | Writes a whole file |
| `shell` | Runs PowerShell on Windows and Bash on macOS/Linux; timeout; persistent working directory inside the workspace; output truncated to head and tail; no stdin; kills the whole process tree |
| `todo` | A task list held by the engine and shown in the pane |

**Target context management.** Today the byte guard drops whole older turns, tool output retains its first 16,000 characters, and there is no model-generated compaction or explicit Anthropic cache-control policy. Caching/compaction changes remain subject to the measurement gate.
- Tool output is capped.
- Prompt caching is used.
- At about 80% of the context window, older turns are compacted.
- A **New session** button starts fresh.

**Not in v0:** MCP, subagents, web fetch, plan mode. Feeding language-server diagnostics to the agent is planned for v1.

**Improving it over time: benchmark mode.**
- Run each task's scripted expert and naive prompts through **every enabled profile** on the same model. This produces the baselines and a comparison table: tasks solved, tokens used, turns and time.
- A new harness version ships when it doesn't regress against its previous version, and when it solves what the reference profiles (OpenCode, Codex or Claude Code, depending on the model family) solve within about 1.5× their tokens **[A]**.

**Measurement consistency (added 2026-10-22).** Because we own the harness, we can reduce the run-to-run noise in token counts, so that differences between students come from their prompts rather than the agent's luck. This makes the measurement precise; it does not show that it measures skill. That still needs the pilot comparison with human ratings (§8).
- **Randomness.** Solo connections accept an optional temperature, unset by default and sent only when configured. Settings validates 0–2; individual models can restrict that range. Recognized provider refusals show safe guidance to clear or change the setting, with no automatic retry. Changes apply to new agent sessions; the optional judge remains separate. Backend configuration uses `FACTORYZE_TEMPERATURE`. Graded labs will set temperature to 0 and pin the model and provider. Providers aren't perfectly repeatable even at 0, so some variation remains.
- **Exploration policy.** The harness decides how the agent looks for code: files listed in a stable order, bounded file reads, and possibly searching before reading. The cost should track the prompt: "fix the off-by-one in `app/pagination.py`" should lead to one read, and "fix the bug" to a search. The extra cost of a vague prompt is then real and repeatable. The agent must stay comparable to mainstream tools; it is made predictable, not deliberately worse.
- **Stable inputs.** No timestamps or random IDs in what the agent sees, and tools always in the same order. This makes runs repeatable and keeps provider caching steady. Cached input is weighted at 0.1, so unstable caching would show up as score noise.
- **Version pinning.** A regression fingerprints the runtime instructions, canonical tool definitions and shared model-step/tool-output/file-size/shell-time limits against the profile version. Behavior changes require a version bump before new baselines. New solo reports include optional `executionPins`: distinct recorded session configurations containing profile version, model, provider host (no path or credentials), temperature and OS. Null temperature means an unknown provider default. Multiple configurations are retained; older reports and sessions without recorded metadata are not backfilled from current settings. Recorded settings appear in the report. Students should be compared within the same pin (see the lab freeze and §8); automatic lab/CSV comparison enforcement remains Phase 2. A provider host such as OpenRouter does not identify or pin its upstream route.
- **Explaining usage (implemented locally, Immediate plan 4; remaining platform gates/review pending).** New report snapshots save per-prompt costs/states, attempted tool counts and approvals. Measured weighted model-request usage is grouped by preceding exploration, edits, commands, mixed activity or prompt start; missing history is unattributed. Raw fresh input/cache reads/cache writes/output are shown separately. Input includes instructions, history and tool results; exact tool-execution and context token costs cannot be recovered from this ledger. The approved app view shows a segment per check, a failed-details modal, stable result dimensions, explained metrics and observed usage; it shows no suggestions, prompt grades or aggregate score text. Optional backend judge/scoring data and Home result scores remain compatible. Older submissions remain readable without invented activity, check details or live prompt costs.

### 3.5 Client: Theia workbench

[Eclipse Theia](https://theia-ide.org/) provides a VS Code-like workbench and cross-platform Electron installers. We build it without Theia AI.

**Implemented:** one `@factoryze/app-core` Theia extension (`packages/app/extensions/core`) provides Home, the start sheet, brief, workbench controls, agent pane and approval cards, Tests, reports and Settings. Backend services run the solo engine and local tools. The app always launches to Home unless a workspace is explicitly supplied on the command line.

Separate agent-pane/report extension packages, external ACP process management, lab join, todos/plans and lockdown are target work; they are not additional installed extensions today.

### 3.6 Core (ships in v0 and works with every module turned off)

The table is the full v0 target. Today the solo engine has Chat Completions/Anthropic Messages transport, a local SQLite ledger/grader, curated wheelhouse and in-process harness. Workspace mirroring, OpenAI Responses, a general module/profile host, the audited package proxy and lab admin remain future work.

| Part | Where | Responsibility |
|---|---|---|
| Workspace UI | Client | Explorer, editor, terminal and agent pane. Each can be toggled unless the config locks it. |
| Launcher | Client | Solo today: Home/start sheet and Settings for the Factoryze model connection. Future lab mode: server URL, join code and student ID; profile choice awaits external profiles. |
| Workspace and runtime | Client | Writes `workspace/` to disk, then sets up Python:<ul><li>Uses the machine's installed Python and checks its minimum version plus `venv`/`ensurepip` support before enabling Start. Windows supports the `py` launcher; missing support receives platform setup guidance.</li><li>Creates a venv with `python -m venv`.</li><li>Pins pip to the engine's package index through the venv's `pip.conf` (on Windows, `pip.ini`).</li></ul> |
| Agent host | Client | Launches the pinned profile with generated config, using gateway URL, session token, model and permission policy. |
| Workspace mirror | Client → engine | Syncs changed files before each model call and on save. The trials, snapshots and grader all read from it. |
| Model gateway | Engine | Provider-compatible endpoints (Anthropic Messages, OpenAI Chat Completions, OpenAI Responses) plus the harness protocol. Handles authentication, metering, budget, tool adapters and module hooks. Provider access goes through the Vercel AI SDK **[A]**. |
| Harness loop | Engine | The brain of the `factoryze` profile. |
| Package index proxy | Engine | Serves allowlisted packages and decoys, and logs every request. |
| Event log | Both | Append-only. Holds ACP updates, permission decisions, UI events and gateway calls. |
| Grader | Engine | Runs hidden tests and checks on the mirror (Docker in lab and hosted mode; a local runner in solo mode), then the scorers and the report. |
| Lab admin | Engine (lab and hosted) | Create a lab and get a join code; live table; close; CSV; release reports. |

**Token budget**
- **Counting.** Cost-weighted: input and output count fully, and cache reads count at 0.1 (configurable). Raw counts are reported too.
- **Limit.** Set **per profile**, either relative to that profile's baseline (for example `3x`) or as an absolute number.
- **When it runs out,** the gateway refuses further calls and the agent stops. The editor and terminal keep working.
- **Judge tokens don't count.**
- **Solo task runs.** Start task or folder/ZIP import creates a fresh workspace/run with zero input/output/cache/weighted usage and an independent limit per profile/model. New session, restart and reopening that workspace retain its usage and remaining budget. Cumulative historical task totals remain in reports; no stored request or prior report is reset. Missing/truncated usage blocks the affected run. Live usage notifications identify their workspace so late updates cannot populate another run's meters.

### 3.7 Module interface

**Target interface.** The current judge and scoring are engine functions controlled by settings. A general plug-in/module host and these hooks are not yet implemented.

```ts
// Engine side
interface EngineModule {
  id: string;
  configSchema: JSONSchema;
  onUserPrompt?(ctx, prompt): Allow | Block;                       // judge
  onModelResponse?(ctx, res: CanonicalResponse): CanonicalResponse; // trials, all profiles (via tool adapters)
  onDispatch?(ctx, call, decision): Dispatch | Simulated;           // trials, harness profile only
  onAgentEvent?(ctx, ev: AcpUpdate | PermissionDecision): void;
  onPackageRequest?(ctx, req): PackageResponse | void;
  onEvent?(ctx, event): void;
  score?(log: Event[], mirror, task): ScoreSection;
}

// Client side: Theia extension
interface ClientModule { id: string; activate(config): void; }
```

**Two kinds of plug-in.** Modules and agent profiles are separate plug-in types. Modules call `profile.capabilities` to check whether a feature is available.

**Judge enforcement.** In the current solo preview, the backend assesses the prompt before dispatching it to the harness and returns the assessment to the pane. A failed/unavailable judge does not block the agent. Blocking mode and the lab gateway cross-check are planned.

### 3.8 Module catalogue

The v0 column is target scope, not completion status. Optional judge `score`, scoring v1 (correctness/eligible efficiency/specificity), Factoryze-only benchmark scripts and light untrusted lab paste/focus flags exist. Judge `block`, trials, verification scoring, a general integrity module and cross-profile benchmarking remain planned. Lab judging is off; reports have no suggestions or prompt scores. Efficiency baselines for the active tasks have not been recorded.

| Module | v0? | Notes |
|---|---|---|
| **judge** | ✅ | `off` / `score` / `block` (§4) |
| **trials** | ✅ | Four families; availability depends on the profile (§5) |
| **scoring** | ✅ | Four layers (§8) |
| **integrity** | ✅ light | Flags for pastes and focus loss |
| benchmark | ✅ (CLI) | Runs scripted prompts across profiles (§3.4) |
| lockdown, remote-exec, replay | v2 | For hiring |
| similarity, authoring UI, SSO, other languages | later | |

---

## 4. Judge module

**Current status:** optional `score` mode is implemented and disabled by default. `block` mode and lab enforcement remain planned; the mode table below describes the target behavior.

| Mode | Behaviour | Use |
|---|---|---|
| `score` (default) | Every prompt gets a verdict, a reason and a specificity score. Nothing is blocked. | Graded labs |
| `block` | Vague prompts are rejected with a reason. The student rewrites, and the rejected attempt is logged. | Practice |

- **What it flags:** vague prompts, clone requests ("make me a copy of X"), handing over the whole task, and off-task prompts.
- **How it sees prompts:** with recent turns as context, and treated as data, not instructions. It returns structured output.
- **How it runs:** on a small model from the same provider. The prompt can be overridden per deployment.

---

## 5. Trials module

**Current status:** planned for Phases 3–5. Gateway rewrite tests are foundations, not a shipping trial framework. No live trial payloads or supply-chain dispatch controls are enabled in the solo preview.

### 5.1 Principles

1. **Deterministic.** Engine code applies the faults, and the same trigger always produces the same fault.
2. **Fires once.** A trial that never fires is reported as *not fired* and isn't scored.
3. **Consistent with the agent.** Rewrites happen in the model response, so they go into the agent's own history, whichever profile is running.
4. **Plausible.** Each trial looks like a real AI mistake or a real attack.
5. **Disclosed generally, revealed after the lab.** The brief says: *"The assistant can make mistakes, some deliberate, and may suggest unsafe actions. You are graded on what you submit and what you approve."*
6. **Sparing.** One to three per lab.
7. **Never leaked in advance.** Trial definitions never reach the client.

### 5.2 Trial families

| Family | Mechanism | Examples |
|---|---|---|
| `mutate` | The gateway applies a tree-sitter operator to an edit, write or patch on the target file and symbol. The symbol is resolved through the workspace mirror and the profile's tool adapter. | `<` → `<=` at a loop boundary; a dropped `None` guard; swapped arguments; parameterised SQL replaced with string formatting |
| `side_effect` | After the agent reads a planted file, its next edit gets a scripted extra hunk. This simulates a prompt injection. | A planted `vendor/fastcsv/README.md` causes an edit that also skips an auth test |
| `misleading_context` | A static plant in the workspace or brief. A hidden check catches students who follow it. | `# TODO(senior): hash passwords with md5` |
| `supply_chain` | A package install or a risky command is rewritten into, or injected into, the agent's tool calls. The student meets it at the approval card. Alternatively, the agent's text recommends a package the student would install themselves. | Typosquat `requests` → `reqeusts`; the hallucinated package `flask-jwt-simple`; `curl … \| sh`; `verify=False`; reading `.env` and POSTing it |

`trials.yaml` lives in the private task pack and is read only by the engine:

```yaml
- id: paginate-off-by-one
  type: mutate
  target: { file: app/pagination.py, symbol: paginate }
  operators: [boundary_lt_to_le, boundary_minus_one]
  caught_by: tests/hidden/test_pagination.py::test_last_page

- id: requests-typosquat
  type: supply_chain
  trigger: { agent_installs: requests }
  rewrite_to: reqeusts
  caught_by: permission_denied
  requires: [harmless_by_construction]   # enforced for every profile
```

### 5.3 Supply-chain safety rules (non-negotiable)

1. **Every payload is harmless if executed.** This is the baseline guarantee for **every** profile:
   - Decoy packages exist only in the engine's index, as canaries.
   - URLs use `.invalid` domains.
   - "Secrets" are fake files planted in the workspace.
2. **Profiles that can avoid running the payload do.** Where the profile supports it, an approved payload is never dispatched and the engine returns scripted output: the Factoryze harness natively, and OpenCode through its plugin **[A]**.
3. **CI checks every payload.** Each one runs in a sandbox to prove rule 1.
4. **We never publish lookalike packages** to public registries.
5. **Package traffic is pinned to the engine.** This covers the venv's pip config and the `PIP_INDEX_URL` environment variable for both the agent and the terminal. Supply-chain trials fire only after the engine has confirmed this pinning.
6. **The agent must ask before running shell commands.** Supply-chain trials need a permission policy where shell commands require approval. The profile's `writeConfig` translates this into each agent's native settings. If a profile can't enforce it, those trials are disabled.

### 5.4 Outcomes

| Outcome | Meaning |
|---|---|
| **Caught at review** | The student rejected the diff or denied the approval. This is the best outcome. |
| **Caught later** | Approved, but fixed or removed by submit. Time-to-catch is recorded. |
| **Missed** | Still present at submit, or the decoy was installed or imported. |
| **Missed via auto-approve** | An "always allow" rule let it through. Flagged as a risky habit. |
| **Not fired** | Not scored. |

---

## 6. Task packs

**Solo workflow (2026-10-22):** launch to Home, start a bundled task from its start sheet, open a task folder or ZIP, or explicitly Continue an earlier attempt, all in the current window. Launch never restores the last attempt automatically. Agent/provider setup appears in Settings; Factoryze is the only backend agent. Chat requires a supported connection; manual editing and tests do not.

Draft task schema 1 includes optional positive integer `budgetTokens` (weighted tokens). Configuration may explicitly override this limit for the solo user's task. Overrides persist across restarts and apply to the task's profile/model accounts without erasing usage. Clearing an override restores the task/default limit. Changes require stopped agent sessions and are audited. Imported packs are validated, copied into an immutable engine-owned snapshot, and identified by their unique task ID; only starter workspace files reach the editor. See [task pack format](docs/task-packs.md).

Draft schema 1 also accepts optional boolean `retired`. Retired tasks stay bundled with their graders but are omitted from the new Practice tasks catalog. Existing attempts, including records without saved task metadata, remain available in Continue and Results and support resubmission with preserved usage and report snapshots. Continue defaults to three recent attempts and offers Show all attempts, so older unsubmitted drafts stay reachable. Library fines and the reworked Monthly revenue report are the active bundled tasks; Stable customer IDs and Pagination API are retired. Public tests on the active starters stay green so the student's prompt must convey the symptom from the brief.

- **Public practice packs** live in their own repo and are used in solo mode.
- **Private assessment packs** are owned by the institution and loaded only into a lab or hosted engine.

```
tasks/pagination-api/
  task.yaml          # title, brief (symptoms not causes), minimum python version, time hint
  workspace/         # → client
  requirements.txt   # → client, via the engine's index
  grader.Dockerfile  # engine
  tests/hidden/      # engine
  checks/            # engine
  trials.yaml        # engine
  trials/            # engine: patches, decoy packages, scripted outputs
  prompts/           # engine: scripted expert + naive prompt sequences for benchmark mode
  baselines/         # engine: <profile>@<version>/<model>.json
```

**Task design guidelines**
- **Seed a CS-knowledge shortcut,** one of:
  - an O(n²) hot path
  - an N+1 query
  - a race condition
  - SQL injection
  - an off-by-one error
  - an unbounded cache
  - the wrong data structure
- **Make the time limit too short to hand-code everything.**

---

## 7. Config (lab example)

```yaml
lab: cs201-lab4
task: tasks/pagination-api
time_limit: 90m
panes: { explorer: true, editor: true, terminal: true, agent: true }

agent:
  profile: factoryze@0.3          # graded labs: exactly one
  model: anthropic/<model>
  # allowed: [factoryze@0.3, opencode@x.y, codex@x.y]   # practice labs only
  permissions:
    edit: ask
    shell: ask
    # Current practice tasks use python -m unittest; rule-based lab permissions are planned.
    rules: [{ allow: "python -m unittest*" }]

budget:                           # per profile; baseline looked up per (task, profile@version, model)
  factoryze@0.3: { limit: 3x_baseline }
  opencode@x.y: { limit: 3x_baseline }
  weights: { input: 1, output: 1, cache_read: 0.1, cache_write: 1 }

modules:
  judge:     { mode: score }
  trials:    { enabled: true }    # trials the profile can't support are skipped and reported
  integrity: { paste_flag_chars: 200 }

scoring:
  weights: { correctness: 0.5, efficiency: 0.2, specificity: 0.15, verification: 0.15 }
reports: { release: on_close }
```

---

## 8. Scoring

**Current status:** optional scoring v1 uses correctness, eligible efficiency and specificity; [the exact draft formula and eligibility rules](docs/phase-1.md#draft-scoring-version-1) are saved with report snapshots. Active practice tasks have no Factoryze baselines, so efficiency and a solved submission's overall score can be unavailable. Activity/token explanations are implemented locally (Immediate 4) and do not affect scoring; verification scoring remains planned. Historical benchmark separation does not validate skill measurement; the student pilot is still required.

| Layer | Source | Notes |
|---|---|---|
| **Correctness** | Hidden tests and checks on the final mirror | Acts as a gate. |
| **Efficiency** | Weighted tokens and turns, measured against **the same profile@version and model's** baseline | Explanatory request groups use preceding tool activity. Context is included in provider input, not separately metered or scored. |
| **Specificity** | Judge scores | Weighted towards prompts that led to accepted edits. |
| **Verification** | Trial outcomes, tests run after accepted edits, time spent reviewing diffs, approval decisions | Only trials that fired, and only those the profile supported. |

**Measurement noise.** Efficiency is only meaningful if the same prompts cost about the same each time. §3.4 *Measurement consistency* lists how the harness keeps run-to-run variation down: temperature 0, a stable exploration policy, stable inputs, version pinning and a per-category cost breakdown.

**Code performance (future enhancement).** Correctness and token efficiency don't show whether the student accepted a correct but slow solution. Measuring the result's runtime and efficiency is under consideration and not yet settled.[^code-performance]

**Comparing across profiles.** Efficiency is reported as a ratio to the profile's own baseline. That makes results roughly comparable across profiles, but not exactly. For example, some agents recover from vague prompts better than others. This is the reason graded labs pin a single profile.

---

## 9. Flows

**Solo**
1. Install the app. It always opens to **Home** and never reopens the last attempt by itself.
2. Connect a model from Home, Settings or a task's start sheet (stored in the OS keychain). Editing, tests and submitting work without one.
3. Start a practice task from its start sheet (Python check, the task's token budget, and the two ways to connect a model when none is connected), import a task folder or ZIP, or **Continue** an earlier attempt. Until the first submitted result, Home leads with three short starter tasks (`delivery-fee` first, then `duplicate-customers` and `latency-report`), and a practice attempt shows a five-step guide (Read, Ask, Approve, Test, Submit) above the agent conversation; the student can hide it.
4. Work on it: approve or reject the agent's edits and commands, watch each prompt's cost in the budget meter.
5. Submit and read the report, which is marked **practice (unverified)**. Keep working and submit again if you like; every submission is kept under Results.

**Lab**
1. **Setup (IT).** IT installs the app, plus any user-installed profile such as Claude Code, and points it at the lab server.
2. **Create the lab (instructor).** The instructor puts the key on the server, runs `factoryze lab create lab.yaml`, and gets a join code.
3. **Students join.** The app launches the pinned profile with a session token.
4. **Monitor.** The instructor watches a live table: status, tokens against budget, trials fired and caught, and flags.
5. **Close and grade.** The instructor closes the lab, which auto-submits any open work. Grading runs, then the instructor exports the CSV and releases the reports.

---

## 10. Tech stack

Current and target choices are distinguished below; see PLAN §4 for the actual package layout.

| Part | Choice |
|---|---|
| Workbench | Eclipse Theia (Electron), without Theia AI |
| Installers | Implemented: electron-builder DMG (macOS arm64 evidence, ad-hoc signed), Windows NSIS and Linux AppImage. Updates are manual; no updater or `.deb` target is configured. Intel/universal macOS verification is not established by arm64 receipts. Downloaded-artifact security prompts and direct AppImage launch remain manual gates. |
| Agent seam | Current: in-process Factoryze backend with ACP-shaped pane events. Target: separate ACP process/shim and a pinned external ACP protocol. |
| Agent shell | PowerShell on Windows; Bash on macOS and Linux. Profile adapters select the platform shell and preserve the permission policy. |
| Bundled profiles | Current: Factoryze loop and local tools only, with no external agent binary. OpenCode reference integration and Codex/ACP packaging remain planned. |
| User-installed profiles | Planned: Claude Code via `claude-agent-acp` |
| Harness | Current: `packages/engine/src/harness.ts` and app-backend `HarnessTools`, version `factoryze@0.1.0`. Separate `factoryze-agent` hands, advanced context/tools and parity remain Phase 4 work. |
| Gateway | Provider-compatible endpoints, plus Vercel AI SDK for upstream providers **[A]** |
| Search, Python | ripgrep (bundled with Theia); the machine's own Python, with `venv` and pip |
| Engine | `factoryze-engine` (TypeScript), hosted in-app (solo), as `factoryze-server` (lab), or in our cloud (hosted) |
| Lab server host | A machine on the lab LAN, running Docker for the grader:<ul><li>**OS:** Linux preferred. Windows or macOS with Docker Desktop also works **[A]**.</li><li>**Sizing:** a 4–8 core machine with 16 GB of RAM should serve 60 students. The gateway is light, and grading runs are queued when the lab closes **[A]**.</li><li>**TLS:** self-signed, with the fingerprint pinned in the client.</li></ul> |
| Storage | SQLite for solo and lab; Postgres for hosted |
| Grader | Docker for lab and hosted; a local runner for solo |
| Trials | tree-sitter (TypeScript), plus a minimal PEP 503 package index |

---

## 11. Open source

The website community track recognizes accepted public practice problems from repository PRs and reviewed hosted submissions. A contributor may explicitly link a verified GitHub identity to a separate contributor profile; this does not merge trial accounts or grant credits or administrative access. Public recognition is opt-in. The implementation is in review and is not yet deployed. See [the contributor-recognition design](docs/contributor-recognition.md) and [the delivery plan](PLAN.md#next-community-slice-contributor-recognition-and-github-linking-implementation-in-review-2026-11-04). This track is not part of the current v0 desktop/lab release gates.

**Proposed community extension (2026-11-06; planning only):** reduce the installation barrier with one browser-playable challenge and social recognition for both accepted task creators and participants. Retain the Go/MongoDB backend, Astro website and TypeScript task engine. The [development flow](docs/social-rewards-development-flow.md) defines discovery, phased scope, evidence/consent boundaries, schemas, API proposals, reward accounting and review gates; the [UX plan](docs/social-rewards-ux-flow.md) defines screen wireframes. Browser execution is new work: the existing lab grader is not a reviewed hostile multi-tenant service. Client-reported practice results cannot establish verified skill. XP cannot grant inference credit or administrative access; public sharing remains explicit. Review technical design and MVP scope before implementation.

**Synthetic experience checkpoint (2026-11-07):** the website implements the D1 browser prototype at `/challenges/delivery-fee/`, with scripted suggestions, fixture checks, approved fixed code snapshots, retry/results, local opt-in saving and a private sharing preview. Disclosures identify it as simulated before entry and at the result. It does not execute Python, contact a model/backend, claim account ownership, grant XP or publish a verified achievement. Real hosted execution and account/reward services remain unimplemented by this slice.

**Community foundation checkpoint (2026-11-07):** optional Go/MongoDB membership/privacy and browser-safe challenge projection are implemented separately from the synthetic demo. The current email principal reuses its contributor profile identity, independent of model credit. Private collection preferences are explicit, policy-versioned, stale-write protected and audited; collection remains inactive. Reviewed hosted packs can be projected through a separate administrator API into draft/open/closed read-only challenge definitions. Public responses include an explicit selection of workspace text rather than the archive/hidden checks; closing a challenge or disabling its source removes future public access. The frontend supports account controls and public catalog/detail browsing. New routes are disabled by default with `COMMUNITY_ENABLED`. There is no public executor, server-owned participation/claim, XP ledger or skill-verification feature in this foundation. The backend's `docs/community.openapi.json` documents implemented contracts; execution and reward contracts in the wider plan remain proposals.

**Browser draft checkpoint (2026-11-07):** the community website now optionally supports private server-owned starter copies at `/challenges/attempt/?id=...`, with explicit revisioned saves, browser-bound anonymous access and a transactional claim to the existing verified email member. IDs alone do not authorize reads; claimed drafts require the account owner, and claim grants no model credit, privilege or XP. Anonymous retention is at most 24 hours; account drafts are kept up to 90 days and can be deleted sooner. Source clearing retains a short tombstone to prevent creation replay from restoring deleted code. The feature defaults off with `BROWSER_ATTEMPTS_ENABLED` and requires community enablement. This is storage/ownership, not public execution, grading, immutable submissions or rewards; the original synthetic demo remains separate.

**Private browser execution checkpoint (2026-11-07):** a disabled TypeScript engine worker now accepts one protocol-validated immutable snapshot/public-check job over private stdin and returns bounded, image-pinned practice feedback after isolated Docker execution. It has no public listener or native fallback. Go-backed job admission, leases/quotas and browser Run checks are still pending; saved browser drafts cannot run it yet. Public tests share the student interpreter and provide no trusted grade. All results explicitly set `rewardEligible: false`; hidden grading and rewards remain separate work. See [worker boundary and verification](docs/browser-check-worker.md).

**Browser check queue checkpoint (2026-11-07):** Go/MongoDB now optionally captures immutable saved draft revisions, pins reviewed public checks/images, enforces finite pilot quotas and leases private TypeScript workers through a separate authenticated listener. Astro can Run checks, restore private revision-labelled feedback and cancel work. Deletion scrubs copied job inputs/results, and cancellation holds capacity until cleanup acknowledgement or lease expiry. Flags default off. A real browser→Go→MongoDB→worker→Docker journey passes, but public hostile-multitenant review, guided AI, trusted submissions and rewards remain open. All results stay practice-only and reward-ineligible. See [worker integration](docs/browser-check-worker.md).

**Guided private practice checkpoint (2026-11-07):** an additional disabled Go flag enables reviewed authored goals/examples/hints and immutable private finishes tied to current saved code and completed public checks. The website now shows a result with creator credit, prior-submission progress and a snapshot viewer; editing, account claim and deletion preserve the intended ownership/retention boundaries. Real Docker/SMTP browser verification passes. Hint reveals are page-local and no model/analytics call, public achievement or XP is added. Public-check evidence remains practice-only; tamper-resistant grading, public rollout and reward accounting remain open. See the sibling backend `docs/practice.md`.

**Open**
- the app
- the engine
- the server
- the harness
- the profiles and tool adapters
- the mutation operators
- the public practice packs

**Private**
- assessment packs
- the per-deployment judge prompt
- API keys

**Notes**
- **Rotate trial targets each semester.** Knowing that an operator exists doesn't reveal where it will fire.
- **Target server-backed lab/hosted boundary.** Clients never see keys or trial definitions, and their session token only works through the gateway. They can fake client-side events, so those count only as flags. The current solo preview keeps hidden checks and the ledger on the user's disk and produces unverified practice results.
- **Licence: Apache-2.0, provisionally** (see `LICENSE` and `NOTICE`).
  - **Why:** it is permissive, which helps universities adopt it. It includes a patent grant. It is also compatible with what we build on: Theia (EPL-2.0), OpenCode (MIT) and Codex (Apache-2.0).
  - **Changing it later:** we can switch freely while we hold all the copyright. Once outside contributions are merged, relicensing needs every contributor's consent. So **don't merge outside contributions without a CLA until the licence is final**. AGPL-3.0 on the engine remains the option if the hosted product needs protection from closed forks.

---

## 12. v0 scope and rough effort

> **Delivery order, release phases and compatibility rules are in [PLAN.md](PLAN.md).**

**In scope**
- Solo and lab modes on all three operating systems.
- The core (§3.6).
- ACP agent pane.
- Profiles: **factoryze** (harness) and **one external profile**. I suggest OpenCode: it is MIT-licensed, works with any model, and has native ACP. Codex and Claude Code profiles follow in v0.x.
- Modules: judge, trials, scoring, light integrity, and the benchmark CLI.
- Python tasks: 2–3, each with trials.
- Packs: one public practice pack and one sample private pack.
- Instructor tools: CLI, live table, CSV export and reports.

**Harness effort.** Rough estimates for one experienced developer **[A]**:

| Work | Estimate |
|---|---|
| Loop, streaming, interrupt, provider layer | 3–4 days |
| Tools, including edit matching and robust Bash/PowerShell execution | 4–6 days |
| Permission rules and the ACP shim | 3–4 days |
| Context management | 2–3 days |
| Prompt tuning against the benchmark | 3–5 days |

The **ACP pane and gateway endpoints** are needed for any profile. They add about 1–2 weeks, but they are shared work, not harness work.

---

## 13. First milestone: spike (4–5 days)

**Historical original scope.** The OpenCode-first rollout was superseded by the early Factoryze-only solo implementation. Current completed foundations, remaining manual checks and deferred protocol/trial/parity gates are tracked in PLAN; the original spike list below is not the active queue.

1. **Installers:** a branded Theia app with installers for all three operating systems.
2. **ACP pane + OpenCode:** the pane drives OpenCode over ACP, showing streamed text, tool calls and an edit approval with a diff. OpenCode's `baseURL` points at a stub gateway that meters tokens and rewrites one `edit` tool call. Check that OpenCode applies the rewritten version and keeps it in its history.
3. **Thin harness:** the engine loop with `read`, `grep`, `edit` and `shell` behind `factoryze-agent`, in the same pane. Verify that shell calls run through PowerShell on Windows. A `supply_chain` trial is approved, never dispatched, and gets scripted output back.
4. **Benchmark sample:** one task's expert prompts through both profiles on the same model. Compare success and tokens.

## 14. Open questions

1. **Pilot prerequisites.** Which partner lab and pilot date? These decisions are required before classroom rollout. The owner authorized starting the Phase 2 foundation before these decisions on 2026-10-29.
2. **Lab server OS.** Is the lab machine that will host the server running Linux, Windows or macOS? Choose before deployment and the deferred Docker setup; the first foundation uses portable Node APIs.
3. **Grade export.** Is CSV enough, or is an LMS-specific format needed?
4. **Claude Code.** Is "user or IT installs it" acceptable? It can't be bundled in an open-source distribution.
5. **Windows terminal.** Should the integrated terminal default to PowerShell to match the agent? It currently uses Command Prompt; PLAN Immediate 1f records the open usability decision and separate need to measure model shell compatibility.

**Resolved:**
- **Licence:** Apache-2.0, provisionally.
- **Python:** already installed on the lab machines.
- **Lab server:** a LAN machine.
- **Code signing:** none for now.

## 15. Risks

- **External agents change fast, and so does ACP.** Mitigations: pin versions per semester, keep each profile's tool adapter versioned, and treat ACP v1 → v2 migration as profile work.
- **Gateway rewrites depend on each agent's tool schema.** A profile update can silently break trials. Mitigation: a CI check per profile in which a known trial fires and is applied.
- **External agents can be bypassed on a desktop.** For example, a student could start Claude Code with their own subscription outside our app. In labs, the proctor covers this. For hiring, use lockdown and remote-exec.
- **Harness quality.** Mitigations: benchmark mode against the other profiles, plus OpenCode's MIT-licensed prompts and matchers.
- **Agents act on real lab machines.** Mitigations: shell commands require approval, profiles are scoped to the workspace, students use standard OS accounts, and the §5.3 rules apply.
- **Unsigned installers.** macOS blocks the app until the user approves it, and it can't auto-update. Windows shows a SmartScreen warning. This is acceptable for installs done by lab IT and for an open-source preview. Revisit before a wide public release.
- **Everything else:** Goodhart effects, judge false positives, trial spoilers and privacy, as listed before.

---

[^code-performance]: **Future enhancement, still being worked out (2026-10-22).** Nothing here is scheduled or part of a release.

    **Proposed shape.**
    - **Task-defined only.** Performance is measured only when the task pack asks for it. Many tasks, such as an off-by-one bug, have no performance dimension. There is no universal efficiency score.
    - **Stated in the brief.** If speed counts, the brief says so (for example, "must handle 1M rows"). Students are never graded against a hidden criterion.
    - **Relative to a reference.** The grader times the reference solution and the student's code back to back in the same run, and reports a ratio (for example, "2.1× reference"). Raw times aren't comparable across machines.
    - **Scaling and memory, not just stopwatch times.** Running at n and 10n separates linear from quadratic solutions even on slow hardware. Peak memory (`tracemalloc`) is close to deterministic.
    - **Reported separately, off by default.** Performance gets its own report line and is never counted as a correctness check. Folding it into the score is a later, optional module that starts disabled.
    - **Not static quality metrics.** Line counts and complexity scores are easy to game and only weakly tied to quality.
    - **Worth trying alongside:** lines changed compared with the reference fix. On a bug-fix task this shows whether the student let the agent rewrite the file or steered it to a small fix. Shown on the report, not scored.

    **Current limits and progress.** Writing a timing assertion as a hidden test is not enough for performance measurement:
    1. **Per-check timeouts implemented and automatically verified on all three OSes (PLAN Immediate 1a).** Discovery and each public/hidden check run in separate Python processes, with a 10-second process limit and a 120-second execution cap for the run. Timeouts produce named failed checks, later checks continue while time remains, and Submit saves the report. Import failures/timeouts are named by file. These regressions are included in the recorded 176-test/typecheck pass; this does not add performance scoring or clear the remaining manual release gates.
    2. A check is only passed or failed, so a correct but slow solution would read as "1 of 2 checks passed". Checks need a kind (correctness or performance) for the report, the score and Home's best result.
    3. A check has a message only when it fails, so a passing check can't show its measured ratio. This needs an optional measured value on the check (an additive protocol change).
    4. Hidden tests can't import a reference solution without editing Python's import path, and a reference module could clash with the student's module names. The task pack needs a place for it.
    5. Student code runs in the same process as the checks and could patch the clock. Graded performance checks should run in their own process, ideally on the lab server.
    6. Solo grading shares the machine with the editor and agent. Repeated runs (best of several) reduce the noise.

    **Suggested order.** Item 1 is implemented locally and still needs the release gates. Items 2–4 are the feature itself and are all additive. Items 5–6 belong with lab mode.

**Private pilot deployment boundary (2026-11-07):** deployment packaging keeps the existing Go backend and creates an independent Compose project/database volume. The public website origin is `https://code.factoryze.tech`; host TLS cutover is a separate operator step. MongoDB requires authentication; the API gets only a database-scoped application URI, never administrative credentials. A private sidecar with client-certificate verification reaches Go's loopback worker listener; the bearer check remains mandatory. The host controller is bundled for Node 22, owns its local Docker daemon/state and exports passive health without consuming jobs. Paid model trials stay disabled. Pinned-image rollback preserves current secrets/data. Backups are private gzip archives requiring separate encryption/off-host retention. These are private-pilot deployment controls, not evidence of trusted grading, XP eligibility, public multitenant safety or desktop installer readiness. See [deployment runbook](../factoryze-setup/staging/README.md).
