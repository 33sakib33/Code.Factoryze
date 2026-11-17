# Activity feed — experimental assessment

Status: deterministic content implemented; not promoted to the bundled catalog.
Import this folder through **Open task folder…** to try it manually. No model
connection is required for manual edits, public tests or submission.

The starter has an N+1 member lookup in `feed/feed.py`. The symptom appears in
`task.yaml`; the workspace README documents the service without naming the bug.
The intended shortcut is to reuse the existing request-local, workspace-scoped
batch repository and render the original page. No IANA time zones, dependencies,
server, network access or Docker are needed.

## Checks

- Six public functions pass on both starter and reference. They also run through
  `python -m unittest` using the standard library's `load_tests` hook.
- Twelve hidden checks run through the production Factoryze grader. The starter
  passes eight; four fail on measured SQLite reads: 100 distinct authors,
  100 repeated authors, 100 missing authors and a 901-author multi-batch page.
- The reference passes all twelve. A normal 100-author page uses at most two
  reads; 901 authors use at most four, allowing SQLite parameter batching.
- Hidden checks preserve order/limits, workspace isolation (including a shared
  member ID and a foreign-only member), updated/deleted names on the next
  request, empty pages, zero/negative limits and literal data. Feed reads must
  not modify the database. No elapsed-time threshold is used.
- The engine integration test also verifies that stale caches, unscoped member
  lookups, dropped former members and author-sorted pages are rejected by the
  relevant hidden checks. Private tests, prompts and reference stay outside the
  copied student workspace.

Run from the repository root:

```sh
node --experimental-strip-types --test packages/engine/test/activity-feed.test.ts
```

`reference/feed.py` replaces only `workspace/feed/feed.py` in a disposable copy.
It is maintainer material and is never copied into a student's workspace.
`prompts/benchmark.yaml` contains expert, middle and naive scenarios for the
existing benchmark tooling. They are scripts, not prompt scores.

## Remaining promotion work

Run clean expert/middle/naive model measurements with separately approved
spending, assess repeatability and approval behavior, then review whether this
task belongs in the practice library. No measured baseline or skill-separation
claim exists yet. Sandbox-dependent measurements remain deferred with Docker.
