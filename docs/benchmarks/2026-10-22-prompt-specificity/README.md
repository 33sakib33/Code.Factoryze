# Prompt specificity benchmark (2026-10-22)

**Task promotion (2026-10-22, PLAN 1b).** Both tasks now live in `tasks/practice/`. Library fines task files are unchanged. The bundled Monthly revenue removes the failing public report test and its import; its two remaining public checks pass on the buggy starter. The tables below describe the original task/grader versions: Monthly revenue had three public tests, and both tasks used the earlier grader. These are historical measurements; they do not clear the gate for today's task/grader combination. Variance runs do not generate efficiency baselines.

## Current follow-up status (2026-10-24)

- **Complete:** task promotion/retirement, standard-library `python -m unittest` instructions, Windows test-command recognition, and the harness version guard/report pins/solo temperature setting.
- **Partial evidence:** the reworked Monthly revenue [DeepSeek batch](results/monthly-revenue-reworked-deepseek.json) is saved and includes incomplete/failed samples under the restricted approval policy. The Gemini rerun was stopped because of cost; there is no completed clean two-model rerun of the reworked task.
- **Deferred by the user (2026-10-24):** Docker installation, the shared executor and `pnpm bench:variance --sandbox docker` (PLAN 3a). This option does not exist in today's runner; sandbox-dependent reruns wait. Next code work is another task's deterministic content/checks/scripts (3b), before approved measurements and promotion.
- **Approved reports implemented in the app:** saved activity/request groups, raw token breakdown, prompt costs, per-check segments and a failed-details modal; no report suggestions or prompt scores. [The app report audit](../../../PROGRESS.md#2026-10-24--approved-report-design-in-the-app) records verification limits. This does not validate historical benchmark results or establish exact per-tool/context token costs.
- **Pending:** current-task efficiency baselines and student-pilot validation against human ratings. No Factoryze baselines are bundled for either active task. Further paid calls require explicit approval and a spending limit; this update made none.

The original results and findings below are preserved. [PLAN](../../../PLAN.md#immediate-plan-added-2026-10-22-status-updated-2026-10-24) owns the remaining work order.

**Question.** Does a more specific prompt cost fewer weighted tokens, by a margin larger than run-to-run noise? This is the pre-pilot check in PLAN Phase 2. It measures whether the token metric is *precise*. Whether it measures *skill* still needs the pilot comparison with human ratings.

**Setup**
- Harness `factoryze@0.1.0`, temperature 0, via OpenRouter. OpenRouter's upstream provider was not pinned.
- Two models: `deepseek/deepseek-v4.1-flash-1017` and `google/gemini-4-argon` (reasoning off, OpenRouter's default for this model; its billed cost matched the metered tokens exactly).
- Each prompt script ran 10 times, alternating scripts, each in a fresh workspace and ledger (`pnpm bench:variance --model …`). A run that stops early (for example at the 16-step limit) keeps its token usage and grade, so the scripts that fail most aren't flattered.
- Prompt feedback was off and the budget cap was raised, so neither shaped the runs.
- Unattended approvals: edits approved; test-runner commands (`python -m unittest`, `pytest`) approved; every other shell command rejected and logged, including `python -c` checks and the task CLI. A human would approve some of these, so rejections inflate costs, more for vaguer prompts. DeepSeek asked for many such commands; Gemini asked for none.
- Weighted tokens = uncached input + output + cache writes + 0.1 × cache reads.

Raw results are in [`results/`](results/). They contain token counts, grades and the shell commands the agent asked to run, but no model responses, prompt text or credentials.

## Summary

| Task | Model | Expert median | Middle median | Naive median | Naive ÷ expert | Middle as % of naive | Naive solved | Expert fully separated |
|---|---|---|---|---|---|---|---|---|
| monthly-revenue | DeepSeek | 2,205 | 13,862 | 25,081 | 11.4× | 55% | 10 of 10 | Yes |
| monthly-revenue | Gemini | 6,203 | 14,749 | 16,389 | 2.6× | 90% | 10 of 10 | Yes |
| library-fines | DeepSeek | 4,764 | 12,340 | 22,477 | 4.7× | 55% | 8 of 10 | Yes |
| library-fines | Gemini | 5,980 | 20,143 | 26,750 | 4.5× | 75% | 10 of 10 | Yes |

"Expert fully separated" means the most expensive expert run cost less than the cheapest middle run. The original practice tasks, now retired, fail outright (below).

## Results

### Original practice tasks (now retired): the ranking is backwards (DeepSeek)

| Task | Script | Solved | Weighted tokens min / median / max | Stdev |
|---|---|---|---|---|
| dedupe-ids | Expert | 8 of 10 (2 stopped at 16 steps) | 3,313 / 4,007 / 5,570 | 622 |
| dedupe-ids | Naive | 10 of 10 | 1,324 / 1,406 / 1,901 | 165 |
| pagination-api | Expert | 10 of 10 | 2,902 / 4,410 / 8,932 | 1,612 |
| pagination-api | Naive | 10 of 10 | 1,245 / 1,686 / 2,555 | 367 |

On both tasks every naive run cost less than every expert run. The tasks are one or two small files, so a vague prompt costs no extra exploration, and the scripted expert prompts also ask for verification (read the test, run the tests) that the naive ones don't. The approval rule rejected 41 shell commands on dedupe-ids and 25 on pagination-api, which inflates the expert runs, but not enough to reverse the order. These tasks fail the PLAN exit gate.

### `monthly-revenue`: a failing public test does part of the diagnosis

The original `monthly-revenue` task, now promoted with the rework described above at `tasks/practice/monthly-revenue`: an eight-module billing package where the monthly report is too low because a mutable default argument in the promotions module leaks promotions between invoices. The symptom is in the report; the cause is in another file. At the time of these runs it had 3 public tests and 9 hidden checks; the starter passed 2 of 3 public tests (the report test failed) and 5 of 9 hidden checks under the earlier shared-process grader. A correct fix passed all.

All scripts ask the agent to run the tests, so verification is not what separates them.
- **Expert:** names the file, function and cause.
- **Middle:** describes the symptom and a hypothesis ("state that carries over from one invoice to the next"), no location.
- **Naive:** "The monthly revenue report is wrong. Fix it and run the tests."

| Model | Run | Script | Solved | Weighted tokens min / median / max | Stdev | Avg requests | Avg uncached input | Rejected commands |
|---|---|---|---|---|---|---|---|---|
| DeepSeek | Two scripts | Expert | 10 of 10 | 1,494 / 3,121 / 5,945 | 1,375 | 7.0 | 1,185 | 7 |
| DeepSeek | Two scripts | Naive | 10 of 10 | 18,675 / 24,545 / 31,268 | 3,936 | 10.3 | 18,453 | 17 |
| DeepSeek | Three scripts | Expert | 10 of 10 | 1,365 / 2,205 / 4,510 | 911 | 6.1 | 695 | 4 |
| DeepSeek | Three scripts | Middle | 10 of 10 | 11,572 / 13,862 / 18,745 | 2,103 | 11.6 | 8,264 | 11 |
| DeepSeek | Three scripts | Naive | 10 of 10 | 17,223 / 25,081 / 29,927 | 4,540 | 10.1 | 17,523 | 19 |
| Gemini | Three scripts | Expert | 10 of 10 | 4,652 / 6,203 / 6,277 | 720 | 4.7 | 5,515 | 0 |
| Gemini | Three scripts | Middle | 10 of 10 | 12,314 / 14,749 / 18,079 | 1,883 | 6.6 | 13,908 | 0 |
| Gemini | Three scripts | Naive | 10 of 10 | 14,726 / 16,389 / 17,650 | 814 | 7.1 | 14,385 | 0 |

On Gemini the gap shrank to 2.6× and the middle script was only about 10% cheaper than naive, with heavily overlapping ranges. The likely reason: the failing public test points a strong agent at the report, so it gets most of the diagnosis for free and the student's hypothesis adds little. Gemini's expert runs cost more than DeepSeek's mainly because these small contexts were not cached on Gemini, while DeepSeek caches from the first request; absolute numbers are not comparable across models.

### `library-fines`: public tests stay green, the symptom is only in the brief

`tasks/practice/library-fines` (now bundled, previously in `tasks/benchmark/`): a nine-module lending system with three branches in different time zones, closed days, holidays, renewals, concession fines and overdue notices. `returns.py` judges lateness by the UTC date of the return instead of the branch's local day, so an evening return on the due date at Riverside (UTC−5) is fined a day, and an early-morning late return at Harbour (UTC+10) is not. The correct helper, `clock.local_day`, is used everywhere else. 5 public tests, all green on the buggy starter, so running them doesn't reveal the bug. 9 hidden checks; the starter passes 5 of 9, a correct fix passes all. The symptom is only in the brief, which the student sees and the agent doesn't.
- **Expert:** names the file, the line and the fix.
- **Middle:** relays the symptom from the brief and a time-zone hypothesis, no location.
- **Naive:** "Members are being fined wrongly. Fix it and run the tests."

| Model | Script | Solved | Stopped at 16 steps | Weighted tokens min / median / max | Stdev | Avg requests | Avg uncached input | Rejected commands |
|---|---|---|---|---|---|---|---|---|
| DeepSeek | Expert | 10 of 10 | 0 | 3,184 / 4,764 / 9,304 | 2,019 | 8.5 | 3,207 | 2 |
| DeepSeek | Middle | 10 of 10 | 0 | 10,455 / 12,340 / 17,282 | 1,834 | 10.2 | 7,190 | 10 |
| DeepSeek | Naive | 8 of 10 | 4 | 14,987 / 22,477 / 39,054 | 6,561 | 13.8 | 11,145 | 23 |
| Gemini | Expert | 10 of 10 | 0 | 5,753 / 5,980 / 7,741 | 756 | 5.5 | 5,826 | 0 |
| Gemini | Middle | 10 of 10 | 0 | 16,484 / 20,143 / 25,863 | 2,840 | 7.8 | 18,589 | 0 |
| Gemini | Naive | 10 of 10 | 0 | 21,423 / 26,750 / 30,793 | 2,699 | 9.7 | 23,111 | 0 |

Two of DeepSeek's four step-limited naive runs still fixed the bug; two left it unfixed. Their tokens are included above.

## Findings

1. **Task design decides whether the metric works.** Same harness and settings: on tiny tasks vagueness is free or even cheaper; on tasks where the symptom and cause are in different files it costs 2.6–11× at the median.
2. **Public tests should not reveal the bug.** With a failing public test (monthly-revenue), the stronger model got most of the diagnosis from the test and the gap fell to 2.6×. With green public tests and the symptom only in the brief (library-fines), the gap was 4.5× on Gemini and 4.7× on DeepSeek. The prompt then measures whether the student relays what they know.
3. **The gap is more stable across models on library-fines** (4.5–4.7×) than on monthly-revenue (2.6–11.4×). A task whose discrimination doesn't swing with the model is fairer to grade.
4. **Locating the problem always separates cleanly.** In all four task and model combinations, the most expensive expert run cost less than the cheapest middle run.
5. **Middle against naive is a tendency, not a grade boundary.** Middle medians were 55–90% of naive, and the ranges overlapped in every combination. Report single attempts in coarse bands, not exact ranks.
6. **Stronger models make vagueness cheaper.** On monthly-revenue Gemini needed about 7 requests and 500 output tokens for the naive prompt, against DeepSeek's 10 and 3,700. Two models show a direction, not yet a measured trend.
7. **Correctness separates only on the weaker model.** DeepSeek's naive runs solved library-fines 8 of 10 times; every other combination solved every run. Token cost is the more reliable signal.
8. **Noise at temperature 0 is small next to the gaps.** Relative spread is roughly 5–45% per script, and the DeepSeek naive median on monthly-revenue reproduced within 2% across two runs.
9. **The levels are multiplicative.** A score based on the log ratio to the task's expert baseline, for the same model, would fit this spread better than raw tokens.

## Limits and follow-ups

- Two models and two working tasks. Encouraging, but not a validation of the thesis; that needs the student pilot.
- The expert scripts name the exact cause, so they are a best case.
- The approval rule distorts DeepSeek's vaguer prompts. A sandboxed rerun that approves every command would give cleaner numbers (harness track Step 0).
- Gemini ran with reasoning off. With reasoning on, a stronger agent may narrow the gap further.
- **Implemented since these runs:** active tasks use `python -m unittest` with standard-library hooks and documented commands. Adding pytest remains deferred; no package was added by the task promotion.
- The original practice tasks are retired; their replacement pack follows the green-public-tests pattern. The reworked Monthly revenue DeepSeek batch is linked above, but clean current-task reruns and Factoryze baselines remain pending and separate from the original results.
- Cost: DeepSeek about 1.2M weighted tokens in total (pennies); Gemini about $0.90 for monthly-revenue (including a trial round) and about $1.30 for library-fines.
