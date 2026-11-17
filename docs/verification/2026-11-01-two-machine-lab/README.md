# Two-machine lab on a real network — 2026-11-01

First lab run across two machines, with a real model. The owner drove the student machine; no classroom, roster or real students.

## Setup

- **Server:** the owner's Mac (macOS 27.0.1, Apple M1 Pro) at a private LAN address (redacted), running `pnpm factoryze server serve --host 0.0.0.0` from `main` plus the meter fix below. Fresh identity initialised with a certificate SAN matching that private address. Docker grading on (Docker Desktop 4.41.2, builtin seccomp, image `sha256:e79d20d5…`).
- **Inference:** OpenRouter, `deepseek/deepseek-v4.1-flash-1017`, `FACTORYZE_LAB_MAX_OUTPUT_TOKENS=4096`, key with a US$2 limit held only in the server environment.
- **Student:** a separate Windows PC on the same network with the Windows installer from the manual [Installers run 41265488148](https://github.com/33sakib33/Factoryze/actions/runs/41265488148) on `main` (`7092505`; tests, packaging and installed smoke passed). `client.json` was copied by downloading it from a temporary HTTP share that contained only that file.
- **Labs:** `lan-test` (agent off) and `lan-agent` (agent on, 100,000-token budget per student, roster `s001`–`s003`), both on Library fines.

## Result

**The full lab flow works across two machines.** s001 joined both labs from Windows with the pinned configuration, used the server agent with local approvals, submitted, and saw the released report after Refresh lab results.

| | |
|---|---|
| Correctness | **9 of 9** hidden checks, graded in Docker (Python 3.13.18) |
| Weighted tokens | 57,729 of 100,000 (input 107,190; output 22,271; cache reads 79,702) |
| Model requests | 32: 30 complete, 2 rejected by the provider |
| Turns | 7 prompts; 13 approvals (edits and commands) |
| Provider spend | **US$0.007** on OpenRouter |

`lan-agent-results.csv` is the instructor export; `lan-agent-grades.json` holds grading provenance; `lan-agent-overview.json` is the closed lab (internal user IDs removed).

## Problems found

1. **Provider rejections looked like a generic failure.** The first key's OpenRouter workspace guardrails excluded every provider for every model tried. The student saw only "could not complete this request" and the server logged nothing; the reason came from querying OpenRouter directly. A new key without guardrails worked. Recorded in [ISSUES.md](../../../ISSUES.md).
2. **The token meter only updated at the end of a turn.** Mid-turn usage events carried the server's workspace path, which the desktop rejected. Fixed in `0675c06` and applied by restarting the server; the Windows app was not reinstalled.
3. **"Lab agent unavailable" with no reason** while `lan-test` ran without inference; Reconnect showed no change. Recorded in ISSUES.md.
4. **The agent panel forces scrolling to the bottom while streaming.** Reported by the owner; recorded in ISSUES.md.
5. **Two turns ended at the 4,096-token output cap** (a single DeepSeek reply of 4,096 output tokens), so the student had to prompt again.
6. **One turn ended as "failed" right after an approved command completed,** with 9 model requests (below the 16-step limit) and no provider error. The server records only the generic failure; the cause is unknown without the client's view.

## Not covered

One student machine, not ten; a single network; no instructor other than the owner; Windows Docker grading not involved (the server is the Mac). The meter fix passes its server test, but live per-request updates have not yet been confirmed on the Windows PC.
