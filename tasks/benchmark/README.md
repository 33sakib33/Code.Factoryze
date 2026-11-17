# Experimental tasks

This pack holds tasks that have not yet been promoted to the bundled practice catalog. Library fines and the reworked Monthly revenue now live in `tasks/practice/`.

`activity-feed/` is the next experimental pack (2026-10-28): a multi-module
SQLite feed with an N+1 lookup, six green public checks on the starter, twelve
hidden checks, a maintainer reference and expert/middle/naive scripts. Its
deterministic verification is complete; model measurements and promotion are
pending. See [the task notes](activity-feed/README.md).

The dated results in `docs/benchmarks/` describe the task/grader versions used at the time. The original Monthly revenue benchmark had a failing public report test; the bundled version has green public tests on its buggy starter. As of 2026-10-24, a restricted-approval DeepSeek rerun is saved with incomplete/failed samples, the Gemini rerun was stopped, and clean current-task reruns/baselines remain pending. See [benchmark follow-up status](../../docs/benchmarks/2026-10-22-prompt-specificity/README.md#current-follow-up-status-2026-10-24). Further paid calls need explicit approval and a spending limit.
