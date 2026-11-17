# Known issues

Problems found while testing that still need a fix. Add new ones at the top of **Open**; move an item to **Fixed** with its commit when it lands.

## Open

### Lab prompt box says "Connect a model" when the lab agent is off
*Found 2026-11-01.*

With the agent off for a lab, the agent panel explains why, but the prompt box placeholder still reads "Connect a model to send prompts", which is solo wording. It should match the lab notice.

### Lab turns stop when one reply reaches the output cap
*Found 2026-11-01, two-machine lab with DeepSeek and `FACTORYZE_LAB_MAX_OUTPUT_TOKENS=4096`.*

Two of seven turns ended with `max_tokens` because a single reply used all 4,096 output tokens, so the student had to prompt again. The server default is 1,024, which would hit this sooner.

- **Expected:** a graceful continuation or a clear "the reply was cut off; ask for a smaller step" message, and a lab default that fits the pinned model. This is PLAN's harness Step 2 "graceful step limit" candidate; measure before changing harness behaviour.

### A lab turn failed right after an approved command, with no recorded cause
*Found 2026-11-01, two-machine lab.*

One turn ended as `failed` immediately after a command approved on the Windows PC completed. It had made 9 model requests (below the 16-step limit) and the provider returned no error. The server records only the generic failure, and the student saw "could not complete this request".

- **Next:** capture the desktop's agent log when this recurs. Since `dfd5384` the server logs a `lab_agent_failed` line with a failure code, which narrows this down.

### `smoke:lab` cannot run unattended on macOS
*Found 2026-10-29.*

The script stores a test key with Node `keytar`; when the development Electron app then reads it, macOS shows a keychain permission dialog and Home stays on "Checking model…" until the 60-second timeout. It passes on Windows.

- **Expected:** a macOS smoke that does not depend on a cross-process keychain item, for example an isolated keychain or skipping the BYOK-preservation step on macOS.

### App build fails when Electron's default cache is not writable
*Found 2026-10-29 on a Mac whose `~/Library/Caches/electron` is owned by root.*

`theia rebuild:electron` replaces ffmpeg through `@electron/get` without passing a cache root, so it ignores `electron_config_cache` and fails with `EACCES`. Workaround: run `pnpm build:app` with `HOME` pointed at a writable folder, or fix the folder's ownership.

## Fixed

### Agent panel jumped to the bottom while the agent was working
*Fixed in `dfd5384` (2026-11-01). Reported during the two-machine lab.*

The log now follows new output only while the reader is at the bottom; scrolling up shows **Jump to latest**, and sending a prompt always returns to the end. The decision lives in `followsOutput()` in `flow-model.ts`, with tests. Not yet checked by hand against a long streaming reply.

### Lab agent hid why a request failed
*Fixed in `dfd5384` (2026-11-01).*

Failed lab turns now give students a fixed reason per failure type: provider refused (tell your instructor), provider busy (try again), budget or accounting, and harness limits. The server logs `{"event":"lab_agent_failed","lab":…,"studentId":…,"code":…}` on stderr for the instructor. Upstream error text still never reaches students.

### "Lab agent unavailable" gave no reason, and Reconnect seemed to do nothing
*Fixed in `dfd5384` (2026-11-01).*

The agent panel now says why: the agent is off for this lab, the lab is closed, or the server cannot be reached, and that editing, tests and submission still work. The Lab connection dialog shows the same reason and "Checked at …", so Reconnect visibly updates. Checked in the real app against a lab server with inference off.

### Lab token meter only updated when a turn ended
*Fixed in `0675c06` (2026-11-01); the lab server needs a restart to pick it up, and the desktop app needs no update.*

Mid-prompt usage events carried the server's workspace path, which never matches the student's local folder, so the desktop meter ignored them. The server now sends account totals without a path, as the end-of-turn update already did.

### Lab results counted as practice results
*Fixed in PR #4 (`67aaedf`, 2026-10-29).*

A graded lab attempt showed as the solo task's "Best result", and Start could offer to resume a lab attempt.
