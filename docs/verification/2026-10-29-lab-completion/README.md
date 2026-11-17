# Non-Docker Phase 2 implementation — 2026-10-29

Owner request: finish Phase 2 and update progress. Subsequent answers explicitly keep Docker deferred and say the lab/date are not arranged. All work stays in the desktop repository on `feature/lab-pilot`; the separate website/backend repositories and their admin controls are unchanged. No real email, paid calls or model benchmarks were run.

`checks.json` is the final machine-readable index: source/evidence hashes, commands, receipts, initial failures and remaining gates. Text source hashes normalize CRLF to LF; evidence hashes preserve exact bytes. The enclosing Git commit identifies the checkpoint without a self-referential commit hash inside its own files.

## Delivered

- Public task delivery and per-student local attempts; hidden files stay on the server.
- Server-owned Factoryze harness/provider/metering with approved existing local read/edit/shell tools; no personal BYOK/trial fallback in lab sessions.
- Keychain credentials, pinned TLS, saved session/recovery binding, offline events, revisioned full mirrors and persistent retry IDs.
- Atomic local serialization of sync/submission, cached acknowledged receipts when refresh is offline, and recovery of an existing receipt after closure without accepting new late submissions.
- Immutable snapshots, deadline/close auto-submit, private persistent grade queue, instructor release/report/CSV integration, reset/reconciliation and untrusted paste/focus flags.
- Native desktop Join lab/read-only connection/submission/report flow using existing styles. Reports still omit suggestions and prompt scores.
- Repeatable 60-client functional simulation, native Electron lab smoke and installed solo+lab verification, wired into the manual installer workflow.
- IT/student guide, plan/spec/current-progress reconciliation and retained verification history.

## What the checks mean

The load fixture uses 60 actual desktop backend stores/services, TLS, SQLite, unchanged server harness and local read tools on **one host**. Its provider is hardcoded synthetic. It proves functional separation and concurrency, not real model throughput, DGX capacity or classroom hardware sizing.

The lab UI fixture uses a synthetic provider but real Python setup, local public tests, diff/command approvals, usage, submission, restart and report rendering. Its nine grading verdicts are **explicit synthetic fixture data**. The screenshot `lab-report-synthetic.png` is a rendering check, not evidence that a production lab grader ran. Production CLI grading remains unavailable; real submissions stay queued. Solo smoke runs its existing local grader; Docker deferral concerns the shared server grader.

Windows verification does not clear macOS/Linux, real LAN, downloaded-app OS warnings or human review. The pilot/date, ten-machine dry run, instructor task validation, paid expert/naive measurements/current baselines, accepted pilot CSV and pilot re-score corpus remain open. No 0.2 release or merge is claimed.

## Retained initial failures

- Workflow/runtime red tests preceded implementation; the early direct-TypeScript runtime used unsupported parameter properties, then changed to explicit fields.
- Typecheck caught an inferred recursive return type and nullable dialog element; both were fixed before app verification.
- Lost join binding/reply and submission reply tests were added first; durable bindings/request IDs fixed those failures.
- Package-download red test preceded the authenticated bounded curated-wheelhouse resource path.
- Native Electron rejected the original CA:FALSE certificate although Node/OpenSSL passed. An isolated Electron probe reproduced `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; a path-length-zero CA-capable self-signed anchor now passes, with hostname/validity/pin checks still enabled. Earlier draft identities need reprovisioning; no live identity was silently changed.
- Native UI testing exposed the missing attempt Settings control; the existing gear style now opens the read-only lab connection. A duplicate Close selector was corrected in the test.
- Initial installed solo smoke expected the old Home connection heading. Only that stale Home assertion changed; the agent's empty-state assertion remains intact. Initial uninstall/removal already passed.
- Close-after-lost-receipt, background-sync/Submit concurrency, and offline status-refresh tests exposed additional recovery issues. The final implementation returns the saved receipt without allowing late new snapshots or invalidating an in-flight submission.

Logs with `red`, `initial`, `selector`, `tls-fixed` or `pre-final` in their names are historical. Final command receipts in `checks.json` identify the checks that clear the Windows implementation slice. Preserve initial failures rather than interpreting every log as a passing result.

## Cleanup exception

Automatic approval review rejected optional recursive removal of three owned failed-test fixture directories under ignored `dist/desktop-lab-verification` with **“blocked by policy.”** They were retained, without retrying through another deletion mechanism. One residual synthetic `lab-ui-…` credential from an earlier failed join was removed by its test-only account prefix. This exception is separate from the installed-app uninstall/cleanup receipts. No prior task's blocked installer directory was touched.

## Reproduce

```sh
pnpm test
pnpm typecheck
pnpm build:app
pnpm lab:load
pnpm --filter @factoryze/app package:installer
pnpm --filter @factoryze/app verify:package
pnpm --filter @factoryze/app smoke:installer
```

Use OpenSSL 3 (`FACTORYZE_OPENSSL` if necessary), a supported unlocked OS credential store, Python 3.11+ and the repository's pnpm version. The recorded Windows run uses bundled Node 24.22.1 and pnpm 10.28.2; it does not claim a fresh Node 22 or other-OS run. No test requires real provider credentials or paid inference.
