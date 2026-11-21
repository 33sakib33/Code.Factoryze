import type { ResultSubmission } from '@factoryze/engine/trial-client';
import type { SoloEngine } from '@factoryze/engine/solo';
import { hostedResultViewSchema, type DesktopResultInput, type HostedResultView, type PracticeReport } from '@factoryze/protocol';

export type HostedEngine = Pick<SoloEngine, 'hostedAttempt' | 'hostedTestFiles' | 'hostedResultPlan' | 'saveHostedResult' | 'hostedResult' | 'submissionCount'>;
export type ResultService = { signedIn(): Promise<boolean>; submitResult(input: DesktopResultInput): Promise<ResultSubmission>; leaderboardURL(): string };

type Sync = HostedResultView['sync'];
function syncFrom(result: ResultSubmission, payload: DesktopResultInput, leaderboardURL: string, solutionNote?: string): Sync {
  switch (result.kind) {
    case 'recorded': return { status: 'sent', response: result.response, leaderboardURL, solutionIncluded: Boolean(payload.solution), ...(solutionNote ? { solutionNote } : {}) };
    case 'sign_in': return { status: 'signed_out' };
    case 'rejected': return { status: 'rejected', code: result.code.slice(0, 80), message: result.message };
    default: return { status: 'unavailable', retry: true };
  }
}

/**
 * Grade an attempt and, only for an attempt started from the hosted catalog while signed in, send one result.
 * Test files are checked before grading. Grading and the saved report never depend on the network.
 * Bundled, imported and lab attempts have no hosted record, so they never reach the network here.
 */
export async function gradeAndSync(engine: HostedEngine, service: ResultService, workspace: string,
  grade: () => Promise<PracticeReport>, options: { includeSolution?: boolean } = {}): Promise<PracticeReport> {
  const attempt = await engine.hostedAttempt(workspace);
  if (!attempt) return grade();
  const testFiles = await engine.hostedTestFiles(workspace).catch(() => 'edited' as const);
  const report = await grade();
  const submission = await engine.submissionCount(workspace);
  const plan = await engine.hostedResultPlan(workspace, report, testFiles === 'unchanged' && options.includeSolution === true);
  const base = { ...plan.facts, testFiles };
  let sync: Sync, payload: DesktopResultInput | undefined, sent = false;
  if (testFiles === 'edited') sync = { status: 'not_counted_edited' };
  else if (attempt.sent) sync = { status: 'already_sent', submission: attempt.sent.submission };
  else if (plan.ineligible || !plan.payload) sync = { status: 'not_eligible', message: plan.ineligible ?? 'This result cannot be sent.' };
  else if (!await service.signedIn()) sync = { status: 'signed_out' };
  else {
    const result = await service.submitResult(plan.payload).catch((): ResultSubmission => ({ kind: 'unavailable' }));
    sync = syncFrom(result, plan.payload, service.leaderboardURL(), plan.solutionNote);
    sent = result.kind === 'recorded';
    if (sync.status === 'unavailable') payload = plan.payload;
  }
  const view = hostedResultViewSchema.parse({ ...base, sync });
  // Saving the outcome must not turn a graded submission into an error.
  await engine.saveHostedResult(workspace, submission, view, { ...(payload ? { payload } : {}), sent }).catch(() => undefined);
  return report;
}

/** Resend the identical body after a quiet failure. An identical replay is idempotent on the service. */
export async function retryHostedResult(engine: HostedEngine, service: ResultService, workspace: string, submission: number): Promise<HostedResultView | null> {
  const saved = await engine.hostedResult(workspace, submission);
  if (!saved) return null;
  const attempt = await engine.hostedAttempt(workspace);
  if (saved.view.sync.status !== 'unavailable' || !saved.payload || attempt?.sent) return saved.view;
  if (!await service.signedIn()) return saved.view;
  const result = await service.submitResult(saved.payload).catch((): ResultSubmission => ({ kind: 'unavailable' }));
  const view = hostedResultViewSchema.parse({ ...saved.view, sync: syncFrom(result, saved.payload, service.leaderboardURL()) });
  await engine.saveHostedResult(workspace, submission, view, { ...(view.sync.status === 'unavailable' ? { payload: saved.payload } : {}), sent: result.kind === 'recorded' });
  return view;
}
