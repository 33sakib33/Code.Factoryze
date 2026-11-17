# Private browser check worker

Implemented 2026-11-07 as D4 private-pilot execution components. The original one-shot controller remains available. The Go backend now admits durable check jobs through a separate authenticated worker listener, and Astro can run saved drafts, poll/restore private results and cancel work when the feature is enabled. No model request, trusted submission grade or XP grant is added. Execution defaults off and is not publicly deployed.

The private controller accepts one immutable job on stdin, discovers reviewed public tests and runs each check in a fresh container using the existing `DockerExecutor`. Jobs and results use the unreleased schemas in `packages/protocol/src/browser-checks.ts`. TypeScript owns execution; Go/MongoDB will own job admission, ownership, quotas and leases.

## Operator setup

Use the repository's Node 22/pnpm toolchain and a local Linux Docker engine with the required seccomp and cgroup controls. Build the trusted digest-pinned image and run both verification scripts on the worker host:

```sh
pnpm docker:build
pnpm docker:check
pnpm browser:check
```

`dist/docker-grader-image.txt` contains the immutable image ID for that host. Nothing enables the worker automatically. The private one-shot command requires:

- `FACTORYZE_BROWSER_CHECKS=1` (default disabled).
- `FACTORYZE_BROWSER_GRADER_IMAGE`: that exact immutable `sha256:…` ID. The job must pin the same image.
- `FACTORYZE_BROWSER_WORKER_STATE`: an absolute path to a dedicated private controller state directory. Never reuse lab state or give two concurrent controllers the same directory.
- Optional `FACTORYZE_DOCKER_COMMAND`: trusted operator Docker executable.

Supply a validated job over private stdin and close stdin:

```sh
node --experimental-strip-types packages/server/scripts/browser-check-worker.mjs < private-job.json
```

The raw command emits exactly one JSON result on stdout after execution. Exit 0 means completed feedback, including failed checks; exit 2 means an execution failure or cancellation with a result. Exit 1 means rejected input/configuration or failed executor initialization and emits only a generic stderr diagnostic. A shell/pnpm wrapper must preserve the raw JSON stream; normal pnpm script banners are not part of this protocol.

Stdin is limited to one UTF-8 JSON value, 3 MiB and a 30-second read deadline. The process takes the existing exclusive state lock before initializing Docker. The directory's canonical path determines a separate `browser-…` owner label, so startup reaps only that controller's interrupted containers. SIGINT/SIGTERM cancel active checks and await container cleanup. SIGKILL/host crashes require restart using the same directory to reap containers; interrupted temporary staging directories need operator cleanup under the existing executor policy. They are not a durable job store.

Run this controller on separate private worker capacity with no production credentials or database access. The public Go API must never receive the Docker socket. Student containers receive neither the socket nor controller credentials. The worker has no listener and no native-Python fallback.

## Job and result boundaries

The job pins job/attempt IDs, saved revision, source archive hash, image, minimum Python, selected editable text files, a separate reviewed public-check bundle and `inputHash`. The trusted producer must obtain the snapshot and checks from server-owned records and verify source eligibility. A matching hash proves consistency of those supplied bytes, not publication, authorization or task provenance by itself. Never forward browser-submitted jobs, tests, archive pins or results directly to this controller.

Files are limited to ten, 64 KiB each and 256 KiB total. Check files are separately limited to ten and 128 KiB total under `tests/**/test_*.py`. Paths reject traversal, hidden segments, Windows device names, directory/file collisions and case-insensitive duplicates; contents reject NUL and malformed Unicode. Neither shell commands, host paths, Docker parameters, network options, packages, timeouts nor scores can be supplied by a job.

Discovery must return 1–20 unique allowlisted test functions. Each uses the fixed Python runner command, up to five seconds per container and a shared 60-second execution budget. Setup/cleanup still has bounded executor overhead. Existing container limits include no network, non-root UID, read-only root/input mounts, dropped capabilities, no new privileges, seccomp, 256 MiB/no swap, one CPU, 64 PIDs, bounded tmpfs and 64 KiB output. See [Docker grading](docker-grading.md) for the implementation and review limits.

Results bind the job/attempt/revision/input hash and include executor/image/Python provenance. Only bounded test names and enumerated outcomes leave the worker; source code, raw stdout, stack traces and daemon diagnostics do not. The inner Python controller sometimes reduces timeout/output errors to a generic `did_not_pass`; these are feedback outcomes, not precise fault attribution. Infrastructure/cleanup failures return `failed` with zero recorded checks, and cancellation returns `cancelled`. Consumers must check status before displaying counts.

Every result is `trust: "practice"` and `rewardEligible: false`, including a perfect result. Public checks share a Python interpreter with student code and can be manipulated. Container resource containment does not establish trustworthy grading or hostile multi-tenant security. Hidden tests, tamper-resistant grading and reward eligibility require separate design/review; no reward consumer should accept this result type.

## Go queue controller

`packages/server/scripts/browser-queue-worker.mjs` uses the same executor/checker in a persistent, exclusively locked controller. It polls the private Go listener, validates protocol-owned leases and executes one job at a time. In addition to the image/state/enable variables above, set `FACTORYZE_BROWSER_WORKER_URL` and `FACTORYZE_BROWSER_WORKER_TOKEN` (64 lowercase random hex characters matching Go). The URL must be an HTTPS origin, except loopback HTTP for local verification. Redirects are refused; requests/responses have size/time limits. This process needs no database access or whole task pack.

Run `pnpm browser:queue-worker`, or invoke the script directly with Node's `--experimental-strip-types`. It heartbeats every three seconds and aborts active code on lease/network loss or SIGTERM. It waits for cleanup before submitting bounded feedback and retries identical result delivery after a lost response. A cleanup/infrastructure failure quarantines the controller with a nonzero exit; operator recovery uses the same state directory to reap only its own containers. The Go queue keeps a cancelled execution lane occupied until cleanup acknowledgement or lease expiry.

Go admission owns current draft ownership/expiry, saved revision, reviewed source/evaluator pins, quotas, global pilot capacity, immutable job snapshots, lease recovery and private result retention. It rejects stale or mismatched results and never treats this result type as reward evidence. The API has no Docker access. See the sibling backend's `docs/checks.md` and `docs/checks.openapi.json` for setup, routing, limits, retention and review boundaries. The worker wire schemas are still owned by `packages/protocol/src/browser-checks.ts`; Go's wire structs adapt these shapes. Revision zero is valid for an untouched starter.

## Cross-language input hash

Hash with SHA-256. For each field below, append its UTF-8 byte length as ASCII decimal, then `:`, then the exact UTF-8 bytes, without a newline or extra separator:

1. `factoryze-browser-public-v1`, `schema` as decimal, `kind`, `jobId`, `attemptId`, `revision` as decimal, `archiveHash`, `image`, `minimumPython`.
2. Editable-file count as decimal, then each path/content pair sorted by ASCII path ascending.
3. Public-check-file count as decimal, then each path/content pair sorted the same way.

Do not normalize content, newlines or Unicode; exclude `inputHash` itself. This framing avoids differences in Go/JavaScript JSON escaping. The deterministic test's revision-3 example hashes to `b795bc93c76feb920b6e1f51ce7d61dfb9b956ef7ed9c4b800f78e72d9ca0cf4`, independently checked with Python hashlib.

## Verification and remaining integration

The [2026-11-07 receipt](verification/2026-11-07-browser-worker/checks.json) records ten new deterministic cases, the full 257-test/typecheck pass, the real existing 26-container isolation probes, and real private-worker starter/fix, network/socket, timeout/output/memory, per-check freshness and running-container cancellation journeys on macOS arm64. All owned verification containers were removed. No paid model call, external email, public execution or XP occurred. Windows/Linux verification for this new boundary and public-service security/operational review remain open.

The subsequent queue integration passes 261 base tests/typecheck, Go MongoDB tests/vet, frontend regressions/build and a real browser → Go → MongoDB → private worker → Docker journey (starter 1/2, saved fix 2/2, reload, cancellation and deletion). Its receipts are in the sibling repositories' `verification/2026-11-07-check-jobs.json`. Private feedback is now wired; public hostile-multitenant review, measured operational capacity, Windows/Linux verification of this flow, guided AI, immutable trusted submissions and the reward outbox remain open.

## Host deployment bundle (2026-11-07)

For the private pilot at `code.factoryze.tech`, use the sibling setup repository's [deployment runbook](../../factoryze-setup/staging/README.md). Its build creates a standalone Node 22 worker bundle using `packages/server/scripts/build-browser-worker.mjs` and the pinned, isolated dependencies under `tools/browser-worker-build/`. It includes no desktop runtime or credentials. Verify the artifact manifest before installing it into a root-owned versioned host directory.

The controller accepts `FACTORYZE_BROWSER_WORKER_TOKEN_FILE` instead of a direct token (conflicting values fail), and requires all three `FACTORYZE_BROWSER_WORKER_CA_FILE`, `FACTORYZE_BROWSER_WORKER_CERT_FILE`, `FACTORYZE_BROWSER_WORKER_KEY_FILE` when private mutual TLS is configured. Native HTTPS verifies the issuer and server hostname, bounds responses/timeouts and does not follow redirects. For a deployed worker, require the TLS configuration and private network/firewall restrictions together. Loopback-only development remains available without TLS.

Set an absolute `FACTORYZE_BROWSER_WORKER_HEALTH_FILE` for passive readiness. Successful validated API contact atomically updates it, the health command checks freshness and a live process, and graceful shutdown marks it unready. `browser-worker-health.mjs` never claims a job. The Go private authenticated `GET /worker/health` pings its database and reports the configured immutable image; it is absent from the public router.

The supplied Linux systemd service keeps `PrivateTmp=false` so the host Docker daemon can access the exact staging paths. Use dedicated worker capacity with a local daemon; no API container gets a Docker socket. Docker group access is host privileged. Linux service installation, cross-host networking and public hostile multitenant approval remain operator/security gates; a local Docker Desktop test does not clear them.
