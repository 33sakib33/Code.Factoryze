# End-to-end graded lab on macOS — 2026-10-29

Request: run a full graded lab on the owner's Mac (server, desktop submission, report and CSV) with no paid calls, then fix what it found.

Host: macOS 27.0.1, Apple M1 Pro, Docker Desktop 4.41.2 with the builtin seccomp profile (see the [macOS Docker audit](../2026-10-29-macos-docker-grading/README.md)). Grader image `sha256:e79d20d59afa6a184267756ad3c87000efcb9ec031ad2471b853c5f6d9100e4d`.

## Flow

- **Server:** the real CLI, `pnpm factoryze server init` then `server serve` with `FACTORYZE_LAB_GRADING=1` and the image ID. Inference stayed off, so no model traffic or cost. Startup passed the Docker isolation self-check (`"grading":true`).
- **Instructor:** `lab create` from `packages/server/examples/lab.json` (lab `e2e-lab`, roster `s001`, Library fines), then `lab close`, `lab grades`, `lab release` and `lab export`.
- **Student:** the development desktop app driven by Playwright (`e2e-lab.mjs`): Join a lab with `client.json` and the join code, Python preparation, Run tests (5/5 public), Submit the unchanged starter, write the reference fix into the workspace, Run tests, Submit again, then Refresh lab results and open the released report.

## Result

`e2e-result.json` passes with no page errors. Both submissions were graded in real containers within about nine seconds of submitting:

| Submission | Hidden checks |
|---|---|
| 1, unchanged starter | 5 of 9 |
| 2, reference fix | 9 of 9 |

Instructor status records Docker provenance (image, runner `factoryze-hidden-v1`, Python 3.13.18, 10 s per check, 120 s per run). `results.csv` has one released row for `s001`: 9/9, the latest snapshot hash, executor, image and Python. The desktop lists both submissions under Results and the report renders "released by your instructor" with all nine named checks. No grading containers remained.

## Bug found and fixed

The first run showed **"Best result: 9 of 9 checks"** on the solo Library fines practice row: Home and the Start sheet matched attempts by task ID only, and the backend merges lab and practice attempts into one list. Start could also offer to resume an unsubmitted lab attempt and default to the lab's budget.

Fix: an optional `lab` identifier on the draft `attemptSummarySchema`, set by the desktop lab connection; `practiceAttempts()` in `flow-model.ts` drops lab attempts for the practice row and Start. Continue and Results still list lab work. New assertions in the protocol contract, lab connection and flow-model tests failed first (`fix-red.log`); afterwards `pnpm test` passes **235/235, zero skips** and typecheck passes. The rerun end-to-end flow shows both practice rows as "Not attempted yet"; that rerun is the recorded `e2e-result.json`.

## Not covered

- The existing `smoke:lab` could not run unattended here: it stores a test key with Node keytar, and macOS then shows a keychain permission dialog when the development Electron app reads it, so Home stays on "Checking model…" until the 60-second timeout (`smoke-lab-keychain-blocked.log`). It passed on Windows earlier.
- No model traffic through the lab; the student fix was written to the workspace file rather than typed in the editor; one machine, no real LAN.
- The additive `lab` field on the draft attempt summary needs recorded human review with the other draft contracts.
