# Desktop trial credits

Factoryze offers two model connections in the existing **Connect a model** dialog: **My API key** and **Trial credits**. Both use the local agent, approvals, Python tools, grading, task token meter and saved reports. Sponsored credit is a separate server-enforced monetary allowance. It does not replace or increase the task token budget.

## Use a trial

1. Open Settings → Model connection → Connect a model (or Change). Select Trial credits.
2. Enter your email and the SMTP-delivered six-digit code. First verification creates an unfunded account; subsequent logins use the same verified email account as the website.
3. Claim an invitation targeted to that email. Signup alone does not grant credit. Email and GitHub accounts are separate; their invitations and credit are not automatically transferred.
4. Review available credit, expiry and the allowed model. Choose Use trial credits. The agent is available only while the account, selected model and sponsored program permit requests.
5. Start or continue an attempt normally. The start sheet identifies the trial connection; the existing header/prompt meters show task tokens. Manage the account through the same model-connection controls.

My API key remains available, including the saved connection. Switching funding is explicit and does not erase usage. Connection changes are refused during an active prompt; finish it or use Stop. Switching between prompts starts a fresh agent session on the next send, with earlier conversation text and usage retained locally. Factoryze never automatically falls back to a saved key after a trial error.

## Desktop sessions and credentials

The desktop backend sends OTP requests to dedicated `/api/desktop/auth/request-otp` and `/api/desktop/auth/verify-otp` routes. An unpredictable private proof binds the code to the requesting desktop backend. It is not a website cookie or a copied browser token. The existing standard-library SMTP/TLS sender and OTP expiry, attempt, cooldown and rate controls are reused, with a separate native challenge namespace.

Verification creates an eight-hour, trial-only desktop credential, hashed on the server and held in the OS keychain locally. Only redacted account/model/status data crosses the renderer RPC. A 15-minute-or-shorter gateway credential stays in backend memory and renews before requests, through one shared pending renewal. It cannot outlive its parent session or trial. Renewal rotates only credentials belonging to that parent login, so another device or the website keeps its own connection. Sign-out revokes that login and its gateway credentials; account suspension/revocation remains authoritative across devices.

Desktop credentials cannot authorize browser sessions or any administrator endpoint. An email on `ADMIN_EMAILS` receives no administrator permission by signing in to the desktop. Administrator access still requires the separate owner-approved admin OTP flow. Provider keys and SMTP credentials stay on the server; the desktop never receives them.

## Requests, limits and records

The local metered gateway selects a dedicated sponsored provider adapter. Every logical model call gets a new idempotency key. There is no automatic billable retry. The adapter preserves streaming, cancellation, function tools, usage and remote request IDs, and translates the configured output-limit parameter. Available models and effective request limits come from the server. The harness drops complete older turns to fit those limits and refuses an oversized current turn before dispatch.

The backend enforces account/program credit, concurrency, expiry, suspension, model allowlists and rate limits. Interrupted or missing-usage calls retain the existing conservative accounting behavior; changing local token reconciliation does not refund remote trial credit. Operators reconcile uncertain monetary charges through the restricted admin console. Background prompt-judging/scoring calls are disabled for sponsored connections; saved BYOK preferences are retained.

Trial session execution pins record their funding source and model. Safe remote request IDs are appended to local events for correlation; authentication secrets are never recorded. Existing reports and BYOK pins remain readable. No local database migration or task content change is required. These sponsored trials are account funding; the specification's later fault-injection assessment trials remain separate, unimplemented work.

## Hosted tasks

Signing in to the service is enough to see its hosted tasks; trial credit is not required, so people using their own API key can sign in only for tasks. While signed in, Practice tasks on Home also lists the service's enabled tasks with a **Hosted** label. A hosted task never replaces a bundled task with the same id. Start downloads that task's archive, checks its size and SHA-256 against the listing, and imports it through the ordinary ZIP import, so the pack is validated, stored by content and graded on this computer like any imported task. Hidden checks therefore travel with the pack and reports remain unverified practice. When the service disables a task it disappears from Practice tasks, but attempts already started keep their local copy. Signed out, offline or pointed at another service, Practice tasks shows only bundled tasks. Administrators publish tasks in the website's **Hosted tasks** console; see the backend README.

## Public links for local results

An account sign-in also lets a participant explicitly publish a saved solo report from the editor's **Share your result** section. Trial credit or a selected sponsored model is not required. **Publish public link** creates a hosted result page; the editor can copy its URL, open it, share it on Facebook or LinkedIn, and withdraw it. Reloading the saved report restores its current link. A withdrawn link returns 404, and publishing again creates a new URL.

The editor sends only the saved task title, task ID, submission date, check count, eligible complete token total and budget, optional local score, and a report fingerprint. The server stores the authenticated account ID for ownership, but the public card excludes it. It also excludes source code, prompts, check names, model information and the private report. The page has server-rendered Open Graph and Twitter metadata. It labels all measurements as **self-reported local practice**, because the hosted service did not grade the work or verify token use. Lab reports cannot use this route. Links expire after one year, and an owner can withdraw them earlier. Social platforms may retain a preview they already cached after withdrawal.

## Service setup

Deploy the sibling Go backend with its desktop endpoints, MongoDB replica set, verified-TLS SMTP and trial provider configuration. Configure approved models, prices, a program budget and targeted credit through the restricted admin console. Provider configuration and credit are not bundled in the desktop installer.

The admin console can also set a daily sponsored limit per account in USD. It resets at 00:00 UTC, does not refill the account's lifetime invitation credit, and must cover a model request's maximum reservation. The desktop shows today's remaining amount and reset time. Each practice workspace has a persistent random attempt ID; sponsored requests include that ID and the task ID for the admin's day/person/problem cost reports. These are client-reported analytics fields, not verified completion evidence. Existing requests without task metadata appear as unattributed.

The desktop service origin defaults to `https://code.factoryze.tech`, a subdomain kept separate from the company site on `factoryze.tech`. Operators/developers can set the backend environment variable `FACTORYZE_TRIAL_URL` to another HTTPS origin; loopback HTTP is allowed for local development, for example `http://127.0.0.1:8091`. A different origin requires its own sign-in. Setting a URL does not deploy a service or enable sponsored inference. Production must expose the gateway at that origin before distribution.

The desktop RPC offers redacted account inspection, request/verify code, invitation claim, model selection and sign-out. Native service routes reject browser-origin requests; existing web CSRF rules are unchanged. Session-credential APIs and model calls are distinct scopes. There is no admin bootstrap or client-side promotion path.

## Verification

Use `pnpm test`, `pnpm typecheck`, `pnpm build:app` and the platform packaging/resource/installed checks. `packages/app/scripts/check-trial-dialog.mjs` exercises production dialog code and CSS at multiple widths/themes. `packages/app/scripts/smoke-trial.mjs` drives the real Electron application against the backend's opt-in local TLS-SMTP/synthetic-model fixture, with isolated credential/data directories. It refuses a service that is not explicitly marked verification-only. Supply `TRIAL_TEST_URL` (default loopback 8093) and the fixture's private `TEST_MAILBOX_TOKEN`; never point it at real SMTP/inference. No paid provider calls are required.

Implementation, outcomes and remaining platform/review gates are recorded in the dated verification receipt linked from PROGRESS.md. A local build does not clear the three-OS release gate, and authentication/key-handling changes require human review before merge.

The [2026-11-16 authentication check](verification/2026-11-16-authentication-flow.json) records the combined web/editor role test, web browser tests, rebuilt macOS desktop smoke, and remaining release gates.

The separately authorized [2026-10-28 live check](verification/2026-10-28-real-desktop-trial/live-checks.json)
completed real email OTP, OpenRouter coding, reviewed approvals, public/hidden
grading, saved report, matching credit deduction and sign-out in the packaged
Windows app. The program was paused afterward, with total gateway accounting of
US$0.000494 including the earlier smoke under the unchanged US$0.10 cap. Nano
needed a focused follow-up; the check does not establish autonomous coding quality
or clear other platform/downloaded-installer/review gates. The fixture smoke's
live-service refusal remains unchanged.
