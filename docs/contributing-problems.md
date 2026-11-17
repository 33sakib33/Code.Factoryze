# Contribute a practice problem

Practice problems are public examples. Anyone who reads this repository or an installer can see their tests, including files under `tests/hidden/`. Do not put a controlled assessment, private answer key, real student record, credential, or third-party material you cannot redistribute here. Instructors can load private packs separately for graded labs.

## 1. Propose the problem

For a new bundled problem, check the [problem map](problem-library.md), then open a [practice problem proposal](https://github.com/33sakib33/Factoryze/issues/new?template=practice-problem.yml) with one learning goal, the user-visible symptom, expected behavior, intended difficulty and estimated time. A small correction to an existing problem can go straight to a pull request if its ID and grading meaning stay the same. Revisions that change the expected solution or results should use a new problem ID so existing attempts remain reproducible.

Fork the repository, clone your fork, and create a branch such as `problem/my-problem`. Keep each pull request to one problem.

## 2. Add the pack

Create `tasks/practice/my-problem/` with this layout:

```text
tasks/practice/my-problem/
  task.yaml
  workspace/
    README.md
    app/main.py
    tests/test_public.py
  tests/hidden/test_main.py
  prompts/benchmark.yaml       # optional; no model run is needed for a PR
```

Use a unique lowercase, hyphen-separated folder name and matching `id` in `task.yaml`. Set `schema: 1`, `title`, `brief`, `minimumPython: "3.11"`, and `entryFile` pointing to a file under `workspace/`. The [task-pack format](task-packs.md) lists optional fields and limits. For a bundled practice problem, include at least one public `test_*.py` file under `workspace/tests/` and at least one hidden `test_*.py` file under `tests/hidden/`. Benchmark prompts are optional; if supplied, `taskId` must match the problem ID.

Add optional `topics` for discovery, for example `topics: [linux, observability]`. Keep them distinct from `recommendedKnowledge`, which tells learners what background may help. The web creator at `/create/` accepts these tags on Python task submissions. If your idea needs a different exercise format, use its **Propose another format** section to download a structured Markdown proposal, then attach it to a repository issue. A proposal does not create an executable task. Each new format needs a versioned evaluator and review path before publication; see [extended exercise types](extended-exercise-types.md).

Make the starter deliberately incorrect in the way described by the brief. Public checks should pass on the starter so a learner can begin; at least one hidden check should fail. A small, well-scoped correction must make both public and hidden checks pass. Keep all checks deterministic, independent, quick, and free of network access. The runner gives each check 10 seconds and the full grading run 120 seconds. State any required package in the issue before adding it; the app uses a curated package index.

## 3. Validate without a model

After the repository setup in [CONTRIBUTING.md](../CONTRIBUTING.md), run:

```sh
pnpm problem:check my-problem
pnpm test
pnpm typecheck
```

`problem:check` verifies the importable pack, optional benchmark prompt schema, public checks and hidden starter failures. Then copy `workspace/` to a temporary folder **outside this repository**, apply the intended fix there, and run:

```sh
pnpm problem:check my-problem --solution /path/to/fixed-workspace
```

The second command must report all public and hidden checks passing. Keep that fixed workspace outside the pull request; explain the intended correction and results in the PR. The pull-request CI reruns the starter checks for every active practice problem. Maintainers verify the installer resource and platform release gates before shipping a bundled problem.

## 4. Open the pull request

Push `problem/my-problem` to your fork and open a pull request into `main`. Include:

- the issue link, learning goal, intended symptom and expected correction;
- `problem:check` starter and fixed-workspace results, plus `pnpm test` and `pnpm typecheck` results and your OS;
- any packages or assets added and their licenses;
- any limitations, such as a check that cannot run on a supported OS;
- whether an LLM helped draft the problem, code or tests, and what you personally reviewed.

The maintainers may ask for changes to clarity, difficulty, determinism or grading before merging. A passing CI run does not by itself approve a new problem.

**Contributor recognition is planned, not live.** The proposed system counts a maintainer-accepted public problem once, whether it comes through a merged PR or a published website submission. A future website GitHub link will let a contributor show both routes on one opt-in profile; it will not merge trial credits. See [the recognition design](contributor-recognition.md).

## Using your own LLM

Yes. You may use your own LLM and account to brainstorm, draft and review a public practice problem. Do not send it private assessment packs, student data, credentials or unpublished project secrets. Treat its output as a draft: inspect every file, run the local checks above, and verify a corrected workspace yourself. This does not authorize running Factoryze's paid model benchmarks or live provider tests with project resources; those still require the owner's approval and a spending limit.

A useful starting prompt is:

> Draft one deterministic Python 3.11 practice problem for Factoryze using `docs/task-packs.md`. Give it a realistic symptom, a deliberately faulty starter, public checks that pass on the starter, hidden checks that expose the fault, and a small intended correction. Use only synthetic data and standard-library imports. Keep the problem under one new `tasks/practice/<id>/` folder. I will review and run the checks before opening a PR.
