# Real Docker grading checks on macOS — 2026-10-29

Request: “Run Docker checks,” then “Yes, enable it” for Docker's default seccomp profile, then “record it.” The source under test is `feature/lab-pilot` at `d1a5d7b`; no grading code changed.

Host: macOS 27.0.1 on Apple M1 Pro, Docker Desktop 4.41.2 (engine 28.1.1, linux/arm64, cgroup v2). See `setup.json`.

**Result: the real Docker checks pass.** `pnpm docker:check` exits 0 with 26 containers started and none left behind. The grader image `sha256:e79d20d59afa6a184267756ad3c87000efcb9ec031ad2471b853c5f6d9100e4d` (Python 3.13.18) was built twice with the same ID. The receipt confirms UID 10000, no provider key, Docker socket or host file inside the container, blocked network, read-only root and inputs, contained time/output/memory/PID abuse, Library fines starter 5/9 and fixed 9/9, and private queue/release/CSV. The deterministic suite also passes on macOS: **234/234 tests, zero skips**, and typecheck.

Initial failure, retained in `seccomp-red.log`: Docker Desktop's engine reported its default seccomp profile as `unconfined`, and an ordinary container showed `Seccomp: 0`. The grader correctly refused at the isolation self-check with zero containers. `~/.docker/daemon.json` had no seccomp key, so this is Docker Desktop's own default. With the owner's approval, `"seccomp-profile": "builtin"` was added and Docker Desktop restarted; containers then show `Seccomp: 2`. Other running containers restarted healthy.

A first macOS test run failed three lab TLS tests because `openssl` on PATH is Anaconda's OpenSSL 1.1.1u; the server needs OpenSSL 3. That run was stopped and its log overwritten. The recorded run sets `FACTORYZE_OPENSSL` to Homebrew's OpenSSL 3.6.5.

This proves the container boundary on linux/arm64 only. The Ubuntu workflow and Windows Docker Desktop (linux/amd64) remain unverified. Grading stays off by default; no lab server ran with it enabled and no real desktop submission was graded. No paid model calls, email, merge, push or release occurred. Classroom, cross-OS, measurement and human-review gates remain open.
