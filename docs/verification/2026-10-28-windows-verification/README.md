# Windows link fixtures and installer cleanup — 2026-10-28

Request: fix the two Windows symlink test failures and installed-smoke cleanup failure, retain an audit trail, then commit and push. This changes desktop verification tooling and fixtures; the app UI, production link policy, authentication and gateway are unchanged.

## Changes

- Reproduced both `EPERM` failures before changing the tests. They failed while creating privileged Windows file symlinks, before exercising the production rejection checks. Windows fixtures now create real directory junctions; POSIX retains real file symlinks. Assertions prove the link resolves outside the workspace, then verify read/write rejection before permission, unchanged outside content and no search/list traversal. Fixture setup is inside cleanup protection.
- Added deterministic ZIP fixtures with Unix file and directory symlink attributes. Both are rejected on Windows without needing native file-symlink privileges; no imported storage or escaped file is created. Nothing is skipped and production rejection code is unchanged.
- Fixed the NSIS uninstall race. `/S` alone starts a temporary uninstaller copy and returns before it finishes. The wrapper now uses the final, verbatim `_?=<installed path>` argument to wait for in-place uninstall, then removes only its validated owned temporary directory. Install `/D=` handling also preserves spaces. The existing retry limit is unchanged.
- Added seven cleanup tests: uninstall completion ordering, propagated uninstall failure with preserved files, unrelated-root refusal, missing-uninstaller refusal, setup-without-install cleanup, canonical temporary-parent aliases, and refusal of a linked root. Cleanup errors are retained separately from app-smoke errors; both are reported if both fail. `installer-result.json` records the complete wrapper result.
- Reconciled the current Windows status in PLAN, PROGRESS, README and the Phase 1 release record. Older dated failures remain historical evidence.

NSIS behavior follows its [uninstaller command-line documentation](https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.2) and [ExecWait explanation](https://nsis.sourceforge.io/When_I_use_ExecWait_uninstaller.exe_it_doesn%27t_wait_for_the_uninstaller%3F). Node documents Windows junction behavior in [fs.symlink](https://nodejs.org/docs/latest-v24.x/api/fs.html#fssymlinktarget-path-type-callback).

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Original two test files, before fixes | 5 passed, 2 failed creating Windows links (`EPERM`) | [initial-focused-tests.log](initial-focused-tests.log) |
| Initial cleanup regression | Failed because the new helper did not exist yet; not a fresh pre-fix installer run | [initial-installer-cleanup-test.log](initial-installer-cleanup-test.log) |
| Historical full installer failure | App assertions passed, wrapper failed removing its temporary root (`EPERM`) | [original log](../2026-10-27-desktop-trial-credits/installer-smoke.log) |
| Early focused tests | 13/13 passed | [focused-tests.log](focused-tests.log) |
| Final cleanup tests | 7/7 passed | [cleanup-tests-final.log](cleanup-tests-final.log) |
| Final complete suite | **207/207 passed, 0 failures, 0 skips** | [full-tests.log](full-tests.log) |
| TypeScript | Passed | [typecheck.log](typecheck.log) |
| App build | Passed, browser/node/Electron bundles have 0 errors | [build.log](build.log) |
| Windows NSIS package | Passed; dependency collection used its fallback after a collector error | [package-installer.log](package-installer.log) |
| Packaged resources | Passed | [package-resource-check.log](package-resource-check.log) |
| Complete installed-app smoke | Passed with synthetic inference, including reports/approvals/budgets/imports/restarts | [installed-smoke.log](installed-smoke.log), [app receipt](installed-app-result.json) |
| Uninstall and owned-root removal | Passed under a path containing spaces | [wrapper receipt](installer-result.json) |
| Independent post-cleanup check | Root absent; 0 Factoryze installation registrations; 0 Factoryze processes | [post-cleanup.json](post-cleanup.json) |

[checks.json](checks.json) records commands, environment, source fingerprints, artifact/log SHA-256 hashes and verification limits. The earlier 205-test run is retained in `full-tests-before-temp-guards.log`; the final 207-test run includes the last two cleanup guards. The installed smoke had no pre-existing Factoryze installation or running app, as recorded in [installer-preflight.json](installer-preflight.json). Only the fresh wrapper-owned directory was removed; historical failed smoke directories were not manually deleted.

Build warnings include missing optional React type peers; packaging reports missing optional non-Windows dependencies and skips signing for this unsigned installer. The dependency collector fallback did not prevent packaging; resource verification and the installed-app smoke both passed.

## Limits and remaining work

These receipts are from Windows x64 with Node 24.22.1, pinned pnpm 10.28.2 and Electron 42.8.1. Native Windows file-symlink fixtures are not exercised on this unprivileged host; real junctions and ZIP file/directory link rejection are exercised. POSIX file-symlink branches remain in the tests, but were not run on macOS/Linux here. No OS security settings were changed. No dependencies were added or updated; no Docker, SMTP or paid inference was used by this task.

Fresh macOS/Linux suite/build/installed-smoke checks, remaining BYOK/manual provider and downloaded-artifact security checks, recorded human review and reviewed release artifacts remain open. Release 0.1 is not cleared. The requested Git action is commit/push on the existing feature branch; no merge or release is requested here.
