# Contributor recognition and GitHub linking

**Status:** implementation in review, 2026-11-04. Backend and frontend code exists on feature branches and passes local tests; it is not deployed. This is a web/community track across the base, frontend, and backend repositories; it does not change desktop grading or the 0.1/0.2 release gates.

## Outcome and first release

Recognize people who contribute useful public practice problems through either route: a merged GitHub pull request in the base repository or a website task submission that a maintainer publishes to the hosted catalog. The first release should show an accepted-problem count and a **Problem Author** badge on `/account/`. A contributor may opt in to a public profile and contributor wall that show their chosen display name, accepted problems, source links, and badges. Keep the wall unranked initially; evaluate a leaderboard after seeing whether it improves problem quality. Additional badges can mark five accepted problems and contributions through both routes. Rewards are social recognition only: they do not grant sponsored inference, money, grading authority, or administrator access.

Pending submissions, opened or closed-unmerged PRs, commits, review comments, and raw upload counts do not earn awards. A maintainer's acceptance is the quality gate. One accepted problem earns one contribution even if it appears through both routes, is republished, or is updated in later PRs. Corrections can still be acknowledged on the PR without inflating the accepted-problem count. Changes to these rules need an explicit policy decision before launch.

## Identity model

The existing backend has separate `email:<hash>` and `github:<numeric-id>` trial accounts. Hosted submissions currently store a verified email account ID; GitHub OAuth sign-in creates a separate trial account and replaces the browser session. Do not merge those trial accounts, allowances, invitations, or credentials as a side effect of contributor linking.

Create a separate contributor profile and verified identity mapping:

| Identity or record | Verified by | Recognition use |
| --- | --- | --- |
| Email account ID | Existing email-code sign-in | Owns hosted submissions made while signed in; anchors `/account/`. |
| GitHub numeric user ID | OAuth `/user` response | Attributes merged PRs; login text and email are not ownership proof. |
| Contributor profile | Explicit link between the two verified identities | Combines recognition across routes without merging trial balances. |
| Award ledger | Published submission ID or repository + PR number + task ID | Makes awards auditable and idempotent. |

Give each verified identity at most one profile through unique database indexes. Store the GitHub numeric ID as the durable key and refresh the display login when GitHub verifies it. A GitHub PR can be recorded against its numeric author ID before that person links a website account; show it in their profile only after they verify that ID. An anonymous website submission has no verified account owner and is not automatically claimed by someone who knows its email address or receipt reference. A future claim process would need separate proof and review.

Public display is opt-in. Keep email addresses, trial balances, unpublished submissions, private reviewer notes, and OAuth tokens out of public responses. Let a contributor change their display name, hide their profile, and unlink GitHub. Unlinking removes the public association while retaining an internal audit trail; a GitHub ID already bound to another profile must produce a conflict for manual review, never an automatic transfer.

## Link GitHub from the website

Add **Connect GitHub** to the signed-in email account page. Start a purpose-specific OAuth flow from that existing browser session, using the backend's registered GitHub callback, random single-use `state`, PKCE S256, a short expiry, and a same-browser cookie. Bind the pending flow to the initiating email account and session. On callback, verify both the pending flow and the original session, exchange the code server-side, call GitHub `/user`, and use its numeric ID. Confirm the link to the contributor, persist the unique identity mapping and audit the event, then return to `/account/` without replacing the email session. Use the token only to check identity and discard it; do not request repository or private-email access for linking. Keep the existing `/trial/` GitHub sign-in path distinct.

The current OAuth app is used for trial sign-in. Before reuse, review its granted scopes: GitHub documents that an authorization request without `scope` can inherit scopes a user previously granted to that app. If the app has broader grants, use a separate minimal-permission app for linking or another GitHub-supported least-privilege flow. A link must not make an email account eligible for a GitHub-targeted trial invitation or move sponsored credit. A GitHub-only user who wants hosted-submission ownership must first verify an email account, then use the link flow.

## Award sources and reconciliation

1. **Hosted:** after the administrator publishes a reviewed submission, append an award event keyed by its immutable submission ID and published task ID. Attribute it only if the submission stored a verified account ID at creation. Publishing must remain idempotent; if publication succeeds but the status or award write fails, reconciliation should complete it without a second award. Disabling a task or withdrawing it for quality reasons requires an audited decision on whether to revoke its award.
2. **GitHub:** listen for the base repository's merged `pull_request` event, verify the webhook's `X-Hub-Signature-256`, and re-read the PR and its changed files from GitHub. Award only a maintainer-accepted new public pack under `tasks/practice/<id>/`; require a matching `task.yaml` ID and an eligible human PR author. Use the numeric `user.id`, not the username or commit email. Record repository identity, PR number, task ID, merge time, and source URL. Ignore unmerged, unrelated, bot, duplicate, and ambiguous multi-author changes pending maintainer review. Add a bounded manual reconciliation or backfill path for missed webhooks.
3. **Across routes:** before granting an award, check whether that task ID already has an accepted award in either source. Flag collisions for maintainer review. Keep the source record even when its award is withheld or revoked so retries and replays cannot count it twice.

The OAuth link proves a person's GitHub identity; it is not a feed of merged PRs. Repository events or a verified reconciliation job supply PR evidence. If the base repository is still private when this ships, the repository event reader needs owner-configured read access; a contributor's OAuth token must not be used for repository monitoring.

## Delivery order and acceptance checks

1. Define the contributor-profile, identity, award, visibility, and audit contracts in the backend. Add unique indexes and migration/backfill rules without changing existing trial account IDs or balances.
2. Implement link, status, and unlink endpoints; add the `/account/` controls. Verify same-browser state/PKCE, unchanged email session, conflict handling, revoked/expired sessions, and no admin or credit escalation.
3. Record hosted publication awards with retry-safe reconciliation. Check pending versus published, anonymous versus verified, duplicate publishes, and a partial publish failure.
4. Ingest and reconcile GitHub PR awards. Test valid and invalid signatures, merged versus closed, path/ID checks, duplicate delivery, rename, bot author, and missed-event backfill with synthetic GitHub responses.
5. Show the private count and badge, then add opt-in public profiles and the contributor wall. Check that non-opted-in identities, email, trial data, hidden tests, and unpublished tasks never appear publicly. Compare both routes and a cross-route duplicate end to end.

**Implemented rules:** one award per accepted task ID, credited to the verified hosted submitter or merged PR author. The badges are Problem Author at one accepted problem, Community Builder at five, and Across Both Routes when both sources are represented. Corrections and co-authors receive no automatic award. Existing merged PRs and published hosted tasks are not automatically backfilled.

**Before public release:** human review of the authentication and award code; configure a separate GitHub OAuth app with no granted scopes and callback at /api/user/github/callback; configure a signed pull_request webhook at /api/webhooks/github and owner-controlled read access if the repository remains private; decide whether to backfill historical contributions and how withdrawal affects recognition; verify the hosted flow end to end. Do not publish counts before the history policy is settled.

## GitHub references

- [OAuth web application flow, state, PKCE, and identity revalidation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [Pull request events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Webhook signature verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Pull request and changed-file API](https://docs.github.com/en/rest/pulls/pulls)
