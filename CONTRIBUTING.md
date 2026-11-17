# Contributing to Factoryze

Factoryze welcomes bug reports, documentation improvements, tests, task examples and code changes. Start with a GitHub issue for a substantial change so the scope and release gates are clear before implementation.

Most contributors should start with the [problem map](docs/problem-library.md) to pick a learning goal, then [Contribute a practice problem](docs/contributing-problems.md). It covers the problem folder, local checks, LLM-assisted authoring and the pull request. The [task-pack format](docs/task-packs.md) is the file reference.

If your coding agent supports repository skills, use [`$factoryze-problem-authoring`](.agents/skills/factoryze-problem-authoring/SKILL.md) to repeat the problem-authoring workflow. The website also offers this skill as a download for contributors working outside the repository.

## Set up

Use Node.js 22.12 or newer within the 22.x line, pnpm 10.28.2 and Python 3.11+. `.nvmrc` selects Node 22 when using nvm. Install the native build prerequisites for your OS in [README.md](README.md#develop-and-verify), then run:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

The pull-request workflow runs these checks on Ubuntu. For desktop changes, also run `pnpm build:app` and the relevant package verification and smoke commands from the README on a supported machine. Report the OS and exact commands/results in your pull request. The manual installer workflows cover the full OS matrix before release; a passing pull-request check alone is not a release approval.

## Change guidelines

- Keep protocol wire formats in `packages/protocol`. Add a compatibility path for released contracts.
- Use a failing test for behavior changes and keep fixtures deterministic. Do not commit real credentials, student data, private assessment packs, or local `.env` files.
- Use the public bundled tasks only for practice and examples. [Controlled labs](docs/lab-pilot.md#instructor-operations) need a separate private task collection.
- Do not run Factoryze's paid model calls, live spikes or benchmarks with project resources without the owner's explicit approval and spending limit. Routine verification uses synthetic providers. You may use your own LLM to draft a public practice problem; review its output and describe that help in the PR.
- Changes to authentication, keys, permissions, trials, migrations or released contracts need human review before merge. Describe the risk and migration path in the pull request.
- Make sure you have the right to contribute the code and assets you submit under this repository's Apache 2.0 license. Preserve third-party copyright and license notices.

Keep pull requests focused. Explain what changed, why, how you tested it, and any platform or security limits that remain. Never paste a secret into an issue, pull request or CI log; use the [private reporting path](SECURITY.md) for vulnerabilities.
