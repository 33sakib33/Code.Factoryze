# Open a task folder or ZIP

Use **Open task folder…** or **Open task ZIP…** on Home, or the corresponding File menu actions. The app creates an editable copy, prepares Python, and opens it in the current window. Keep working in that copy; the original assessment stays unchanged. Open another task through the same actions.

A folder must contain `task.yaml` and `workspace/`. A ZIP may contain these at its root, or inside one enclosing folder. Finder metadata (`__MACOSX`, `.DS_Store`) is ignored. Example:

```text
my-assessment/
  task.yaml
  workspace/
    app/main.py
    tests/test_main.py
  tests/hidden/test_main.py
  prompts/benchmark.yaml        # optional: expert and naive scripts for baselines, plus an optional middle script for variance runs
  baselines/                    # optional measured baselines
```

```yaml
schema: 1
id: my-assessment
title: My assessment
brief: Fix the incorrect answer and verify the result.
minimumPython: "3.11"
topics: [sre, reliability]
recommendedKnowledge:
  - HTTP response status codes
  - Bounded retries and backoff
entryFile: app/main.py
timeHintMinutes: 30
budgetTokens: 50000
```

`schema`, `id`, `title`, `brief` and `minimumPython` are required. Use a unique lowercase, hyphen-separated `id` for each assessment/version. `entryFile`, `timeHintMinutes`, `budgetTokens`, `recommendedKnowledge`, `topics` and boolean `retired` are optional. `topics` contains one to five distinct lowercase slugs of 2–40 characters (for example `sre`, `security`, `linux`). They describe subject matter for discovery, not the evaluator or a prerequisite. `recommendedKnowledge` contains one to five distinct, trimmed phrases of 2–100 characters each. It is learning guidance shown before Start and does not block the learner. Python remains the checked environment requirement. `entryFile` is a path inside `workspace/`, either at its root (`invoices.py`) or in a folder (`app/main.py`). Time is a hint displayed by the task; the token budget is enforced. A task without a limit uses the default 100,000 weighted tokens (or the configured backend/legacy default).

Set `retired: true` to remove a bundled task from Practice tasks while retaining its source, hidden tests and historical data. Existing attempts remain in Continue and Results and can run tests and submit again. Continue defaults to three recent rows; **Show all attempts** also exposes older unsubmitted drafts. Keep the complete retired task in the bundle; deleting its hidden tests would break grading. Omitted or false means active. This additive field is implemented in draft task pack schema 1; required human-review evidence must be recorded before 0.1 release. The existing merge does not establish that review.

Put editable source and visible tests in `workspace/`. Tests use plain Python `test_` functions and assertions, with imports relative to the workspace root, for example `from app.main import answer`. The runner does not require pytest. Hidden checks belong in `tests/hidden/` outside `workspace/`. Include at least one hidden `test_*.py` check to support Submit. Factoryze does not run task setup hooks or install task-supplied packages automatically. The standard library is available; package access uses the engine's curated index.

"Hidden" means these checks are withheld from the student's editable workspace during a run. It does not make them confidential if the pack is distributed, bundled in an installer, or committed to a public repository. Keep packs for controlled assessments in a private, server-owned task collection and load that collection with the lab server's `--tasks` option.

Checks must be independent: discovery and each check run in fresh Python processes, so module globals do not carry over between checks. Each process has a 10-second limit, and all discovery/check execution shares a 120-second limit. An import failure or timeout is reported under the test file's name; a check failure or timeout uses the function's name. After the run limit, remaining discovered checks are marked as timed out. Both public results and submitted reports retain these failures, and later checks run while time remains.

The start sheet shows the task's budget. **Change** sets a different limit for this task; it applies to every attempt of the task and never clears used tokens. Each attempt counts its own usage against that limit. One in-flight request may cross the limit, then the agent pauses; in practice the student can raise it, and the report records the change.

The engine keeps a snapshot of imported metadata, hidden tests and baselines, so grading still works after the source moves. Only `workspace/` is copied to the editor. Importing identical content again creates a fresh workspace/run: input, output, cache and weighted meters start at zero with a fresh budget. Earlier run usage and cumulative history remain saved. Reopening an existing workspace or clicking New session resumes that run without resetting its usage or budget. Different content using an already registered task ID is refused; assign a new ID to a revised assessment. Earlier attempts stay in Continue on Home; Factoryze never reopens one on launch.

Imports reject unsafe paths, symbolic links, encrypted archives, duplicate paths, over 2,000 files/directories, and over 20 MiB of archive or expanded content. Solo reports are practice results; hidden checks remain on the local user's disk.

A Factoryze service can also publish packs as **hosted tasks** for signed-in desktop users (see [trial credits](trial-credits.md#hosted-tasks)). Hosted packs use this same format; the service additionally requires an `id` that starts with a letter and a `minimumPython` of the form `3.11`. For hosted packs the app records a digest of `tests/hidden/` and `workspace/tests/` at download and sends a leaderboard result only while those files are unchanged ([details](trial-credits.md#hosted-task-results-leaderboard)).

To contribute a new bundled public practice problem, follow [the problem contribution guide](contributing-problems.md). It adds the required starter/hidden-check behavior, a local validation command and the PR steps on top of this format reference.
