# Working rules

For public practice problem authoring, use `$factoryze-problem-authoring` from `.agents/skills/` and follow the contribution guide. This skill does not apply to private assessment packs.

Read `PLAN.md` and `SPEC.md` before changing product behavior. The owner's next community slice is contributor recognition and website GitHub linking (§7 of `PLAN.md`); keep it separate from the unreleased desktop and lab gates. Phase 2 Docker grading remains opt-in; real Docker checks pass on macOS/arm64 and Ubuntu and remain pending on Windows. Do not treat synthetic checks as container-isolation evidence. Retain the remaining classroom and Phase 1 release gates separately.

- `packages/protocol` owns wire formats and versioned schemas. The engine and app import those contracts; they do not invent parallel shapes.
- `packages/engine` owns gateway traffic, metering, replay, event storage, and modules. The app owns the workbench and ACP client. Keep provider keys and private task material out of client code and fixtures.
- Draft contracts may change before their first release. Once released, add a compatibility path instead of repurposing a schema or event type.
- New modules and agent profiles start disabled. Never dispatch a trial payload that the spec requires to be simulated. Follow `SPEC.md` §5.3 for every supply-chain trial.
- Use a failing test for each behavior change, then make it pass. Keep fixtures deterministic and free of real credentials or student data.
- Before marking a code slice done, run `pnpm test` and `pnpm typecheck`. For app or installer work, also run the relevant build and smoke test on every supported OS; a local build alone does not clear a release gate.
- Changes to gateway authentication, key handling, permissions, trials, database migrations, or released contracts need human review before merging.
- Paid model calls, live spikes and benchmarks require explicit user approval and an agreed spending limit. Use deterministic tests and synthetic providers for routine verification.

The visual and flow reference is `mockups/flows.html` (Home, start sheet, attempt, approvals, report, settings, problem states), built on `mockups/ide.html`: light gray chrome, teal accents, Atkinson typography, a per-prompt budget meter and timer, and diff approval cards. The app opens to Home and never restores the last attempt on launch. Preserve this interaction model when changing Theia extensions.
