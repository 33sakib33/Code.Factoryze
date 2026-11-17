import { createHash } from 'node:crypto';
import { desktopResultShareInputSchema, type DesktopResultShareInput, type PracticeReport } from '@factoryze/protocol';

/** Project only immutable, displayed facts from a saved solo report. Never send the report itself. */
export function desktopResultShareInput(report: PracticeReport, title: string, budgetLimit: number): DesktopResultShareInput {
  if (report.lab) throw new Error('Lab reports cannot be published as local results.');
  const reportKey = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const usage = report.workspaceUsage;
  const complete = Boolean(usage?.length && usage.every(item => item.incompleteRequests === 0) && usage.some(item => item.requests > 0));
  const weighted = complete ? usage!.reduce((sum, item) => sum + item.weighted, 0) : undefined;
  const limit = report.budget?.limit ?? budgetLimit;
  const eligible = weighted !== undefined && Number.isSafeInteger(Math.round(weighted)) && Number.isSafeInteger(Math.round(limit)) && limit > 0;
  return desktopResultShareInputSchema.parse({ reportKey, taskId: report.taskId,
    title: title.replace(/\s+/g, ' ').trim().slice(0, 120), submittedAt: report.submittedAt,
    passed: report.correctness.passed, total: report.correctness.total,
    ...(eligible ? { weightedTokens: Math.round(weighted), budgetTokens: Math.round(limit) } : {}),
    ...(report.scoring?.total === null || report.scoring?.total === undefined ? {} : { score: Math.round(report.scoring.total) }) });
}
