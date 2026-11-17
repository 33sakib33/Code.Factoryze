import type { PracticeReport, WorkspaceUsage } from '@factoryze/protocol';

export function workspaceUsageLine(item: WorkspaceUsage): string {
  const turns = item.promptTurns === undefined ? 'turn count unavailable' :
    `${item.promptTurns} completed prompt turn${item.promptTurns === 1 ? '' : 's'}`;
  const history = item.promptTurnsComplete === false && item.promptTurns !== undefined ? ' (historical turns incomplete)' : '';
  return `${item.scope.model}: ${item.weighted} weighted tokens · ${item.raw.input} input / ${item.raw.output} output · ${item.requests} requests · ${turns}${history}`;
}

export function baselineLines(report: PracticeReport): string[] {
  return (report.baselineComparisons ?? []).map(item =>
    `${item.model} · ${item.profile}: ${item.weightedTokensRatio.toFixed(2)}× expert weighted tokens · ${item.promptTurnsRatio.toFixed(2)}× expert prompt turns`);
}

export function baselineNote(report: PracticeReport): string {
  if (report.baselineWarning) return 'The stored expert baseline is invalid or stale; no comparison was made with it.';
  if (report.correctness.passed !== report.correctness.total) return 'Pass all hidden checks before comparing efficiency.';
  if (!report.workspaceUsage) return 'This earlier report has no workspace usage for an efficiency comparison.';
  if (report.workspaceUsage.some(item => item.incompleteRequests)) return 'Token accounting is incomplete; efficiency cannot be compared.';
  if (report.workspaceUsage.some(item => item.requests && item.promptTurnsComplete === false))
    return 'Historical model calls have incomplete prompt-turn counts; start a new practice workspace for comparison.';
  if (report.workspaceUsage.some(item => item.requests && item.promptTurns === undefined))
    return 'Completed prompt turns are unavailable for this workspace.';
  if (!report.baselineComparisons?.length) return 'No matching measured expert baseline is available for this model.';
  return 'Expert baseline ratios are descriptive. Prompt-quality scoring is still in development.';
}
