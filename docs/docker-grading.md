# Docker grading setup and checks

The owner resumed Docker installation/grading on 2026-10-29. The isolated executor, Python image/controller, lab queue integration, retry/status/CSV provenance and verification scripts are implemented. **The real Docker checks pass on macOS** (Apple silicon, Docker Desktop, linux/arm64) as of 2026-10-29; see [Finish macOS setup](#finish-macos-setup). **On the owner's Windows PC they have not passed.** Docker is absent, Windows reports firmware virtualization disabled, and WSL is not ready. The per-user winget install found no applicable installer; automatic approval review rejected the signed-installer download/install command with “blocked by policy.” No installation workaround or restart was attempted. The owner will enable virtualization after the checkpoint.

## Finish macOS setup

Docker Desktop 4.41.2 on macOS ran containers **without a seccomp filter by default** (`docker info` showed `Profile: unconfined`), and the grader correctly refused. Open Docker Desktop → Settings → Docker Engine, add `"seccomp-profile": "builtin"` (or add it to `~/.docker/daemon.json`), then Apply & restart. `docker info` must show `Profile: builtin`. This applies Docker's standard filter to every container on that Mac.

The lab server's TLS setup needs OpenSSL 3. If `openssl version` reports 1.x (for example Anaconda's), set `FACTORYZE_OPENSSL` to OpenSSL 3, such as `/opt/homebrew/opt/openssl@3/bin/openssl`.

The image ID is architecture-specific: an Apple silicon build is linux/arm64. Build the image on the machine that will grade.

## Finish Windows setup

1. Save work, restart into BIOS/UEFI, and enable Intel Virtualization Technology/VT-x or AMD SVM. The processor reports SLAT support and this PC has 16 GiB RAM.
2. Install/update WSL 2 using an administrator terminal. `wsl --install --no-distribution` installs its prerequisites; follow any requested restart, then use `wsl --update`. `wsl --version` must show a current WSL version rather than the old inbox help screen.
3. Manually install/start Docker Desktop from the [official Windows instructions](https://docs.docker.com/desktop/setup/install/windows-install/), using the WSL 2 backend and Linux containers. The application installer was blocked in this agent session. Let Docker finish starting; `docker version` must include a working Linux server.
4. In a new terminal at the repository root, run the build/check commands below. `FACTORYZE_DOCKER_COMMAND` can point to the Docker CLI executable if it is not on PATH.

Docker's Windows guide requires firmware virtualization and WSL 2.1.5 or newer. It describes per-user installation and any administrator/Windows-feature setup required. The agent did not reboot this computer or change firmware settings.

## Build and verify

```sh
pnpm docker:build
pnpm docker:check
```

Build uses `packages/engine/docker/Dockerfile`, with the official Python 3.13 slim Bookworm **manifest digest pinned in source**. The tiny build context includes only Dockerfile and the trusted Python runner; it never includes server credentials, task files or the repository. There are no build-time dependency installers. The build writes the resulting immutable local image ID to `dist/docker-grader-image.txt`. A mutable tag is never accepted by the runtime.

Check writes `dist/docker-grading-verification/checks.json` and exits nonzero on unavailable Docker or any failed check. It checks a real container's UID, capabilities, seccomp, no-new-privileges and cgroup-v2 limits; blocked network/root/input writes; absent Docker socket/host file/provider environment; timeout/output/memory/PID containment; real Library fines starter/fixed grading, queue/release/CSV; and zero owned containers left over. No model requests, real email or host execution of student code is involved. The starter must fail some hidden checks; the fixed submission must pass 9/9.

The manual **Docker grading** GitHub Actions workflow runs the same synthetic/no-provider flow on Ubuntu 24.04. It is manual-only and must exist on the default branch to be dispatched. [Run 40907143338](https://github.com/33sakib33/Factoryze/actions/runs/40907143338) on `main` passed on 2026-10-29: 234/234 tests, typecheck, image build and the real Docker check (starter 5/9, fixed 9/9, 26 containers, none left).

## Enable the lab grader

Only after the real checks pass, set the server process environment:

| Variable | Value |
|---|---|
| `FACTORYZE_LAB_GRADING` | `1` |
| `FACTORYZE_LAB_GRADER_IMAGE` | Exact `sha256:…` ID from `dist/docker-grader-image.txt` |
| `FACTORYZE_DOCKER_COMMAND` | Optional path to the Docker CLI |

Start the normal `pnpm factoryze server serve --data STATE` process. Grading is **off by default**, independent of inference. Startup requires a healthy local Linux Docker engine, default seccomp, cgroup v2 with enforced limits, the expected image label/ID, and a successful container self-check. No native fallback exists. The CLI holds its existing state lock while cleaning up only interrupted containers bearing that state's owner label.

Stop the server and back up the entire STATE directory before upgrading. Artifact schema 2 migrates forward to 3 atomically; the previous server cannot open the upgraded artifact database. Rollback requires the stopped-server backup. Existing snapshot hashes/files are preserved by the tested migration.

Submissions/close snapshots enter the existing persistent queue. The worker grades one snapshot at a time; each discovery/check gets a fresh disposable container. Reports remain private until the lab is closed and the instructor releases them.

```sh
pnpm factoryze lab grades LAB --data STATE
pnpm factoryze lab grade LAB --data STATE
pnpm factoryze lab release LAB --data STATE
pnpm factoryze lab export LAB --data STATE --out results.csv
```

Grades shows queued/grading/graded/failed jobs, revisions, hashes and image/Python/runner provenance. Grade explicitly retries failed jobs after the operator fixes Docker; background processing does not loop forever over failures. Student tokens are denied status/retry/release. Startup recovers interrupted grading jobs. A lab pins its first successful grading image; another image cannot execute later retries in that lab. Start a new lab for an image upgrade. Released CSV includes grading executor/image/Python; existing report JSON stays compatible with the desktop.

## Isolation policy and limits

Every command uses a local Unix socket or local Windows named pipe, a pinned Linux image, UID/GID 10000, no network/IPC, dropped capabilities, no-new-privileges, a read-only root and snapshot/check mounts, bounded no-exec tmpfs, one CPU, 256 MiB RAM with no swap, 64 PIDs, file/descriptor limits, and no persistent Docker log driver. Before starting a container the executor inspects the actual Docker configuration and refuses mismatches. The health probe also reads actual kernel policy/cgroup limits rather than trusting requested flags alone. Upstream keys, operator state, the Docker socket and host workspace are never mounted or forwarded.

Public files are copied into writable ephemeral container storage. Hidden tests are mounted read-only and stay on the server. Discovery parses trusted test source without importing student modules; plain top-level `test_…` functions run individually in fresh containers. Defaults are 10 seconds per discovery/check and 120 seconds per snapshot, including orchestration; remaining checks fail at the total deadline. Output is bounded. Daemon/configuration/cleanup failures leave a **failed job**, not an invented student grade. Timeout/output failures affect that check and later checks continue.

This image supports the current standard-library Python tasks. Third-party task dependencies require a deliberately rebuilt/pinned trusted image. Do not assume the student's venv can run in Linux.

Container isolation protects the host boundary; it is not a complete anti-cheating guarantee or a reviewed hostile multi-tenant service. Student Python shares an interpreter with each hidden test and determined code can inspect/alter that execution. The parent controller rejects incidental output/count forgery and early exits, but its nonce is not a security boundary against arbitrary Python introspection. Use proctoring and human review, and retain the real pilot/security gates. The assessment-trial framework remains disabled; no supply-chain trial payload was executed.

The shared command executor is groundwork for later sandboxed benchmark/agent tools. **`bench:variance --sandbox docker` and persistent agent-container integration are not implemented by this grading slice.** No paid measurements were run.

## Evidence

[macOS audit](verification/2026-10-29-macos-docker-grading/checks.json) records the **passing real-Docker check** (26 containers, starter 5/9, fixed 9/9, none left behind), the retained seccomp refusal and 234/234 macOS tests. [Windows audit](verification/2026-10-29-docker-grading/checks.json) separates deterministic unit/HTTPS checks from the **failed real-Docker preflight** on that machine. It retains the initial red tests, setup observations and policy rejection. The prior [non-Docker checkpoint](verification/2026-10-29-lab-completion/checks.json) remains historical evidence, not a Docker pass. The [end-to-end macOS lab audit](verification/2026-10-29-macos-lab-e2e/README.md) grades real desktop submissions on an enabled server. Windows Docker validation, human review and classroom gates remain open.
