# Browser challenges and social rewards: development flow

Status: technical handover drafted 2026-11-06; D1 synthetic website prototype implemented 2026-11-07 after the owner's instruction to start. The remaining runnable MVP/reward design is proposed scope, not implemented behavior. Review experience and relevant technical/policy decisions before implementing subsequent slices, as requested in §20 of the supplied PRD.

Source: the owner's supplied **AI Developer Reward & Social Engagement System** PRD, read together with the owner's direction to retain the Go backend and reduce the installation barrier. Existing desktop/lab release gates remain separate in [PLAN.md](../PLAN.md).

Implementation checkpoint (2026-11-07): the sibling `frontend` now serves `/challenges/delivery-fee/`, with a landing CTA, anonymous demo, scripted suggestions, approval/rejection, simulated checks, retry/completion, opt-in tab-local saving and a private sharing preview. Nine new browser tests, fourteen existing frontend regression tests and the static build pass; the frontend's `verification/2026-11-07-browser-challenge.json` records the checks and limits. The demo runs no Python/model/API requests, transfers no progress to an account and awards no XP. It is D1 experience groundwork, not evidence that D4 execution or D8 rewards are complete. Human experience review is still open.

Foundation checkpoint (2026-11-07): D2 learner membership/privacy and the D3 safe catalog/publication foundation now exist in the Go backend behind `COMMUNITY_ENABLED` (default false). Learners reuse the existing email principal/contributor profile ID without a funding grant. Preferences default off, require the current policy and expected version, and commit with an audit record. The website exposes private controls on `/account/`, public read-only catalog browsing at `/challenges/`, and selected-file details at `/challenges/task/?slug=...`. The administrator API creates a draft from an enabled hosted pack and an explicit workspace-file allowlist; opening requires review acknowledgement. Public DTOs exclude hidden/private archive contents, and source disablement removes future public access. Membership/collection settings, safe source projection and actual local SMTP/MongoDB browser flows are verified; activity collection, executable challenge participation, account-owned attempts and XP remain future slices. Publication currently uses the admin API; a dedicated challenge management UI, runner/evaluator pinning and a curated production task are still pending. See backend `docs/community.md` and `docs/community.openapi.json` for implemented contracts rather than assuming all proposed APIs below exist.

Ownership checkpoint (2026-11-07): the D5 storage/claim foundation is implemented separately behind `BROWSER_ATTEMPTS_ENABLED` (requires community enablement; defaults off). Published safe task projections can become private server-owned starter copies with explicit revisioned saves. Anonymous drafts are capability-bound for up to 24 hours; verified email users can explicitly claim them, or directly start account drafts, for up to 90 days. Account lists/resume and source-clearing deletion are implemented. Browser cookie hashes, a separate write nonce, strict same-origin mutation checks, replay keys/tombstones, transactional single-owner claims, expiry and quotas protect this boundary. Backend and real local SMTP/MongoDB browser tests pass. This is draft editing only: no execution, grading, model calls, submission snapshots, reward outbox/XP or public achievements. The existing delivery demo remains synthetic and cannot supply reward evidence. See backend `docs/attempts.md` / `docs/attempts.openapi.json`; D4 execution is still open.

Execution checkpoint (2026-11-07): the first D4 component is a disabled private one-shot TypeScript worker, with protocol-owned immutable job/result contracts, input/image binding, fixed public-check commands, separate reviewed test material, bounded practice feedback and cancellation/cleanup. Ten deterministic cases and real Docker starter/fix/resource/cancellation journeys pass; the complete base suite passes 257 tests and typecheck. See [worker setup and boundaries](browser-check-worker.md). Go admission/leases/quotas and the browser Run checks action are not integrated yet. Every worker result is practice-only and explicitly ineligible for rewards; D4 public execution and D7/D8 trusted grading/rewards remain open.

Queue checkpoint (2026-11-07): D4 private-pilot wiring now connects saved browser drafts to Go/MongoDB admission, reviewed public evaluator pins, finite immutable jobs, one global lease, quotas, heartbeat/recovery, cancellation/deletion and private revision-labelled feedback. The TypeScript controller runs on separate worker capacity and uses a dedicated authenticated Go listener; the public API has no Docker socket. Astro adds Run checks, refresh/reload recovery and cancellation. Feature flags default off, every result remains practice/reward-ineligible, and there is no deployment. Real browser→Go→MongoDB→worker→Docker verification observes 1/2 starter checks, 2/2 after an explicit save, restored results, foreign-browser denial and cancelled execution. Public-service security/capacity review, guided AI, immutable trusted grading/submissions and rewards remain next.

Guided-practice checkpoint (2026-11-07): a separate default-off Go flag now enables reviewed goals/examples and optional authored hints, plus an explicit private finish. The editor and result screen support a complete try/check/finish/retry journey. Server admission captures immutable private code and current completed public-check evidence, preserves exact retries, bounds history and follows existing browser/account ownership, expiry and deletion. A real local Docker/SMTP browser journey progresses from a saved 1/2 result to a saved 2/2 result, retains the original copy, explicitly claims both into an account and deletes them with the draft. No model, optional activity collection, public sharing, trusted grade or XP is added. This is the D7 practice-submission foundation; tamper-resistant evaluation and D8 reward accounting remain separate gates. See sibling backend `docs/practice.md` and `docs/practice.openapi.json`.

## 1. Product direction and scope decisions

**First outcome:** someone can discover a challenge, try it in the browser, see a useful result, and optionally save and share their progress. Task creators receive attribution and evidence that their work helps people.

Proposed growth loop:

**Discover → Try → See progress → Save → Earn → Share → Return → optionally install the desktop app.**

The supplied PRD is a long-term feature inventory, rather than a single release backlog. These adaptations reconcile it with the existing project:

| PRD proposal | Development decision |
| --- | --- |
| NestJS and Mongoose | Keep Go `net/http`, the official MongoDB driver, and existing services. |
| Next.js App Router | Keep Astro and TypeScript; interactive challenge screens do not require a site rewrite. |
| Redis and BullMQ | Use durable MongoDB jobs and a Go worker initially. Add a broker/cache only after measured operational need. |
| Install desktop before earning | Offer the first browser challenge before registration or installation. Desktop is an optional deeper workflow. |
| Public profile for every account | Private by default, with explicit opt-in for a profile and individual public achievements. |
| Reward arbitrary LLM usage | Reward defined task milestones. Do not reward tokens, spending, prompt volume, or elapsed time alone. |
| Track VS Code, Cursor, and other clients | Initially support Factoryze's own instrumented browser/desktop flows. Other integrations require separate discovery and consent. |
| Creator rewards in the final phase | Reuse existing accepted-task recognition in the first milestone so both sides benefit. |
| Referrals, streaks, teams, global rankings, redemption in the early funnel | Sequence after the browser loop and reliable reward accounting. |
| Existing hosted roadmap mentions Postgres | Keep MongoDB for this bounded community MVP. This does not migrate or implement the broader hosted institutional product. |

Proposed first audience: individual developers trying short AI-assisted debugging tasks. Classroom assessments remain a separate product flow. This audience and the browser-first sequence are recommendations for review, not already approved implementation policy.

## 2. Discovery: what exists and what can be reused

| Repository / component | Observed implementation | Reuse and gap |
| --- | --- | --- |
| `frontend` | Astro site, email sign-in, task authoring/upload, account and administration screens; contributor wall and linking UI on review branch | Extend existing pages and styles. No browser task runner or learner dashboard exists. |
| `backend/internal/trial` | Email OTP, separate browser/native/admin credentials, GitHub sign-in/linking, sponsored gateway and durable monetary accounting | Reuse principal validation, origin checks and admin authorization. Reward membership must work without a sponsored invitation or balance. |
| `backend/internal/contributors` | Separate profiles, GitHub mapping, one accepted-task award per task ID, badges and public opt-in | Keep the existing ownership evidence; introduce learner milestones without replacing the accepted-task count. Implementation still awaits release review/configuration. |
| `backend/internal/catalog`, `taskpack`, `submissions`, `httpapi` | Pack validation, disabled-by-default publication, review and hosted ZIP downloads | Publish a separate browser-safe task projection. Current downloads contain hidden checks and cannot be passed directly to a browser. |
| `base/packages/engine` | Factoryze harness, task loader, local practice reports, token metering, lab runtime and opt-in Docker grader | Reuse behavior and test fixtures behind an internal worker adapter. A hostile public runner and persistent agent sandbox are new work. |
| `base/packages/protocol` | Versioned TypeScript/Zod engine and lab contracts | Own engine-facing execution contracts here. Document the Go-owned community HTTP contracts in OpenAPI and test compatibility with shared fixtures. |
| `base/packages/app` | Theia/Electron desktop for Windows, macOS and Linux; native email login with keychain credentials | Add opt-in reward sync later. It is an integrated AI client, not a passive observer of every developer tool. |
| `factoryze-setup` | Compose deployment with frontend, Go backend, MongoDB replica set and proxy | Add private worker configuration and separate execution capacity; keep the public API away from the Docker socket. |

Existing observable facts include task starts, saved submissions, local check results, server-observed gateway requests/usage, accepted creator awards, and lab submission/grade records. Local events and local correctness are user-controlled evidence. Gateway usage proves a provider request occurred; it does not prove a useful solution or skill.

Important limit: [the Docker grading guide](docker-grading.md) explicitly says the current grader is not a reviewed hostile multi-tenant service, and student Python can interfere with in-process tests. Do not expose the existing lab server publicly or relabel its results as verified skill credentials.

## 3. Delivery phases

| Phase | User outcome | Included | Exit gate |
| --- | --- | --- | --- |
| 0 — Design and experience prototype | Review the first challenge and reward rules | This handover, [screen wireframes](social-rewards-ux-flow.md), a curated task, synthetic experience prototype | Scope, evidence model, execution boundary and expected running-cost ceiling reviewed. Prototype is labelled as synthetic. |
| 1 — Browser participation MVP | Try, improve, finish, save and share one challenge | One curated Python task; anonymous attempt; constrained AI assistance; isolated checks; progress/result screen; account claim; creator credit; ledger; basic XP/levels/milestones; private dashboard; opt-in public achievement; admin controls | The complete journey passes with real isolated execution and synthetic inference, duplicate processing cannot duplicate awards, and public execution has a recorded security review. |
| 2 — Retention and optional desktop | Return for a new challenge and carry progress across surfaces | More curated tasks, recurring challenges, eligible activity days/streaks, consented desktop sync, referral attribution and delayed activation rewards | Daily boundaries, offline retries, device revocation and referral abuse cases pass; repeat participation is measured. |
| 3 — Community and creator discovery | Discover and learn from others | Opt-in profiles, follows/feed, explicitly published prompts/workflows, saves/appreciation, moderation and challenge-specific rankings | Moderation is operational; public visibility and reaction abuse controls pass. |
| 4 — Teams and reward economy | Participate in managed group competitions and partner rewards | Teams, competitions, reviewed skill assessments, separate redeemable balance/catalog | Independent budget, eligibility, fraud and operations design reviewed before rollout. |

Phase numbers here describe the community workstream, not the existing desktop releases 0.1–1.0. Do not expand Phase 1 to include the entire PRD.

## 4. Phase 1 experience and task lifecycle

1. The landing page offers **Try a 5-minute challenge** with an understandable bug, concrete example and creator credit.
2. A visitor starts an anonymous, expiring server attempt. No account, download, local provider key or sponsored invitation is required to see the experience.
3. The challenge screen shows the brief, a small code area, AI conversation, change approval, **Run checks**, progress and an optional hint. The time estimate is guidance, not a countdown penalty.
4. AI edits are proposed against a known workspace revision. Approving an edit updates that revision; a stale approval is rejected. Hidden checks stay server-side.
5. Public check runs give quick feedback. An explicit submission grades an immutable revision against the pinned task/evaluator. A failing submission can still earn the one-time participation milestone.
6. The result explains what passed and offers retry, another challenge, **Save progress**, and optional sharing. Do not expose hidden test inputs, test source or private execution output in a share card.
7. Email sign-in claims the visitor's own attempt atomically and calculates eligible rewards. Anonymous results do not count toward public totals or creator impact until claimed and eligible.
8. The account shows Created, Attempted and Completed separately. Creator attribution accompanies the task and shared result. Completion means this challenge's checks passed, not certification as an AI expert.

Challenge publication: `draft → reviewed → scheduled/open → closed → archived`; cancellation is an audited alternative. First release can publish one open challenge without scheduling UI. Review verifies the reference solution, starter behavior, task rights, age-appropriate public content, and supported dependencies. New packs still start disabled.

Attempt execution: `created → ready → working → submitted → grading → passed/needs_work`; `expired`, `cancelled` and infrastructure `failed` are separate outcomes. Retrying creates a new submission revision, not a new eligibility entitlement. A terminal grade never changes because mutable workspace files changed later.

## 5. System architecture and boundaries

```text
Browser / Astro                  Existing Factoryze desktop (Phase 2)
        |                                      |
        +------- Go public API + auth ----------+
                      |
          profiles / challenges / rewards
                      |
       MongoDB replica set: domain records,
       immutable reward ledger + durable jobs
                      |
               Go job worker
                      |
         private TypeScript execution service
         (base engine + new hosted adapters)
              /                     \
     isolated task tools       isolated grader
                      |
          minimal result/evidence → Go API
```

The Go backend owns accounts, authorization, challenges, profiles, reward policies, ledger, referrals, moderation and public APIs. The TypeScript service reuses the existing task engine; it does not become a second public account/reward backend. Keep SQLite-based lab state local to the existing lab product, not the community reward source of truth.

The browser receives no provider key, hidden-test archive, internal worker credential, host path or Docker parameters. The Go API neither imports arbitrary task code nor runs it natively. Workers use a private authenticated protocol, an allowlist of server-selected task versions, pinned images and strictly validated results. Only a matching active lease and submission hash can finalize a grade.

For the first runnable slice, restrict tools to bounded read/search/edit operations plus a predefined public-check command. A requested shell action maps to that fixed command; arbitrary terminal commands, network access, package installation, arbitrary uploads and external integrations are outside Phase 1. User code still requires an execution sandbox even with these restrictions.

Run executors on separate worker capacity without production credentials, database access or access to the public API host. The privileged controller owns the Docker socket; student containers never receive it. Preserve resource/time/output limits, deny network access, isolate tenants, clean up on cancellation/restart, and review hidden-test tampering before rewarding public results. Judge/assessment-trial features remain off. Failure to provision safe execution blocks runnable release; a synthetic preview must remain visibly a preview.

Existing sponsored credentials are account/invitation scoped. Anonymous play therefore needs a new **bounded challenge funding policy**: server-owned allowance per attempt and program, capped concurrency, maximum attempt lifetime, per-origin/account/network controls, durable reservation/settlement, and an operator kill switch. Reuse accounting invariants rather than bypassing the gateway or granting anonymous users trial credentials. Monetary funding and XP are different ledgers. Development uses synthetic inference; paid checks require explicit spending approval and a cap.

## 6. Identity, claim and consent

- Use the existing verified email account as the first-release login anchor. Map it to the existing contributor profile ID, which becomes the common community `memberId`. Provision membership for learners even with zero accepted tasks. No profile is public automatically.
- GitHub linking attaches contribution evidence; it does not merge `email:*` and `github:*` trial accounts, invitations, balances, sessions or administrator permissions. GitHub-only users follow the existing email verification/link path before claiming learner rewards.
- Anonymous attempts use a random secret stored as a hash server-side and sent in a Secure, HttpOnly, SameSite cookie. Use a separate browser-bound nonce for creation/claim, same-origin mutation checks, finite expiry and bounded request sizes. An attempt ID or share URL is never ownership proof.
- `claim` requires both the authenticated email session and the original anonymous capability. Set `ownerMemberId` once, enqueue eligibility in the same database transaction, and reject cross-account replay. Two concurrent claims cannot both win. A claim transfers only that attempt, never a budget account or another device's history.
- Temporary anonymous progress can be recovered for a proposed 24-hour retention window, disclosed when starting. No durable XP belongs to an anonymous identity. Account claim is optional after play.
- Running a hosted task requires processing its challenge prompt/code to provide the requested service; explain this before start. Optional activity sync, analytics, public sharing and research are distinct consent purposes. Declining optional collection does not block playing or completing a task.
- Phase 1 stores minimal milestone evidence, not a general conversation archive. Prompt/code material needed during execution is temporary and private. Redaction is defense in depth, not a guarantee that secrets can be safely published.
- Desktop Phase 2 reuses native OTP/keychain sessions, adds a revocable installation record and consent version, and uploads only allowlisted metadata. Pairing proves account/session possession, not a genuine untampered installation or a truthful local grade. No browser cookie becomes a desktop/admin credential.

## 7. Data model and indexes

These are proposed new schemas, not migrations already applied. Use the existing MongoDB connection/replica set. Collection names below follow the backend's snake_case style. All timestamps are UTC; user-day calculation is explicit.

| Collection | Main fields | Required uniqueness / query indexes |
| --- | --- | --- |
| Existing `contributor_profiles` | Existing identity fields; add optional `usernameNormalized`, bio/avatar reference and field-sharing preferences | Preserve email/GitHub uniqueness; partial unique username; no automatic public opt-in. |
| `member_consents` | `memberId`, purpose, policy version, granted/withdrawn timestamps | `(memberId, purpose)` unique; immutable consent changes in audit. |
| `challenges` | ID, stable `challengeFamilyId`, slug, title, category, difficulty, state, accepted task ID, archive hash, public projection, evaluator/image versions, author reference, opening/closing times | Unique slug; `(state, opensAt)`; immutable execution pin per published revision; reviewed family identity prevents version-based repeat rewards. |
| `challenge_attempts` | ID, member or anonymous capability hash, challenge/version, workspace revision, state, expiry, claim record | Unique capability hash where present; `(memberId, challengeId, createdAt)`; explicit expiry checks and cleanup. |
| `challenge_submissions` | ID, attempt, revision, immutable snapshot hash, idempotency key, grade state, trusted evaluator evidence, sanitized checks, retry number | `(attemptId, idempotencyKey)` unique; `(attemptId, revision)` unique. Same key with changed input returns conflict. |
| `execution_jobs` | Attempt/submission, command kind, expected revision/hash, state, availability, worker lease token/expiry, bounded retry count, trusted result digest | Unique operation key per attempt; `(state, availableAt, leaseExpiresAt)`; a stale worker cannot finalize a reassigned job. |
| `reward_events` | ID, member, schema/event type, source reference, trust class, `occurredAt`, `receivedAt`, evidence hash, policy pin, decision/status | `(producer, sourceEventId)` unique; event type is part of the producer's stable source ID; `(memberId, occurredAt)`; mismatched duplicate payload is conflict. |
| `reward_jobs` | Kind, source ID, state, availability, lease token/expiry, attempts, last safe error | `(kind, sourceId)` unique; `(state, availableAt, leaseExpiresAt)` for leasing/recovery. |
| `reward_rules` | Semantic rule ID, immutable version, enabled/effective dates, XP, caps, eligibility/evidence requirements | `(ruleId, version)` unique; optimistic concurrency for updates. |
| `reward_ledger` | Entry ID, member, event, semantic `grantKey`, rule/version, signed XP delta, reason, source, optional reversal reference, created timestamp | Unique `grantKey`; `(memberId, createdAt, id)`; a reversal key permits only one full reversal per original grant. |
| `member_rewards` | Member, XP, current level, achievement IDs, summary revision | Unique member; rebuildable from committed ledger and milestone evidence. |
| `achievement_definitions` / `member_achievements` | Versioned evidence criteria; member, achievement, source proof, earned/revoked timestamps | Definition/version unique; `(memberId, achievementId, scope)` unique; retain audited revocation history. |
| `member_level_history` | Member, prior/new level, ledger sequence or config version, timestamp | Unique triggering transition key; `(memberId, createdAt)`. |
| `public_achievements` | Opaque share ID, member, source award, explicit visibility, approved public fields | Unique share ID and `(memberId, sourceAwardId)`; no private payload. |
| `creator_task_impact` | Accepted task ID, participating member, milestone, source evidence, eligibility state | `(taskId, memberId, milestone)` unique; rebuildable counts exclude the author and ineligible members. |
| `community_audit` | Actor, action, target, reason, safe metadata, timestamp | `(target, createdAt)`; restricted access, no credentials or raw prompts. |

Execution snapshots belong in a separate private TTL-backed store, never in reward ledger entries or public activity payloads. Durable grade evidence retains hashes and versions after snapshots expire. Proposed retention for review: anonymous attempts and execution files 24 hours; claimed sanitized private results 90 days; operational logs 14 days; identifiable analytics 30 days followed by aggregates. Expose deletion controls and deletion-job status. Ledger/audit retention and account erasure must be finalized before launch; auditability does not imply permission to retain personal data forever. Deletion must also cover external execution files and caches, not only MongoDB TTL documents.

Add Phase 2 collections only with their feature: `installations`, `activity_days`, `referrals`, `referral_milestones`. Add Phase 3 community/follow/reaction/feed collections and Phase 4 team/redemption collections then, rather than scaffolding all PRD collections now.

Migration order: backup and preflight → create additive collections/indexes → dry-run identity/award adapter → deploy with writes disabled → enable a small cohort → verify/rebuild projections. Do not rename existing account IDs. Historical creator-award XP is off until an explicit backfill policy is reviewed; any backfill has a source key and dry-run report. Rollback disables new producers/workers and restores the prior application; preserve committed ledger records instead of deleting earned history.

## 8. Reward policy and processing

### Proposed launch rules

XP values are reviewable product defaults, not accepted economics. Administrators can version future rules without rewriting prior awards.

| Event / milestone | Proposed recognition / XP | Evidence and limit |
| --- | --- | --- |
| Open task, prompt, run checks, download installer | Progress feedback; 0 XP | No reward for volume or a click. |
| First meaningful attempt at a challenge | Explorer milestone; 10 XP | Claimed server submission includes a non-starter code change or a completed task-specific diagnostic step checked by the server. A prompt alone is insufficient. Once per member/challenge family; participation, not skill proof. |
| Complete a challenge | Completion milestone; 40 additional XP | Trusted evaluator passes all required checks on the submitted snapshot. Once per member/challenge family. |
| Publish an accepted original task | Existing author badge/count; proposed 100 XP | Existing accepted-award source, one task ID across hosted and GitHub routes. Corrections/republication do not earn again. |
| Reach 5 accepted tasks | Existing Community Builder badge | Derived from accepted awards; no automatic extra XP in MVP. |
| Unique people attempt/complete an author's task | Creator impact counts and attribution | Eligible claimed members, deduplicated; exclude author activity and flagged accounts. No automatic impact XP initially. |
| Onboarding, pairing, streak, referrals, appreciation | Disabled in Phase 1 | Decide eligibility and values with each later feature. Do not silently enable the PRD's overlapping sample rewards. |

An attempt reward and completion reward may both apply, for 50 total proposed XP per challenge. Aggregate participation/completion XP is capped at a proposed 100/member/day; accepted-author grants have a separate policy. A capped grant records a terminal no-award decision and is not replayed on a later day. Milestone badges may still appear when XP is capped. The participation rule is low-stakes encouragement; it cannot establish expertise. If meaningful-attempt validation is not ready, ship its milestone privately with 0 XP rather than award every arbitrary submission.

First release XP rules use UTC calendar days, disclosed in the UI. Later streaks may use a member-selected IANA timezone: pin it for an active streak, record changes, apply a cooldown and do not rewrite historic days. An eligible day requires a meaningful accepted task milestone; a login, request heartbeat, token spend or repeated submission alone does not count. Enforce caps transactionally across all devices.

Level thresholds may begin with the PRD's proposed 0/500/1,500/3,500/7,000/15,000/30,000 values, versioned in configuration. Use neutral progression labels such as Explorer/Builder/Contributor until skill criteria exist. XP-based level titles must not claim verified engineering expertise. Store level transitions, including changes caused by corrections or reviewed threshold updates; do not issue historical milestone grants again after recalculation.

### Transaction and failure sequence

1. Accept an authenticated action or signed/private worker result; derive the member from the server principal/attempt, never a request's user ID.
2. Validate schema, source, consent where applicable, active lease, immutable revision and evidence class. Save the domain fact plus durable job in one transaction (transactional outbox behavior).
3. A Go worker leases jobs atomically with an expiring lease token. Delivery is at least once. Expired leases recover after a crash; retries use bounded backoff and eventually enter a review queue.
4. Resolve immutable reward policy version and semantic eligibility key. A grant key such as `member:challenge-family:completion` survives producer retries, rule-version changes and browser/desktop participation. Task revisions cannot create repeat rewards; genuinely new challenges need an explicit new family.
5. In one MongoDB transaction, enforce cap/uniqueness, record the eligibility decision, append ledger entry, update the rebuildable summary/level history/achievements, and create any consented public projection job. Concurrency cannot exceed a cap or grant twice.
6. Commit processing status in the job/event decision record, not by editing a historical ledger entry. A crash after commit can repeat delivery without repeating the award.
7. Publish only an allowlisted opted-in achievement projection. Recheck current visibility at read time; hiding/deleting an achievement invalidates its public endpoint and caches.
8. An administrator correction appends a signed compensating entry with actor/reason and updates projections atomically. It never overwrites a grant. The ledger sum remains the authoritative XP balance.

Treat malformed/infrastructure-failed execution as an operational failure, not a learner's failing grade or successful participation. A matching duplicate returns the original result; a mismatched duplicate returns 409. Admin policy changes apply prospectively; deliberate regrading/backfill has its own reviewed job and audit trail.

## 9. Proposed API contract

These paths are a design proposal; existing `/api/auth/*`, `/api/user/contributions`, `/api/contributors`, `/api/desktop/*` and administrator routes retain their behavior. New API definitions must include request/response schemas, authorization, examples, pagination and error cases in OpenAPI before client implementation. Extend the existing email/admin guards; do not introduce another login system.

| API | Principal | Contract / result |
| --- | --- | --- |
| `GET /api/challenges?cursor=&limit=` | Public | Published safe metadata and author attribution only; stable keyset pagination, default 20/max 50. |
| `GET /api/challenges/{slug}` | Public | Brief, public starter files/check descriptions, estimate and eligibility; never the full task ZIP. |
| `POST /api/challenges/{slug}/attempts` | Anonymous browser capability or member | `{clientRequestId, consentVersion}`; allocate bounded attempt and HttpOnly capability; replay-safe 201/200. |
| `GET /api/attempts/{id}` | Owning capability/member | Safe workspace revision, state, budget, submitted results and expiry. |
| `POST /api/attempts/{id}/prompts` | Owner | `{requestId, revision, text}`; bounded server funding and one active prompt; 202 plus operation ID. |
| `GET /api/attempts/{id}/events?after=` | Owner | Bounded ordered polling for text/proposed diffs/status; reconnect cursor. Polling avoids a first-release streaming proxy rewrite. |
| `POST /api/attempts/{id}/approvals` | Owner | `{operationId, toolCallId, revision, decision}`; one-use, revision-bound approve/reject. |
| `PUT /api/attempts/{id}/files` | Owner | Bounded allowlisted edits with expected revision; no arbitrary filenames/uploads or hidden files. |
| `POST /api/attempts/{id}/checks` | Owner | `{requestId, revision}`; enqueue predefined public checks; public sanitized output. |
| `POST /api/attempts/{id}/submissions` | Owner | `{requestId, revision}`; immutable snapshot, 202; result retrieved through owner attempt view. |
| `POST /api/attempts/{id}/claim` | Email browser session + capability | `{requestId}`; claim once, enqueue rewards, return owned result; no client XP/pass flag accepted. |
| `GET /api/user/rewards` | Member browser session | XP, level/config version, next threshold, badges, pending awards and separate Created/Attempted/Completed totals. |
| `GET /api/user/reward-ledger?cursor=&limit=` | Member | Own paged grants/reversals and safe reason/source labels. |
| `GET/POST /api/user/privacy` | Member | Purpose/version-specific consent, retention preferences and audited changes. |
| `POST /api/user/data-deletions` | Member | Selected supported deletion scope; asynchronous status, revocation and audit retention explanation. |
| `POST/DELETE /api/user/achievements/{id}/share` | Member | Explicit publish/hide of allowlisted result; membership and source award ownership checked. |
| `GET /api/achievements/{shareId}` | Public | Public snapshot only while current opt-in and award validity permit; otherwise 404. |
| `GET/POST /api/admin/challenges` and `POST /api/admin/challenges/{id}/state` | Existing admin session | Curated pin/publication state; reason and version required for changes. |
| `GET/POST /api/admin/rewards/rules`, `POST /api/admin/rewards/adjustments` | Existing admin session | Versioned rules/caps/thresholds; compensating entry with reason, expected version and idempotency key. |
| `GET /api/admin/rewards/jobs` and `POST /api/admin/rewards/jobs/{id}/retry` | Existing admin session | Safe failure evidence and bounded audited retry; never public code or secrets. |

All mutations enforce the applicable origin/CSRF or native checks. Public capability endpoints also enforce same-origin requests. Errors use safe machine codes: 400 invalid input, 401 unauthenticated, 403 wrong owner/ineligible, 404 hidden/absent, 409 revision/idempotency conflict, 410 expired attempt, 429 rate/capacity limit, 503 unavailable. Preserve existing gateway-specific accounting errors rather than flattening them. Result and dashboard views explain pending/expired/unavailable states without treating them as zero XP or a failed challenge.

Phase 2 API additions: authenticated native metadata ingestion and installation status/revoke; eligible activity/streak views; referral link, one-time attribution and milestone history. Phase 3 adds member profile/follow/post/reaction/feed endpoints with independent visibility/moderation. Internal Go↔TypeScript commands are private, versioned and scoped to attempt/submission/lease; possession of that credential never grants public administrator access.

## 10. Referrals, desktop and social sequencing

### Desktop and streaks (Phase 2)

Keep native OTP/keychain login. A signed-in installation can register an opaque installation ID, list/revoke its sessions, and choose metadata sync. Client batches use deterministic event IDs, bounded clock skew/late-arrival windows, offline retry and a pinned consent version. Recheck withdrawal at ingestion and reward processing; discard pending optional telemetry after withdrawal. Locally saved practice remains usable offline.

Client timestamps, install IDs and local pass counts remain untrusted. Local practice can support clearly labelled personal milestones but cannot award a verified-completion badge or competitive rank. Server-observed model usage does not upgrade a local result to trusted correctness. Support other editors only after specifying their integration, data access, evidence and consent; no OS-wide monitoring.

### Referrals (Phase 2)

Capture an opaque invitation code in a first-party, finite-life attribution cookie. On first eligible email registration, atomically bind at most one referrer to the new member; reject self-referrals and existing-account retroactive claims. Generate a code lazily; no email/contact importing or messages are sent automatically. Initial policy proposal is first eligible referral within 30 days, frozen on registration; keep an audit record for disputes.

Use independent idempotent milestone keys. The PRD's general 200-XP activation and its five separate referral milestone amounts overlap; do not stack both schedules. Proposed first referral release: pending attribution immediately, one 200-XP grant after the referred member has eligible activity on seven distinct days within 30 days, and a configurable referrer cap/review hold. Registration, download and client-reported installation pay 0 XP. Whether activation is browser or desktop is a product choice; prefer cross-surface activation to preserve the low barrier. If a desktop-specific campaign is added, describe native pairing as possession evidence, not proof of an untampered install.

Reject relationships that can form a loop; a new member can have only one immutable incoming attribution. Device/network/account signals can flag abuse but never establish identity alone. Revoked/fraudulent milestones use compensating entries and explain pending/reviewed status to users. Define what counts as seven days before enabling this rule.

### Public community (Phase 3)

Extend the current opt-in profile; show Created/Attempted/Completed separately. Publishing a prompt/workflow is a separate preview/edit/confirm flow; never turn private task transcripts into posts automatically. Ship reporting, moderation, delete/hide and blocked-content handling before reactions influence rewards. Self-reactions and repeated reactions cannot generate XP; eligible voters and fraud holds need an explicit policy.

Start with recent public achievements and discovery, not a lifetime XP ranking. Introduce challenge rankings only with comparable task/evaluator/model pins, published tie rules and reviewed evidence. Token consumption and prompt count are context, not a skill ranking. XP levels, completion of a curated exercise, and assessed professional skill must remain distinct labels. Teams and redeemable credits stay in Phase 4; XP cannot buy inference or grant admin privileges.

## 11. Implementation work packages

For each slice, land a small reviewable change across only the necessary repositories. Backend/engine behavior changes start with a failing deterministic test. Table fields define objective/scope, backend/frontend/data/API work, acceptance, tests and dependencies.

| ID / objective | Backend / engine changes | Frontend / UX changes | Data / API changes | Acceptance and meaningful tests | Depends on |
| --- | --- | --- | --- | --- | --- |
| D0 — Review discovery and design | Confirm auth adapter, executor trust boundary, capacity/cost ceilings, retention and grant rules | Walk through wireframes and curated first task | Review schema/OpenAPI proposal and feature flags | Decisions recorded; acceptance rules and exclusions are explicit; no paid calls | This handover |
| D1 — Validate interest with a synthetic prototype | Deterministic challenge responses only | Landing → attempt → diff → failing result → success → save/share preview; accessible mobile/keyboard layout | Disposable fixture state; no fake persisted XP | New visitor can explain the task and reach a result; measure observed confusion; prototype clearly labelled | D0 |
| D2 — Define community membership and privacy | Adapt existing principal/profile services; isolate rewards from funding eligibility | Private dashboard shell and consent controls | Add profile fields/indexes and purpose-specific consent; privacy API | Zero-credit learner can join; GitHub linking changes no balances/session scope; private-by-default and withdrawal tests | D0 |
| D3 — Publish one browser-safe challenge | Catalog projection excludes all hidden materials; pin author/task/image/evaluator | Listing/detail/brief/starter screen | Challenge collection and public list/detail/admin publication APIs | Hidden files never serialized; disabled task unavailable; starter and reference verified with deterministic fixtures | D0 |
| D4 — Provision isolated task execution | New private TS adapter and sandbox lifecycle; fixed tool/check allowlist; Go private client/job boundary | Job pending/unavailable/cancelled states | Versioned internal contracts; lease-bound commands/results | Real sandbox tests: tenant isolation, no network/secrets/socket exposure, time/memory/PID/output limits, cleanup/restart; no native fallback; security review | D0, D3 |
| D5 — Anonymous attempts and safe claim | Capability auth, expiration, quotas, same-origin checks and transactional owner claim | Start without account; resume; email sign-in after result | Attempt/submission records and create/get/claim APIs | Cross-account access and guessed IDs fail; concurrent/replayed claim grants one owner; expiry and CSRF tests | D2, D3 |
| D6 — Browser AI interaction | Adapt existing harness to sandbox tools; challenge-specific funding reservation, cancellation and revision control | Chat, proposed diffs, approve/reject, code edits, reconnect and budget feedback | Prompt/event/approval/file/check APIs; pinned workspace revision | Synthetic model exercises reads/edit/checks; stale edit, duplicate prompt, reload, cancellation and cap never redispatch paid work; approval remains explicit | D4, D5 |
| D7 — Submit and evaluate | Immutable snapshots, trusted grader jobs, sanitization and idempotent grade delivery | Run checks, submit, failed-check explanation, retry and success screen | Submission/evidence schema and worker completion protocol | Starter fails intended hidden cases, reference passes; tampered/stale lease/result rejected; crash recovery and infrastructure failure distinct from learner grade | D4–D6 |
| D8 — Reward foundation | Go event/outbox worker, leased retries, immutable ledger, caps, level projection, admin rules/adjustments | Pending/earned/reversed states and ledger detail | Reward collections/indexes; own-summary/admin APIs | Concurrent duplicate delivery grants once; rule change cannot re-award; crash before/after commit; cap, reversal and projection rebuild tests using Mongo replica set | D2; consumes D7 evidence |
| D9 — Creator and participant recognition | Accepted-award adapter plus claim/grade producers; meaningful-attempt validator; unique learner impact | Created/Attempted/Completed, creator credit and milestones | Versioned launch policies, achievement/level history and creator-impact projection | Repeated/cross-surface task reward dedupes; anonymous/unclaimed/author-self/flagged activity excluded; hosted/GitHub task collision retained for review | D7, D8; existing creator review |
| D10 — Optional public achievement | Safe public projection and visibility rechecks, hide/deletion and cache invalidation | Share preview and accessible achievement page; creator link; copy link | Explicit share/unshare/public APIs; opaque share ID | Private data absent; guessed private records 404; hiding removes prior public link; revoked awards disappear; no automatic posting | D9 |
| D11 — Operational pilot and release | Durable deletion/cleanup, review queue, feature flags, kill switch, monitoring and rollback rehearsal | Dashboard polish, error recovery, privacy/delete controls, curated next-task route | Minimal funnel events/aggregate dashboard; operational runbook | Full browser→API→worker→grade→ledger→share flow; small controlled load and loss-of-worker drills; human auth/migration/execution review recorded | D1–D10 |

D2/D3 can be scheduled independently after design review. D4 is the critical path; a UI prototype does not prove execution readiness. D8 can be developed against synthetic trusted evidence while D4–D7 are being built, but only the complete flow clears release.

Subsequent backlog, after the first milestone is evaluated:

| ID | Deliverable and repository scope | Data / API | Acceptance and tests | Depends on |
| --- | --- | --- | --- | --- |
| R1 | Curated task expansion and recurring challenges; Go catalog/admin and Astro discovery | Published task/challenge versions and schedules | Measured comprehensibility, deterministic reference results, no revision reward farming | D11 |
| R2 | Desktop consented metadata sync; Go native API and Theia settings/dashboard | Installations, native batch API, own reward API | Revoked sessions/consent and offline duplicates handled; cross-device cap tests; supported-OS build/smoke checks | D11 |
| R3 | Eligible-day/streak engine and retention UI | Activity-day unique index, timezone/config/history | UTC/day-boundary, late event, clock skew, timezone changes, missing day and reversal tests | R1; optionally R2 |
| R4 | Referrals and delayed rewards; Go rules/admin and Astro invitation dashboard | Referrals/milestones, attribute/link/history APIs | Self-referral, loops, concurrent attribution, fake install, cap/hold and seven-day evidence tests | R3 |
| S1 | Public profiles, explicit prompt/workflow publishing and moderation | Posts, reports, visibility APIs | Preview/delete/hide, permission and sensitive-data tests; moderators can act before public rewards | D11 |
| S2 | Follows, feed, appreciation and saves | Unique relation/reaction indexes, paged feed APIs | Privacy withdrawal, blocked/deleted content, self-vote/duplicate/farming tests | S1 |
| S3 | Comparable challenge leaderboards | Versioned ranking policy and reproducible projections | Ties, corrections, revoked results, task/model pin isolation; no raw-usage ranking | R1, S1 |
| E1 | Teams/competitions; later separate redemption design | Feature-specific schemas only after design review | Membership and competition rules; separate redemption ledger, limits and adjustment tests | Evaluated Phase 3 and separate reviewed scope |

## 12. Verification, rollout and product measurement

Use an isolated MongoDB replica set for transaction/index/race tests; skipped database tests do not clear a gate. Go checks: `go test -count=1 ./...` and `go vet ./...`. Website checks: `npm run build`, Playwright journeys and accessibility checks. Engine changes require `pnpm test` and `pnpm typecheck`; use the repository's declared Node/pnpm versions and Python 3.11+. Desktop changes additionally require relevant builds and installed smokes on Windows/macOS/Linux. Deterministic simulations are the normal model test path; real-container tests verify isolation separately. A local build or prior release receipt does not verify a new browser runner.

Rollout order: synthetic preview → reviewed private runnable pilot → small opt-in public cohort → evaluate repeat use and operating costs → expand curated tasks. Feature flags independently control anonymous attempts, inference, execution, new XP grants, public sharing and creator backfill. Pausing new work must preserve committed awards and let safe in-flight accounting settle. No public deployment is included in preparing this plan.

Track a minimal consent-aware funnel: challenge view → start → first meaningful action → submission → completion → account claim → share-link creation → second distinct challenge → D7 return. Keep raw prompts/code out of analytics. Report browser-to-desktop conversion separately; it is not the primary MVP success metric. A share-link click is not proof a user posted on an external network.

Also measure time to first useful feedback, failures due to infrastructure, reward latency/duplicate conflicts, cost per meaningful attempt/completion, queue age, cleanup failures and participation balance across tasks. Creator impact uses eligible unique people, with the owner and suspected abuse excluded. State denominators and distinguish anonymous session estimates from authenticated members; do not claim unique people from cookies alone.

Release acceptance:

- A visitor completes a real task in the browser without an installer or mandatory registration.
- A failing meaningful attempt receives constructive progress feedback; a passing submission receives a clear challenge result.
- Claiming after sign-in preserves the result and awards eligible milestones once.
- A creator sees attribution and deduplicated learner impact; author awards retain their existing provenance.
- New XP has an explainable immutable history, configurable future rules, audited corrections and a rebuildable summary.
- Public recognition requires explicit action and can be withdrawn; private code/prompts/identity/credit data never leak.
- An expired/duplicate/malicious/infrastructure-failed operation cannot invent a grade, ownership claim or reward.
- Operators can pause new work, reconcile/retry failed jobs, remove retained data and roll back without rewriting committed awards.

## 13. Review decisions before implementation

Review the concrete defaults above rather than leaving the team to invent policy in handlers:

1. Confirm browser-first Phase 1 and individual-developer audience; desktop/referrals/streaks follow later.
2. Select one short task and define meaningful participation, pass criteria and creator attribution rights.
3. Review the proposed 10/40/100 XP rules, separate author policy, daily cap, neutral level titles and no historical backfill by default.
4. Review execution threat model, deployment boundary, runner capacity, guest inference ceiling and pilot spending authorization.
5. Finalize retention/deletion, public sharing defaults and what a completion label promises; no professional-skill verification in MVP.

The PRD's §19 unknowns are mostly resolved by discovery: desktop is Theia/Electron, current platforms are Windows/macOS/Linux, current integration is Factoryze's own harness, backend is Go, web is Astro, and XP stays separate from money. External-tool observation, expert skill certification, redeemable budgets and team mechanics remain explicitly deferred.

## 14. PRD coverage

| Supplied PRD sections | Covered here |
| --- | --- |
| 1–2, 10: product, surfaces and conversion | Sections 1–4; browser-first adaptation and optional desktop path. |
| 3: XP, levels, badges | Sections 7–8; D8–D9. |
| 4, 7: social profiles, feed, content and appreciation | Sections 10–11; S1–S2 after moderation/consent. |
| 5: referrals | Section 10; R4 with one reviewed reward schedule. |
| 6: challenge lifecycle/evaluation | Sections 4–5, 9, D3–D7 and R1/S3. |
| 8–9: teams and redemption | Phase 4 / E1; separate future design. |
| 11, 16: privacy and integrity | Sections 5–10 and release acceptance. |
| 12–14: architecture, modules, database and screens | Sections 5–9, implementation tasks and linked wireframes. |
| 15: metrics | Section 12. |
| 17–18: roadmap and MVP acceptance | Sections 3, 11–12; scope intentionally re-sequenced. |
| 19–20: discovery, technical design, UX, backlog, review before implementation | This handover and wireframes; implementation has not begun. |
