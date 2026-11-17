# Factoryze: Spec (v0.6)

**Status:** draft, 2026-10-20. Items marked **[A]** are assumptions that still need confirming.

**Decisions so far**
- **Platforms:** a desktop app for Windows, macOS and Linux. It is not browser-based.
- **Three modes, one engine:**
  - **solo:** a single PC
  - **lab:** client-server, with a self-hosted lab server
  - **hosted:** we run the server
- **Open source.** Whoever runs the engine supplies the LLM key.
- **Pluggable agents.** The agent is a plug-in called an **agent profile**:
  - our own lightweight **Factoryze harness**
  - **OpenCode**
  - **Claude Code**
  - **Codex**

  Two standard seams make this work:
  - **ACP** (Agent Client Protocol) between the IDE and the agent.
  - **The engine's model gateway** between the agent and the LLM.
- **Per-profile measurement.** Budgets and baselines are set per **(task, profile@version, model)**.
- **One pinned profile per graded lab.** Practice can allow a choice.
- **Agent shell:** PowerShell on Windows; Bash on macOS and Linux. Windows agents do not require Git Bash.
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
| Engine runs | Inside the desktop app | Lab server (on the LAN or in the cloud) | Our cloud |
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

- **Seam 1: [ACP](https://agentclientprotocol.com/).** This open protocol plays the role for agents that LSP plays for language servers. Our agent pane is one ACP client that works with any agent. ACP covers streamed messages, tool calls tagged by kind (read, edit, search, execute and so on), diffs, plans and **permission requests**. Every permission decision passes through our pane, so we log it the same way for every agent. Current support:
  - OpenCode supports ACP natively.
  - Codex and Claude Code connect through ACP adapters.
  - Our own harness also speaks ACP.
- **Seam 2: the model gateway.** Every profile's base URL points at the engine. The agent gets a **session token** in place of an API key, and the gateway swaps it for the real key. One choke point then handles metering, the budget, trials and key custody, whichever agent is running.

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

### 3.4 The Factoryze harness (our reference profile)

**Shape:** the brain is in the engine and the hands are on the client.
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
4. The engine checks each call against its permission rules (allow, deny or ask). For "ask" it sends an ACP permission request, which shows as an approval card, with a Monaco diff for edits.
5. Approved calls are dispatched to the hands. Trial payloads are not dispatched; the engine returns scripted output instead.
6. Results are truncated and added to the context.
7. The loop repeats until no tool calls remain, the budget runs out, or the student presses **Stop**.

**Tools (v0).** These follow mainstream agents, so students build habits that transfer.

| Tool | Behaviour |
|---|---|
| `read` | Path plus offset/limit, line-numbered, with size caps |
| `glob` | File pattern match |
| `grep` | Regex search via ripgrep (bundled with Theia) |
| `edit` | `old_string` → `new_string`: exact match first, then a whitespace-tolerant fallback adapted from OpenCode (MIT). An ambiguous match is an error, so the model retries. |
| `write` | Writes a whole file |
| `shell` | Runs PowerShell on Windows and Bash on macOS/Linux; timeout; persistent working directory inside the workspace; output truncated to head and tail; no stdin; kills the whole process tree |
| `todo` | A task list held by the engine and shown in the pane |

**Context management**
- Tool output is capped.
- Prompt caching is used.
- At about 80% of the context window, older turns are compacted.
- A **New session** button starts fresh.

**Not in v0:** MCP, subagents, web fetch, plan mode. Feeding language-server diagnostics to the agent is planned for v1; Theia already runs Pyright.

**Improving it over time: benchmark mode.**
- Run each task's scripted expert and naive prompts through **every enabled profile** on the same model. This produces the baselines and a comparison table: tasks solved, tokens used, turns and time.
- A new harness version ships when it doesn't regress against its previous version, and when it solves what the reference profiles (OpenCode, Codex or Claude Code, depending on the model family) solve within about 1.5× their tokens **[A]**.

### 3.5 Client: Theia workbench

[Eclipse Theia](https://theia-ide.org/) provides a VS Code-like workbench and cross-platform Electron installers. We build it without Theia AI.

Our extensions:
- **factoryze-core:** launcher (solo setup or lab join), brief, timer, budget, event capture, pane config, lockdown.
- **factoryze-agent-pane:** the ACP client, approval cards, diffs, todos/plans, and process management for profiles.
- **factoryze-report:** the report view.

### 3.6 Core (ships in v0 and works with every module turned off)

| Part | Where | Responsibility |
|---|---|---|
| Workspace UI | Client | Explorer, editor, terminal and agent pane. Each can be toggled unless the config locks it. |
| Launcher | Client | Solo: task, key, profile and model. Lab: server URL, join code and student ID. |
| Workspace and runtime | Client | Writes `workspace/` to disk. Bundled `uv` sets up Python and a venv, with pip and uv pinned to the engine's package index. |
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

### 3.7 Module interface

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

**Judge enforcement.** The judge runs in the pane before a prompt reaches the agent. In labs, the gateway cross-checks: a model request that contains a user turn the judge never saw is flagged.

### 3.8 Module catalogue

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

| Mode | Behaviour | Use |
|---|---|---|
| `score` (default) | Every prompt gets a verdict, a reason and a specificity score. Nothing is blocked. | Graded labs |
| `block` | Vague prompts are rejected with a reason. The student rewrites, and the rejected attempt is logged. | Practice |

- **What it flags:** vague prompts, clone requests ("make me a copy of X"), handing over the whole task, and off-task prompts.
- **How it sees prompts:** with recent turns as context, and treated as data, not instructions. It returns structured output.
- **How it runs:** on a small model from the same provider. The prompt can be overridden per deployment.

---

## 5. Trials module

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
5. **Package traffic is pinned to the engine.** This covers the venv's pip config, the uv config, and the environment of both the agent and the terminal. Supply-chain trials fire only after the engine has confirmed this pinning.
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

- **Public practice packs** live in their own repo and are used in solo mode.
- **Private assessment packs** are owned by the institution and loaded only into a lab or hosted engine.

```
tasks/pagination-api/
  task.yaml          # title, brief (symptoms not causes), python version, time hint
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
    rules: [{ allow: "pytest*" }]

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

| Layer | Source | Notes |
|---|---|---|
| **Correctness** | Hidden tests and checks on the final mirror | Acts as a gate. |
| **Efficiency** | Weighted tokens and turns, measured against **the same profile@version and model's** baseline | Broken down using ACP tool kinds: prompt, exploration (read and search), generation and context. |
| **Specificity** | Judge scores | Weighted towards prompts that led to accepted edits. |
| **Verification** | Trial outcomes, tests run after accepted edits, time spent reviewing diffs, approval decisions | Only trials that fired, and only those the profile supported. |

**Comparing across profiles.** Efficiency is reported as a ratio to the profile's own baseline. That makes results roughly comparable across profiles, but not exactly. For example, some agents recover from vague prompts better than others. This is the reason graded labs pin a single profile.

---

## 9. Flows

**Solo**
1. Install the app.
2. Add a key (stored in the OS keychain).
3. Pick a profile and a model.
4. Pick a practice task.
5. Work on it.
6. Submit and read the report, which is marked **practice (unverified)**.

**Lab**
1. **Setup (IT).** IT installs the app, plus any user-installed profile such as Claude Code, and points it at the lab server.
2. **Create the lab (instructor).** The instructor puts the key on the server, runs `factoryze lab create lab.yaml`, and gets a join code.
3. **Students join.** The app launches the pinned profile with a session token.
4. **Monitor.** The instructor watches a live table: status, tokens against budget, trials fired and caught, and flags.
5. **Close and grade.** The instructor closes the lab, which auto-submits any open work. Grading runs, then the instructor exports the CSV and releases the reports.

---

## 10. Tech stack

| Part | Choice |
|---|---|
| Workbench | Eclipse Theia (Electron), without Theia AI |
| Installers | electron-builder: Windows (NSIS), macOS (universal DMG, signed and notarised), Linux (AppImage and deb), auto-updated with electron-updater |
| Agent seam | ACP via `@agentclientprotocol/sdk` (TypeScript), with the ACP version pinned |
| Agent shell | PowerShell on Windows; Bash on macOS and Linux. Profile adapters select the platform shell and preserve the permission policy. |
| Bundled profiles | `factoryze-agent`, OpenCode (MIT) and Codex (Apache-2.0) with its ACP adapter, all pinned binaries |
| User-installed profiles | Claude Code via `claude-agent-acp` |
| Harness | `factoryze-harness` (TypeScript). The loop runs in the engine and the hands in `factoryze-agent`. Prompts, tool descriptions and edit matching are adapted from OpenCode (MIT), with attribution. |
| Gateway | Provider-compatible endpoints, plus Vercel AI SDK for upstream providers **[A]** |
| Search, Python | ripgrep (bundled with Theia), `uv` |
| Engine | `factoryze-engine` (TypeScript), hosted in-app (solo), as `factoryze-server` (lab), or in our cloud (hosted) |
| Storage | SQLite for solo and lab; Postgres for hosted |
| Grader | Docker for lab and hosted; a local runner for solo |
| Trials | tree-sitter (TypeScript), plus a minimal PEP 503 package index |

---

## 11. Open source

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
- **A modified client gains little.** It never sees keys or trial definitions, and it can't bypass metering, because the session token only works through the gateway. It *can* fake client-side events, so those count only as flags.
- **Licence:** still to be decided (§14).

---

## 12. v0 scope and rough effort

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

1. **Installers:** a branded Theia app with installers for all three operating systems.
2. **ACP pane + OpenCode:** the pane drives OpenCode over ACP, showing streamed text, tool calls and an edit approval with a diff. OpenCode's `baseURL` points at a stub gateway that meters tokens and rewrites one `edit` tool call. Check that OpenCode applies the rewritten version and keeps it in its history.
3. **Thin harness:** the engine loop with `read`, `grep`, `edit` and `shell` behind `factoryze-agent`, in the same pane. Verify that shell calls run through PowerShell on Windows. A `supply_chain` trial is approved, never dispatched, and gets scripted output back.
4. **Benchmark sample:** one task's expert prompts through both profiles on the same model. Compare success and tokens.

## 14. Open questions

1. **Licence.** Apache-2.0 or MIT, for adoption? Or AGPL-3.0 on the engine, to protect the hosted offering?
2. **Python on lab machines.** Can `uv` download Python, or must Python be bundled because labs are offline?
3. **Lab server.** A LAN machine or a cloud VM? Remote-exec would need a much bigger one.
4. **Grade export.** Is CSV enough, or is an LMS-specific format needed?
5. **Code signing.** Who holds the certificates?
6. **Claude Code.** Is "user or IT installs it" acceptable? It can't be bundled in an open-source distribution.

## 15. Risks

- **External agents change fast, and so does ACP.** Mitigations: pin versions per semester, keep each profile's tool adapter versioned, and treat ACP v1 → v2 migration as profile work.
- **Gateway rewrites depend on each agent's tool schema.** A profile update can silently break trials. Mitigation: a CI check per profile in which a known trial fires and is applied.
- **External agents can be bypassed on a desktop.** For example, a student could start Claude Code with their own subscription outside our app. In labs, the proctor covers this. For hiring, use lockdown and remote-exec.
- **Harness quality.** Mitigations: benchmark mode against the other profiles, plus OpenCode's MIT-licensed prompts and matchers.
- **Agents act on real lab machines.** Mitigations: shell commands require approval, profiles are scoped to the workspace, students use standard OS accounts, and the §5.3 rules apply.
- **Everything else:** Goodhart effects, judge false positives, trial spoilers and privacy, as listed before.
