# Extended exercise types: investigation and proposed rollout

Status: proposal with three Python content slices and guided browser practice implemented locally. The `retry-storm`, `webhook-allowlist`, and `proc-stat-parser` packs use the schema-1 Python grader. Schema-1 packs support optional `topics` tags for subject discovery and `recommendedKnowledge` for learning guidance. The web has guided, scripted patch review for these three problems; it does not execute Python. Reviewed hosted briefs and private browser checks remain separate, feature-gated services. New evaluator types and public execution remain separate work.

## Current boundary

- Task packs use strict `schema: 1`, require `minimumPython`, and identify one editable `workspace/` plus Python `tests/hidden/test_*.py` checks. Desktop solo and lab grading execute Python `test_` functions. See `packages/protocol/src/index.ts`, `packages/engine/src/grader.ts`, and `docs/task-packs.md`.
- The browser check job is a private pilot for reviewed Python public checks. Its wire type, pinned image, allowed check paths, and result provenance all assume Python. Feedback is practice-only and cannot award rewards. See `packages/protocol/src/browser-checks.ts` and `docs/browser-check-worker.md`.
- The Go task-pack validator independently enforces schema 1, `minimumPython`, and a hidden Python test. The published challenge category accepts `debugging`, `refactoring`, or `context`; there is no SRE domain value. The browser projection accepts a small text-file allowlist, including YAML, but projection is not an evaluator. See `backend/internal/taskpack/pack.go`, `backend/internal/challenges/store.go`, and `backend/internal/challenges/projection.go` in the sibling backend repository.
- The browser practice flow describes examples, public-check counts, and finishing a saved revision. That model works for code repair but does not represent a sequence of incident decisions. See `frontend/src/scripts/practice.ts` in the sibling frontend repository.

## Exercise shapes and current fit

| Exercise shape | Example | Fit today | Required extension |
| --- | --- | --- | --- |
| Code repair | Fix retry/backoff, readiness, timeout, or idempotency behavior in a Python service | Yes, with deterministic offline fixtures and Python checks | SRE discovery metadata and reviewed content; no new engine required |
| Data/query work | Analyze logs or a synthetic incident dataset with Python | Yes, if the answer is code that Python checks can verify | Better log/metric presentation for realism |
| Configuration repair | Repair a JSON/TOML policy or synthetic alert config | Partly: Python checks can parse these standard-library formats | Domain metadata and file-specific guidance; real tool validation later |
| Prometheus alert rules | Edit YAML rules against synthetic time series | No native evaluator | Pinned `promtool check rules` and `promtool test rules` evaluator, plus rule-test fixtures |
| SQL, JavaScript/TypeScript, Go, Terraform, Kubernetes | Implement a query, service change, or deployment config | No native evaluator | A separately reviewed, allowlisted evaluator for each runtime/tool family |
| Incident response | Diagnose synthetic logs/metrics, choose actions in order, explain impact | No: it is a stateful decision exercise | Scenario schema, deterministic state transitions, action log, tailored result and UI |
| Live service recovery | Repair a multi-service environment and verify SLO recovery | No | Ephemeral isolated environment, lifecycle/quotas/cleanup, network policy, stronger security review |

SRE is a **domain**, not an evaluator. A Python retry bug, a Prometheus rule, and an incident drill are all SRE exercises with different interaction and grading models. Optional `topics` now carry the subject through task packs and reviewed web projections; `category` still describes the practice activity. Keep both separate from the evaluator and from the `familyId` version lineage.

`recommendedKnowledge` is currently per task and optional. The backend's existing `familyId` tracks a task's version lineage; it is not a learning-family taxonomy. Shared learning-family defaults need a separate reviewed family model and inheritance rules before they can be enforced or displayed consistently.

## Contributor intake and discovery

The web creator has two paths. A supported Python task is submitted as a validated schema-1 pack with optional `topics` tags; an unsupported format produces a structured Markdown proposal for a repository issue. The proposal asks for the learner goal, materials, observable evidence, and safe checks. It cannot enter the Python task inbox or appear as runnable practice. This lets contributors describe shell, SQL, configuration, incident, and review exercises now without pretending that those evaluators exist.

Keep the metadata axes independent as the library grows: `topics` for subject discovery, `category` for the learner activity, difficulty and estimated time for guidance, `recommendedKnowledge` for optional background, `familyId` for version lineage, and a future versioned `evaluator` for execution. A new topic tag needs only content review; a new evaluator needs a full contract and runtime review. Generated browser simulations are editorial previews of the source packs and should be checked against them whenever task behavior changes. The current three guided pages use curated scripted fixtures and do not supply grading evidence.

## Recommended rollout

### 1. Pilot SRE content on the existing Python path

The first pack is `tasks/practice/retry-storm`: a retry loop amplifies a rejected upstream request, while synthetic incident notes provide operational context. It uses injected send/wait functions, with no real network or credentials. Its starter passes the two public checks and fails two of five hidden checks; the reference correction passes all seven checks. The `sre` topic tag supports reviewed catalog filtering; it does not change execution capability. Learner testing can now assess whether this SRE scenario is useful before building another runtime.

`tasks/practice/webhook-allowlist` adds a cybersecurity scenario using the same Python evaluator. The learner repairs an outbound callback URL policy against synthetic lookalike hosts and malformed URL forms. No request is made, and this preflight exercise does not claim to be a complete SSRF defense. Its starter passes three public checks and fails five of six hidden checks; a corrected workspace passes all nine checks.

`tasks/practice/proc-stat-parser` adds a Linux operations scenario using synthetic `/proc/<pid>/stat` records and the same Python evaluator. It checks that learners preserve the parenthesized process name before reading later numeric fields. It does not read the live host or require a Linux desktop. Its starter passes two public checks and fails four of six hidden checks; a corrected workspace passes all eight checks.

### 2. Add a versioned evaluator contract for static artifacts

Introduce a new task-pack schema version with an explicit exercise kind, domain, editable/read-only artifact roles, evaluator identifier/version, and bounded evaluator-owned fixtures. Preserve schema-1 decoding and grading for existing tasks; a released schema number must not change meaning. The Go validator, TypeScript protocol, task importer, desktop loader, challenge projection, API, and authoring tools must agree on this shape before a v2 pack can be published.

Use an allowlist of product-owned evaluators. The task may select a reviewed evaluator ID and supply bounded fixture data; it must never supply a shell command, Docker image, network permission, host path, or arbitrary package install. Each evaluator declares supported files, execution limits, platform support, and a stable result schema. The server resolves the pinned tool/image and authenticates the task and saved revision. Keep practice feedback distinct from any future trusted grade or reward evidence.

The first new evaluator should be Prometheus alert rules. Prometheus documents `promtool check rules` for syntax/semantic checks and `promtool test rules` for unit tests with synthetic series ([command reference](https://prometheus.io/docs/prometheus/latest/command-line/promtool/), [rule-test format](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)). This gives an authentic SRE task without a live cluster. A reviewed fixture can test alert timing, labels, and false positives. Pin the `promtool` version in the worker and make version/provenance visible in results.

### 3. Add an incident-simulation exercise kind

Represent synthetic signals, timeline events, permitted actions, transition rules, time/impact budget, and expected outcomes as reviewed scenario data. The learner sees dashboards/logs and chooses bounded actions; the simulator records sequence, timing, state changes, and a short rationale. Grade objective outcomes deterministically (for example, time to mitigate, user impact, unsafe action, recurrence). If rationale matters, use a human rubric; an AI explanation can assist learning but should not become an unreviewed authoritative score. Google’s [SRE incident-response workbook](https://sre.google/workbook/incident-response/) supports drills and post-incident learning as useful practice formats.

### 4. Consider live labs only after the static paths are sound

Multi-container or cluster exercises need provision/teardown, per-attempt isolation, resource and time budgets, no production credentials, auditable fixtures, and a separate security/operational review. Do not expose a real shell or cloud account simply to make the browser look like an IDE. A simulated terminal can be honest about the allowed actions; actual commands belong inside an isolated lab.

## Where implementation work lands

| Area | First change for a new evaluator |
| --- | --- |
| `base/packages/protocol` | Define a v2 manifest and discriminated job/result schemas; keep schema-1 parsing intact |
| `backend/internal/taskpack` and challenge publication | Validate v2 packs and evaluator-specific fixtures; store domain separately from activity/category; review and pin evaluator eligibility |
| `base/packages/engine` and private browser worker | Dispatch only reviewed evaluator IDs; provide pinned tools, resource limits, cancellation, and result provenance |
| `frontend` and desktop app | Show supported task capabilities, editable/read-only files, appropriate context panels, and type-specific feedback; explain unavailable local runtimes |
| Authoring and release tooling | Add per-type templates, reference solutions, fixture validation, cross-platform or hosted-worker verification, and publication checks |

## Cross-cutting implementation requirements

1. **Protocol and compatibility:** Discriminated task/evaluator/result types with versioned schemas. Old clients should reject unsupported task kinds clearly rather than misread them as Python tasks. Historical attempts must retain their task/evaluator pins.
2. **Evaluation:** Shared lifecycle for validate, run, cancel, collect bounded feedback, and cleanup; distinct results for learner errors, failed checks, timeouts, and infrastructure failure. Preserve task hash, saved revision, evaluator/tool version, fixture hash, and practice/trust classification.
3. **Content review:** Per-type authoring templates, starter-fails/reference-passes checks, deterministic fixtures, difficulty calibration, accessibility review, licensing, and a human publication gate. Never bundle actual secrets or private production incident data.
4. **UI:** Render by capability: code/config editor, log/metric/timeline viewer, action panel, and evidence/results. Replace generic “N of M checks” wording where the activity is a decision sequence. Keep the desktop and browser task identity, progress, and result provenance consistent.
5. **Platform support:** A local evaluator must be verified on macOS, Windows, and Linux; alternatively use the same private hosted worker for all clients and make that requirement explicit. A Linux container test alone does not verify desktop local behavior on all three operating systems.
6. **Operations:** Bound file sizes, execution time, concurrency, result retention, cancellation, and worker cleanup for each evaluator. Do capacity and hostile-multitenant review before enabling public browser execution.

## First vertical slice acceptance criteria

Start with the existing Python SRE pack, then the Prometheus rule pack. For the rule pack, require: a versioned manifest accepted by all contract validators; a reviewed rule and synthetic-series fixture; starter failure and reference success in the pinned evaluator; browser save/check/reload/cancel feedback tied to the exact revision; clear evaluator version and practice provenance; no task-supplied command/image/network options; and documented macOS/Windows/Linux behavior. Keep incident simulation as a separate follow-on slice once this path works end to end.
