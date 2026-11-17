# Practice problem map

Use this map to choose a distinct learning goal before writing a pack. It is a content plan, not a new task schema or a promise that every idea is available to learners. The task ID remains the stable identity of one version; changing expected results requires a new ID. The backend's `familyId` currently tracks version lineage and does not define a learning path.

## Current bundled practice

| Problem | Focus | State |
| --- | --- | --- |
| `library-fines` | Date and billing rules in a small library service | Active |
| `monthly-revenue` | Diagnose a report across a multi-file data flow | Active |
| `proc-stat-parser` | Parse Linux procfs process data without shifting fields | Active |
| `retry-storm` | Bound retries during a synthetic service incident | Active |
| `webhook-allowlist` | Validate synthetic outbound callback destinations | Active |
| `dedupe-ids` | Stable customer identifiers | Retired; kept for earlier attempts |
| `pagination-api` | API pagination boundaries | Retired; kept for earlier attempts |

## Good directions for new problems

Choose one primary behavior per problem. These are prompts for contributors, not reserved IDs or fixed sequences.

| Area | Example symptom to design around | What a good correction demonstrates |
| --- | --- | --- |
| Data correctness | A report double-counts records after a retry | Trace data flow and preserve idempotency |
| API behavior | A client loses a page when a cursor crosses a boundary | Define and test a stable pagination contract |
| SRE and reliability | A worker keeps retrying a permanent failure | Separate retryable failures, add a bound and preserve evidence |
| Linux operations | A host monitor loses a process with a spaced name | Parse procfs records without shifting later fields |
| Cybersecurity | A callback URL passes a weak allowlist check | Parse the URL and enforce the exact destination policy |
| Context and judgment | A suggested fix passes a narrow test but breaks a stated constraint | Compare the suggestion with the brief and public behavior |
| Refactoring | A change improves readability but changes observable output | Preserve behavior while simplifying code |

For every proposal, state the learner's **one main decision**, the visible symptom, the expected behavior, helpful background, approximate time and what a corrected workspace must pass. Keep the brief about the symptom rather than revealing the fault. Prefer a small starter and deterministic checks; a larger repository is useful only when navigating it is part of the learning goal.

Web challenge categories describe the practice type (`debugging`, `refactoring`, `context`), while optional `topics` tags describe the subject. Difficulty (`beginner`, `intermediate`, `advanced`) and estimated time are chosen during web publication. `recommendedKnowledge` is optional guidance, not an access gate. Do not use these fields to claim an ordered curriculum or prerequisites between tasks.

To contribute, use the [problem guide](contributing-problems.md), the [pack format](task-packs.md) and the [problem proposal issue template](https://github.com/33sakib33/Factoryze/issues/new?template=practice-problem.yml). For a browser submission, use the website's Create a task form. Maintainers review and enable hosted packs before making a web brief public; repository packs follow their own PR and release checks.

## Desktop discovery at catalog scale

Home lets learners browse by topic, search task metadata and view 20 results per page. It renders only the current page; Continue and Results remain separate from the public catalog. A task without topic tags appears under General. Tags describe subject matter and do not create prerequisites or an ordered course.

Home now loads bundled tasks locally and requests hosted metadata from the service in pages of 20. The service uses an indexed keyword search, exact topic filters, a stable task-ID cursor, and topic counts; it returns at most 50 records per request. Home renders only the current local and hosted pages. Starting an older saved result resolves its task directly by ID, so it is not limited to a previously loaded page. Archive downloads still happen only on explicit Start, and bundled tasks and attempts remain available while offline. The legacy `/api/tasks` and `/api/desktop/tasks` list routes retain their 500-task cap for older clients; current Home uses `/api/tasks/search`, `/api/tasks/topics`, and `/api/tasks/{id}` instead.
