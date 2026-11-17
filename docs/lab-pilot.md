# Phase 2 lab pilot

The lab software is implemented on `main`. Students join from the desktop, receive public task files, use the server agent with approved local tools, synchronize files and submit immutable snapshots. Reports appear after instructor release. The server owns credentials, budgets and observed provider usage. Solo BYOK and sponsored trial credits remain available separately.

**Docker grading is opt-in and off by default.** The executor/grader and private retry/status/release/CSV integration are implemented. Real container checks passed on macOS/arm64 and Ubuntu/amd64, and an owner-driven two-machine LAN run graded a submission on the macOS server. Windows Docker grading and the ten-machine classroom pilot remain unverified; this is not a 0.2 release. No student code executes natively on the lab host. [Docker setup and remaining checks](docker-grading.md).

## Server setup

Use the repository's Node/pnpm prerequisites, Python 3.11+ on students' machines, and **OpenSSL 3** for provisioning/tests. Put OpenSSL on PATH or set `FACTORYZE_OPENSSL`. Protect the server directory with OS permissions; POSIX modes do not configure Windows ACLs.

```sh
pnpm install --frozen-lockfile
pnpm factoryze server init --data .factoryze-lab --url https://localhost:9443
pnpm factoryze server serve --data .factoryze-lab
```

Default inference and grading are disabled. Enable grading separately only after the [Docker checks](docker-grading.md) pass. For LAN use, initialize with the actual server DNS name/static IP and port, pass `--host 0.0.0.0` to serve, and allow that HTTPS port through the server firewall for the lab's private network. Student machines must resolve/reach the exact configured hostname/IP. Init refuses an existing directory and never rotates a live identity. One process owns each state directory through an exclusive lock. Back up the entire stopped server directory, including TLS identity, private session seed and SQLite files.

To enable inference, set these **only in the server process environment**, then restart:

| Variable | Meaning |
|---|---|
| `FACTORYZE_LAB_INFERENCE` | Explicit opt-in: `1` |
| `FACTORYZE_LAB_PROVIDER_URL` | Provider API base URL |
| `FACTORYZE_LAB_PROVIDER_KEY` | Private upstream credential |
| `FACTORYZE_LAB_MODEL` | Exact model ID pinned in lab config |
| `FACTORYZE_LAB_MODEL_API` | `openai-chat` (default) or `anthropic-messages` |
| `FACTORYZE_LAB_CONTEXT_WINDOW` | Default `32768` |
| `FACTORYZE_LAB_MAX_OUTPUT_TOKENS` | Default `1024`, below context limit |

No .env or existing solo/trial credential is loaded automatically. Paid tests require separate owner approval and a limit. Health reports inference, grading and package capabilities.

## Instructor operations

Copy/edit `packages/server/examples/lab.json`: unique lab ID, roster, task, duration, token limit/weights, exact Factoryze profile/model and provider hostname. Temperature must be zero and edits/commands must require approval. `serve --tasks TASK_ROOT` selects the server-owned task collection; the default is the repository practice tasks. Public files and hidden checks freeze at creation.

The default practice tasks, their hidden checks, and benchmark references are in this repository and can be read by anyone with its source or installer. Use them only for demonstrations and unverified practice. For a controlled graded lab, keep the assessment pack outside this repository and its Git history, set `--tasks` to that private collection, and check that the lab config names the intended task before creating the lab. Do not publish that private pack or its grading receipts with the public source.

```sh
pnpm factoryze lab create --data .factoryze-lab --config lab.json
pnpm factoryze lab watch cs201 --data .factoryze-lab --once
pnpm factoryze lab watch cs201 --data .factoryze-lab
pnpm factoryze lab integrity cs201 --data .factoryze-lab
pnpm factoryze lab reset cs201 --student s001 --data .factoryze-lab
pnpm factoryze lab reconcile cs201 --student s001 --record reconciliation.json --data .factoryze-lab
pnpm factoryze lab close cs201 --data .factoryze-lab
pnpm factoryze lab grades cs201 --data .factoryze-lab
pnpm factoryze lab grade cs201 --data .factoryze-lab
pnpm factoryze lab release cs201 --data .factoryze-lab
pnpm factoryze lab export cs201 --data .factoryze-lab --out results.csv
```

Create returns a join code once. Watch prints JSON every two seconds; Ctrl+C stops it. Reset cancels the student's active session, revokes the old token and returns a private replacement while preserving identity, budget and snapshots. Deliver it only to the verified student; the desktop supports **Recovery token** sign-in. Reconciliation uses the existing protocol's audited measured/estimate/unknown record, never a silent usage reset. Instructor commands require the local operator credential; students cannot administer labs.

Close/deadline stops model work and freezes each joined student's latest synchronized files. Unsynchronized offline changes cannot reach the server. Identical final file snapshots are not automatically duplicated. Explicit submissions retain immutable files, usage, revision and hash. CSV contains roster/join status, pins, usage, remaining budget, accounting/lab state and released correctness/hash. Docker grades also record immutable grading image/runner/Python provenance in instructor status and image/Python in CSV. Correctness/hash stay blank until release. Existing exports are never overwritten.

**With grading disabled (the default), grade returns unavailable and release refuses queued snapshots.** Set `FACTORYZE_LAB_GRADING=1` and `FACTORYZE_LAB_GRADER_IMAGE` to the exact built image ID only after real Docker checks pass. Startup requires the local Linux engine and enforced isolation self-check; there is no native fallback. `lab grades` shows private jobs/provenance; `lab grade` retries failed jobs after the operator fixes Docker. A lab pins its first successful grading image.

## Student flow

1. On Home choose **Join a lab**, select the instructor's `client.json`, and enter lab ID, roster student ID and join code. No personal API key.
2. The app prepares a separate local task/venv in the existing attempt layout. The pinned model/budget use the normal toolbar/meter. Edits and commands use existing approval cards. Settings is a read-only lab connection view.
3. Files sync on changes and periodically. Edit locally during outages; reconnect before agent use or submission. Pending sync, join binding and submission IDs survive lost replies/restarts. Retries preserve identity and saved receipts. Revision conflicts fail closed. A replacement device requires instructor recovery.
4. Run public tests locally. Submit saves a synchronized snapshot receipt; grading is queued. Continue while open; later edits never change an earlier submission.
5. Restart opens Home. Continue resumes files/account/budget. **Refresh lab results** fetches released reports into Results with no suggestions or prompt scores.

Only public task files reach students. Mirrors accept 512 regular files, 1 MiB/file and 4 MiB total. Traversal, links/hardlinks, conflicting paths and hidden-test paths are rejected. Generated venv/cache files and .env files are excluded. Keep unrelated personal files outside the workspace. Model traffic goes through the server. A private desktop loopback proxy forwards pip requests over authenticated pinned TLS to the server's curated wheelhouse, without public-index fallback. Prefill `STATE/wheels` with permitted wheels before an offline lab.

Paste character counts/focus changes are buffered as **untrusted client flags**, not proof of misconduct. Clipboard contents are not stored. Server-observed usage cannot be reset/reported by clients. Missing usage blocks inference until instructor reconciliation.

## Trust and deployment

Distribute **only STATE/client.json** through trusted lab IT. It contains the HTTPS origin, public certificate and SHA-256 pin. Hostname/validity checks and exact pinning stay enabled. The self-signed path-length-zero trust anchor works with Node/OpenSSL and Electron/BoringSSL. Earlier foundation certificates used CA:FALSE; provision a fresh identity/config before using that draft with Electron. There is no deployed identity migration. Certificates last one year; reprovisioning is operator work.

Keep TLS keys, operator.json, session-seed and databases private. Desktop bearer tokens/recovery bindings use the OS credential store, outside editable task files. Shared join code plus roster ID provides admission control, not verified identity; use proctored checks/institution enrollment for graded use. Sessions remain readable until 24 hours after the original deadline; reset can extend recovery access. There is no public instructor signup. Web backend/frontend administration is unchanged.

Task/config/profile/model/weights freeze at creation; no auto-updater exists. IT must retain exact app/server builds and hashes for the semester. Draft protocol/profile compatibility is checked; the later full distributed ACP/harness handshake remains separate. Report OS pins describe the **server**; independently verified student OS/proctoring evidence requires deployment records.

## Checks and remaining gates

`pnpm lab:load` runs 60 functional desktop-backend clients against loopback TLS/SQLite and a hardcoded synthetic provider. The recorded run completed 120 model requests, 60 read-tool round trips and 60 distinct snapshots with separate usage. One host/no paid calls: this is not provider capacity, hardware sizing or a ten-machine dry run. `pnpm --filter @factoryze/app smoke:lab` checks native Electron; `smoke:installer` checks both solo and lab on the installed app.

[Completion audit](verification/2026-10-29-lab-completion/checks.json) retains checks and initial failures; [foundation audit](verification/2026-10-29-lab-foundation/checks.json) is history.

Remaining gates: finish Windows firmware/WSL/Docker setup and pass real grading checks before enabling it; choose server/student OS and book lab/date; verify macOS/Linux installers and actual LAN; dry-run ten real machines; validate the task with the instructor; approve/run pinned expert/naive measurements and record current baselines; complete pilot, accept CSV and seed re-score corpus. Authentication, permissions, keys and database changes require recorded human review before merge. Existing 0.1 release gates remain open separately.
