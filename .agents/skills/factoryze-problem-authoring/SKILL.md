---
name: factoryze-problem-authoring
description: Create or revise a public Factoryze Python practice problem for a repository pull request or website submission. Use for task-pack authoring, starter and solution checks, and contribution handoff.
---

# Author a Factoryze practice problem

Help the contributor produce one reviewable public practice problem. First choose the route they requested:

- **Repository PR:** Work in `tasks/practice/<id>/`. Read `docs/problem-library.md`, `docs/contributing-problems.md` and `docs/task-packs.md` in the base repository for the current coverage, format and contribution steps. For a new problem, propose one learning goal in an issue first. A small correction that preserves the problem's grading meaning may go straight to a PR.
- **Website:** Use the browser editor at `/create/` for a Python task, or prepare a ZIP for the upload form. The editable ZIP template is at `/task-template.zip`. These submissions enter maintainer review; the website does not create a GitHub PR. If the idea needs shell, SQL, configuration, incident, review, or another exercise format, use the page's **Propose another format** section to download a structured proposal for a repository issue. Do not submit an unsupported format as a Python pack.

If the base repository is unavailable, use the [problem map](https://github.com/33sakib33/Factoryze/blob/main/docs/problem-library.md), [public contribution guide](https://github.com/33sakib33/Factoryze/blob/main/docs/contributing-problems.md) and [task-pack format](https://github.com/33sakib33/Factoryze/blob/main/docs/task-packs.md) when accessible. The essentials are below so a website contributor can still draft a pack.

## Make the pack

Use a unique lowercase, hyphen-separated ID. A file-based pack has `task.yaml` at its root, editable starter files under `workspace/`, public `test_*.py` checks under `workspace/tests/`, and at least one hidden `test_*.py` check under `tests/hidden/`. For a repository PR, put the pack under `tasks/practice/<id>/`. A ZIP upload contains the pack at its root or inside one enclosing folder.

Set `schema: 1`, `id`, `title`, `brief`, `minimumPython: "3.11"`, and an `entryFile` path within `workspace/`. The brief should describe a realistic symptom and expected behavior without revealing the correction. Keep the starter's fault small. Public checks pass on the starter; at least one hidden check exposes the fault. A corrected copy passes all checks. Keep checks deterministic, independent, fast, and free of network access. Each check has a 10-second limit and the grading run has a 120-second limit. Prefer the Python standard library; discuss any extra package before adding it.

Optional `topics` are one to five distinct lowercase slugs, such as `sre`, `security`, or `linux`. They describe the subject for web discovery, not the task evaluator. Optional `recommendedKnowledge` contains one to five short phrases about useful background and never gates access. Keep task ID and `familyId` version lineage separate from topic tags and future learning paths.

Everything in a public practice pack, including hidden checks, can be seen by people with the repository or installer. Use synthetic data and material the contributor may redistribute. Exclude secrets, real student data, private assessments, and private answer keys. If the fix changes a published problem's grading meaning, assign a new ID.

## Verify and hand off

For a repository PR, run `pnpm problem:check <id>`, `pnpm test`, and `pnpm typecheck`. Copy `workspace/` to a temporary folder outside the repository, apply the intended fix there, and run `pnpm problem:check <id> --solution <fixed-workspace-path>`. Do not commit that corrected workspace. Report actual results; do not claim a check ran if it did not.

For a website submission without the base repository, inspect the template or browser form, run the public and hidden Python checks against both starter and corrected copies, and keep the ZIP within the form's 20 MB limit. Explain the intended correction and edge cases in reviewer notes. Website submissions remain pending until a maintainer reviews them.

For a PR, push a focused branch and open a PR to `main` with the issue link (if any), learning goal, symptom, intended correction, validation results, OS, added asset or package licenses, limitations, and any LLM help the contributor reviewed. Only submit the website form or open a PR when the contributor asks for that action.

The contributor may use their own LLM and account to draft and review the public problem, but must inspect its output and verify the corrected copy. Do not send private material to an LLM. Factoryze's paid model benchmarks and live provider tests require the owner's approval and a spending limit.
