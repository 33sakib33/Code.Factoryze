# Docker grading checkpoint — 2026-10-29

Request: “do docker checks then.” The owner then authorized **install Docker and implement grading**, and said they would enable firmware virtualization after this checkpoint.

Implemented: shared bounded command executor; immutable image/local Linux engine/default seccomp/cgroup-v2 self-check; requested and inspected isolation settings; fresh-container Python discovery/checks; persistent lab grading/retry/status/release/CSV integration and image provenance; forward schema-2→3 artifact migration; image pinning per lab; explicit opt-in/no-native-fallback; pinned image build and real verification script; manual Linux CI workflow.

Deterministic tests use an explicit fake Docker command adapter. They prove orchestration/validation and error handling; they do **not** prove the kernel/container boundary. The HTTPS queue test uses that synthetic grader and real TLS/SQLite. The Python runner was syntax-parsed on the host without executing student code. No paid inference or real email was used.

Local real-Docker result: **failed at preflight, zero containers started**. Docker is not installed. Windows 10 Pro build 19045 reports virtualization disabled and no hypervisor. The old inbox WSL does not report a modern version. Winget per-user installation returned “No applicable installer found” (exit -1978335216). Automatic approval review rejected the official-installer command containing checksum/signature validation with “blocked by policy”; that command did not execute. No download, alternative installation route, firmware change, elevation or restart followed the rejection. User action is required for setup.

`checks.json` records the checkpoint, normalized source hashes and exact evidence hashes. `docker-check.log` and the copied real check receipt must remain failures until real Docker runs successfully. No grading image was built here. `setup.json` captures the environment. Initial missing-module, missing-retry, configuration-inspection and unenforced-cgroup red logs are retained alongside passing deterministic results.

Follow [the setup guide](../../docker-grading.md), then run `pnpm docker:build` and `pnpm docker:check`. Real proof covers the kernel policy and resources, network/filesystem restrictions, abuse containment, current task correctness, private release/CSV and cleanup. CI is prepared but was not dispatched. No merge, push or release was performed. Existing cross-OS, actual-LAN, ten-machine, model-measurement, pilot and human-review gates stay open.
