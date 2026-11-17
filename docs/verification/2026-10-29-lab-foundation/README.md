# Phase 2 foundation audit — 2026-10-29

Owner request: start Phase 2 in a new branch in the desktop repository. Created `feature/lab-pilot` from `main` at `21dc2eff87782f38abc4b0690dddc431fa2a69ca`. The existing solo release gates stay open separately. Docker remains deferred; no paid calls, emails, public deployment, push or merge are part of this slice. A local checkpoint preserves the source and audit together.

## Implemented and verified

- Independent server workspace sharing the engine and protocol, with no new external package/version.
- Dedicated state initialization, self-signed TLS, public certificate/fingerprint configuration and a pinned Node client with normal hostname/certificate validation.
- Local-file instructor credential, restricted instructor API and CLI; no public instructor registration. Student tokens cannot administer labs or report their own usage.
- Unique-roster admission, hashed join codes/session tokens, separate durable student/lab accounts, immutable settings/budgets, saved-session reconnect and duplicate-claim refusal.
- Trusted internal metering using the existing ledger, serial dispatch with budget rechecks, incomplete-usage refusal, deadlines, closure and cancellation signals.
- Create/watch/close and usage-only CSV. Real HTTPS tests use two separate student clients. The CLI test launches the actual `server serve` subprocess and drives create/watch/close/export over HTTPS, stops that process, then reopens the database to verify closure persisted.

The first failing tests are retained in [initial-tests.log](initial-tests.log): both new test files failed because implementation modules did not exist. Final tests exercise real TLS certificates generated with OpenSSL and disposable SQLite databases/processes; these are not static UI mocks. Test-generated tokens/keys are not written into audit logs.

| Check | Result | Log |
| --- | --- | --- |
| Initial test-first run | 2 test-file failures, missing implementation | [initial-tests.log](initial-tests.log) |
| Engine admission/accounting/deadline checks | 4 passed at that stage | [engine-tests.log](engine-tests.log) |
| First HTTPS integration | 5 focused checks passed | [focused-tests.log](focused-tests.log) |
| Complete new contracts/engine/HTTPS/CLI coverage | 10/10 passed | [focused-tests-final.log](focused-tests-final.log) |
| Actual CLI serve subprocess refinement | 3/3 server tests passed | [cli-serve-tests.log](cli-serve-tests.log) |
| Complete suite, final source | **217/217, zero failures/skips** | [full-tests-final.log](full-tests-final.log) |
| TypeScript, final source | Passed | [typecheck-final.log](typecheck-final.log) |
| Frozen offline lockfile validation | Passed | [lockfile-check.log](lockfile-check.log) |
| Root CLI help | Passed | [cli-help.log](cli-help.log) |
| Workflow YAML and example configuration | Parsed/validated | [configuration-check.log](configuration-check.log) |

[checks.json](checks.json) records commands, environment, source hashes, log hashes, scope and remaining work. Earlier full/typecheck logs are retained alongside the final runs. Fresh macOS/Linux execution, CI and desktop build/installer smoke were not run for this new slice. The existing Windows desktop build/installer receipts remain dated 2026-10-28.

## Local dependency setup recovery

The working installation uses a custom pnpm store/virtual-store configuration. Normal noninteractive install attempts requested a modules-directory purge and aborted without removing modules. One retry also used an invalid pnpm option. All four unsuccessful attempts are retained as `workspace-install*.log`/`workspace-server-install.log`; they are setup failures, not passing checks.

Frozen offline lockfile validation passed with `--lockfile-only --offline --ignore-scripts --frozen-lockfile`. Only the new server's `node_modules/@factoryze/{engine,protocol}` workspace junctions were created, pointing to the existing packages, to preserve the current native app installation. No existing dependencies were purged, fetched or rebuilt. A normal clean setup uses the documented `pnpm install --frozen-lockfile`.

## Scope limits

This is the control/accounting foundation, not the completed Phase 2 classroom flow. Inference/grading are explicitly disabled. Task ID/model/provider pins are metadata until task delivery and dispatch are connected. No desktop Join lab, actual task download, server agent/client-tool bridge, mirror, snapshots, hidden grading, report release or classroom/load proof is claimed. The CSV contains no grades.

The shared join code and roster ID are admission control, not independent identity verification. Graded use still needs proctored/institution-backed identity, instructor token/device recovery and revocation, incomplete-accounting recovery, isolated grading, task measurement, review and pilot validation. POSIX private-directory modes do not configure Windows ACLs. Choose the pilot lab/date and server/student OS before rollout. [Next slices and setup](../../lab-pilot.md).

TLS and certificate provisioning were checked against the [Node TLS documentation](https://nodejs.org/docs/latest-v22.x/api/tls.html) and [OpenSSL req documentation](https://docs.openssl.org/3.0/man1/openssl-req/).
