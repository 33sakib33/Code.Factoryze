# Social rewards: screen and interaction plan

Status: low-fidelity wireframes drafted 2026-11-06. A synthetic first-challenge prototype is now implemented in the website at `/challenges/delivery-fee/` (2026-11-07). The broader account/reward/community screens below remain proposals. Companion: [development flow](social-rewards-development-flow.md).

Prototype boundary: scripted assistant and checks, fixed read-only code snapshots, explicit approval/rejection, optional tab-local saving and a private share preview. It has no account claim, server execution, real AI or earned XP. Browser workbench tabs support keyboard navigation on narrow screens. Account saving and verified public sharing belong to subsequent implementation slices.

Foundation checkpoint (2026-11-07): `/account/` now adds Go-backed private membership and explicit collection preferences; `/challenges/` and `/challenges/task/?slug=...` browse reviewed read-only public task projections. These controls are separate from contributor public visibility and model credit. Optional collection is not active, and catalog briefs have no execution button. The wider progress/reward dashboards, real attempt claims, publishing UI and social actions below remain proposals.

Keep the existing website's visual language. These wireframes define hierarchy, actions and states; visual design follows experience review. On narrow screens, show Brief / Code / AI as accessible tabs with a persistent Run checks action. Every control must work with keyboard navigation and visible focus; async status uses a live region without stealing focus.

Private-draft checkpoint (2026-11-07): enabled challenge details can open a private starter copy at `/challenges/attempt/?id=...`. The implemented editor has explicit save/reload/delete, revision conflict recovery, anonymous expiry, a bounded sign-in return path, an explicit account-claim action and account draft history. Source edits persist through Go/MongoDB; no execution, AI, grading or XP is implied. The original scripted demo's workbench remains separate. Draft retention and the difference between a browser-owned copy and an account-owned copy are explained before starting and in the editor.

Guided-practice checkpoint (2026-11-07): optional reviewed goals/examples and two or three authored hints now appear in the real private editor, alongside step navigation. Finish this attempt saves the current server-owned revision with matching completed public-check feedback; a private `/challenges/result/?attempt=...&submission=...` screen credits the creator, shows actual progress from a prior submitted revision, offers a snapshot viewer and returns to editing. Partial results can be saved honestly. Existing results follow explicit account claim and draft deletion. Hints are not AI, reveals are page-local and results cannot earn XP or become public achievements. Guided AI, trusted grading and the reward/community dashboards below remain proposals.

## First browser visit

```text
Factoryze                                  Challenges  Contributors  Sign in

Help the AI fix a real bug.
The shop adds the wrong delivery fee. Can you put it right?

[ Try a 5-minute challenge ]                [ Explore challenges ]
No installation needed.                    Created by [Author]

One concrete input → wrong result → expected result
How it works: describe the issue → review a change → check the result
```

The first action opens the task rather than a registration modal. Explain temporary task processing and expiry next to Start. Optional analytics/public sharing are separate choices. Capacity exhaustion offers an honest retry state; a synthetic preview is labelled before entering it.

## Challenge list and detail

```text
Challenges                    [Category] [Difficulty]

Delivery fee bug     Beginner · ~5 min      [Try]
Created by Author   What you'll practice: giving useful debugging context

Detail: scenario | example | expected outcome | author | [Start challenge]
```

In Phase 1 there may be one task. Do not imply a large catalog or invent popularity numbers. Later show real challenge dates, eligibility and evaluation criteria before joining. Closed, cancelled and unavailable tasks have distinct states.

## Attempt

```text
Delivery fee bug                 Saved · temporary attempt    [Exit]

BRIEF / FILES          CODE                         AI ASSISTANT
What is wrong?         delivery.py                  Describe the problem...
Concrete example       Editable task files          [Send]

[Optional hint]        Proposed change              Read / change summary
                       before → after               [Approve] [Reject]

[Run checks]           3 of 5 checks passing          [Submit solution]
```

Keep the scenario visible while composing a prompt. Use plain explanations for budget limits. An edit requires approval and has a stale-version state. During execution show running/cancel; on refresh resume the same operation without resending a paid request. Failed checks provide actionable feedback without revealing hidden tests. Infrastructure errors offer retry and preserve work; they do not say the learner failed.

## Result and save-progress registration

```text
You fixed the delivery fee!                 or: 3 of 5 checks passing
Checks passed: 5 / 5                        Here's what still needs work...
Practice challenge completed               [Try again] [Hint]

Created by [Author]                         [Thank the creator — later]
[Save progress]  [Share achievement]  [Try another challenge]

Save progress: Email → send code → verify → result saved to your account
```

Before account claim, describe rewards as available after saving, not already credited. Show pending calculation if needed. Sharing requires sign-in, award eligibility and a public preview/confirmation; it never publishes the transcript. A repeat completion celebrates the result and explains that the milestone was already earned. An expired anonymous attempt cannot be recovered using its public share link or ID.

## Account / developer dashboard

```text
Your progress                         Level 2 · 620 XP
                                      880 XP to the next level
[Created 2]  [Attempted 4]  [Completed 3]

Continue a challenge                   Latest milestones
Suggested next challenge               Explorer · Delivery fee completed

[Reward history]  [Privacy settings]  [Profile visibility]
Optional: Work on larger tasks in the desktop app [See desktop experience]
```

Maintain the existing account/contribution controls and GitHub connection. Zero accepted tasks must not prevent learner membership. XP, sponsored model allowance and accepted-task count have distinct names and units. The personal dashboard is private. A user without inference credit can still view history and use the bounded public challenge offer if eligible.

## Reward dashboard and achievement showcase

```text
Rewards                   620 XP · Level 2
Next level progress       [================          ]

Milestone                 XP        Status         Source
Meaningful attempt        +10       Earned         Delivery fee
Challenge completion      +40       Earned         Delivery fee
Task accepted             +100      Pending review Original task
Correction                -40       Adjusted       View reason

Achievements: [Explorer] [Problem Author] [Challenge completed]
Select achievement → evidence summary → [Preview public card] → [Publish link]
```

List grants, pending decisions, caps and adjustments clearly. Never show a partial outage as a zero balance. Level labels describe progression. Show server-checked versus locally reported practice evidence when later desktop achievements appear.

## Public achievement and developer profile

```text
Public card: Member completed Delivery fee bug
Practice challenge · 5/5 checks · task/evaluator version · date
Created by Author                         [Try this challenge]

Profile /u/name (Phase 3): display name · optional bio/avatar
Created | Attempted | Completed | selected milestones | published workflows
[Follow — Phase 3]
```

Only explicit public fields appear. No email, trial credit, private task names, raw prompt/code or anonymous identifier. Hide/unshare makes an old link unavailable. Profile publication and each achievement's sharing choice are separate controls. A public profile cannot automatically expose all historical attempts.

## Privacy and optional desktop pairing

```text
Privacy
Task processing and retention: explained separately from optional data use
[ ] Sync eligible desktop activity metadata         Phase 2
[ ] Allow optional product analytics
[ ] Make my selected profile fields public
[ ] Contribute to research                          Deferred; disabled

View retained data · Delete selected data · Withdraw consent
Connected desktop installations: Last seen · [Revoke]        Phase 2
```

Desktop onboarding reuses the native email-code flow and keychain. Explain supported Factoryze events before enabling sync. Do not claim to observe all Cursor/VS Code/terminal usage. Declining optional sync leaves local practice available. Withdrawal and deletion show pending/completed status and explain any reviewed audit-retention exception.

## Download / optional desktop page

```text
Ready for larger projects?
Use the Factoryze editor for full workspace and local practice workflows.
[Windows] [macOS] [Linux]                  [Continue in browser]
Requirements · installation guidance · account sign-in · known limitations
```

Do not award installation XP for a download click. OS support and installer claims must reflect current release evidence, not these wireframes. The browser result is useful before this upsell appears.

## Referral dashboard (Phase 2)

```text
Invite someone to try a challenge
[Your invitation link] [Copy]

Invited member          Attribution       Activation       Reward
Privacy-safe label      Recorded          3 of 7 days      Pending

Eligibility · cap · review hold · reward history
```

No automatic messages or contact access. Registration/download milestones are not presented as verified installs. Explain the selected activation rule and never expose the invitee's private activity log.

## Community and leaderboard (Phase 3)

```text
Community: recent public achievements · approved prompts/workflows
[Search] [Category] [Saved]                 [Publish with preview]
Each contribution: author · evidence/context · [Helpful] [Save] [Report]

Challenge leaderboard: task/evaluator/model scope · evaluation rules
Rank | public member | validated result | tie information
```

Publish only after consent and moderation controls exist. Distinguish skill evidence, XP progression and exercise completion. No ranking by prompt count, spend or token volume. Private profiles are absent. Follows, appreciation and teams do not belong on the first-release navigation as empty placeholders.

## Administration

```text
Challenges | Reward rules | Ledger | Failed jobs | Privacy jobs | Review

Challenge: draft → reviewed → open / closed
Pinned task / evaluator / image · author · reference-check evidence

Rule: version · amount · eligible evidence · cap · effective date
Change preview → reason → save prospective version

Ledger: member/source filters → evidence → append correction with reason
Failed job: safe error → retry/reconcile → audit record
Controls: pause attempts / inference / execution / awards / public sharing
```

Use existing restricted admin authentication. Contributor GitHub linking never grants these controls. Review and adjustment actions need clear pending/success/conflict states; don't silently mutate past XP. Later phases add moderation/referral/team/reward-catalog tools only when those features exist.
