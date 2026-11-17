# Optional editor research and training data — proposal

**Status:** Proposal only, 2026-11-17. No prompt recording, research upload, or training-data pipeline is authorized or implemented by this document. The owner may choose not to build it.

## Decision to make

Factoryze could learn where participants struggle and whether the editor helps them solve problems. The first question is what decision the data would support: improving a task, fixing an editor flow, evaluating the assistant, or training a specific model. Collecting data without a defined decision is outside this proposal.

Start with coarse, content-free measurements if the product question can be answered that way. A sequence such as task opened → tests run → submission finished can show friction without recording what a participant wrote. Task IDs, timestamps, account IDs and rare event sequences may still identify a person; treat them as personal data where applicable. Report aggregates with minimum cohort sizes rather than exposing individual histories to product staff.

## Separate choices

| Choice | Possible data | Use | Default |
| --- | --- | --- | --- |
| Product analytics | Feature events, app/OS version, coarse error category and event time | Improve reliability and navigation | Off |
| Account activity sync | Task ID, attempt milestone, check-count and token-budget totals | Resume or display a participant's own progress | Off |
| Research session | Prompts, assistant replies, tool approvals and selected code diffs for **one named practice task** | Human study or controlled assistant evaluation | Off; explicit start, stop and preview |
| Model training contribution | A participant-approved subset of a research session | Train or fine-tune a **named Factoryze model for a stated purpose** | Separate off-by-default choice after preview |

These choices must not be bundled. Publishing a result link, signing in, accepting trial credit, or joining a classroom must never turn them on. The existing website `desktopActivity` and `productAnalytics` preferences are stored but collection is inactive; `community-privacy-v1` does not authorize raw prompt collection or model training. A future implementation needs a new, purpose-specific policy version and a native editor control that reads the current choice before collecting or uploading.

## Research-session boundary

- Offer this only on curated practice tasks at first. Do not record arbitrary folders, other applications, OS-wide activity, terminal output, environment variables or clipboard contents.
- Explain the exact capture fields before the participant starts. Show a visible recording state and a Stop action. Store the recording locally until the participant reviews and submits it.
- Let the participant inspect the full payload, remove individual prompts or diffs, and cancel the upload. Screen for secrets and personal information before upload; scanning cannot replace participant review.
- Do not use research recordings for grades, XP, hiring, integrity judgements, advertising or instructor monitoring. Declining or withdrawing must not affect the editor, scores or sponsored credit.
- Limit access to named research staff, encrypt the stored data, audit access and prohibit onward sharing by default. A third-party model provider or trainer requires its own named disclosure and reviewed contract.

Participants may paste employer code, another person's information or credentials. Their consent alone may not give Factoryze permission to train on that material. Establish content eligibility and a removal process before accepting sessions.

## Model-training decision

Human research, model evaluation and training are different purposes. Before asking for training consent, identify the model operator, the model or model family, the training method, any third party, retention period and how the participant can withdraw. Do not describe an open-ended right to use all future prompts as “help improve AI.” Keep consent records and dataset provenance so an approved session can be located and excluded from later runs.

On withdrawal, stop new collection, discard queued uploads and remove the stored training copy according to the stated policy. Explain honestly that removing an example's influence from a model already trained on it may require retraining or other technical work; do not promise automatic unlearning. Determine the applicable deletion and model-remediation obligations before training begins.

## Proposed retention and safeguards

For discussion, consider raw product events for at most **30 days** before aggregation, and unselected research recordings for at most **90 days** before deletion. These are proposed ceilings, not current behavior or a legal conclusion. Set actual periods from a documented need, including backups and processor copies. Do not retain raw transcripts indefinitely because they might be useful later.

Specify the lawful basis and notice for each purpose, review rules for children/classrooms and cross-border processing, and complete privacy and security review before launch. In a classroom, a participant may feel unable to refuse an instructor's request, so do not rely on a nominal checkbox without assessing whether choice is genuinely free.

## Suggested participant flow

1. Show a short invitation after a relevant practice task, with **No thanks** as a normal path.
2. If the participant opts in, name the task and capture fields and start a visible, pausable recording.
3. At the end, show the exact session for review and selective removal. Upload only after a second explicit action.
4. Offer model-training contribution as a separate choice for the approved session. Record the consent text and version used.
5. Provide Settings controls to stop future capture, view/download submitted sessions and request deletion. Show completion or failure of deletion requests.

Possible research invitation: “Help us study this practice task. If you choose Start, Factoryze will record prompts, assistant replies, approvals and code changes for this task. You can stop and review or remove items before anything is uploaded. Your choice does not affect your result.” The actual consent copy must name the recipients, retention and any later training use before release.

## Go/no-go checks

Build this only if a specific product or model question cannot be answered with less data. Before a pilot, require: reviewed data inventory and event schema; exact consent and withdrawal flows on website and desktop; redaction and payload-preview tests; deletion through backups/processors; access audit; classroom/age assessment; a small opt-in cohort; and a written result showing whether the data answered the original question. If the pilot produces little useful insight, remove the collector and retained data.

## Reference guidance

- [EDPB: consent must be freely given, informed, specific and withdrawable](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en).
- [ICO: training and deployment purposes need explicit definition](https://ico.org.uk/about-the-ico/what-we-do/our-work-on-artificial-intelligence/response-to-the-consultation-series-on-generative-ai/purpose-limitation-in-the-generative-ai-lifecycle/).
- [ICO: individual rights and model-training data](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/how-do-we-ensure-individual-rights-in-our-ai-systems/).
