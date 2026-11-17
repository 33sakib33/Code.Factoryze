import type { PracticeReport, PromptAssessment, PromptUsage } from '@factoryze/protocol';

const labels = { prompt: 'Starting a prompt', exploration: 'After exploring files', editing: 'After editing files',
  commands: 'After running commands', mixed: 'After mixed activity', unattributed: 'Unattributed' };
export type ReportPromptRow = Omit<PromptUsage, 'weighted' | 'state'> & { weighted: number | null; state?: PromptUsage['state']; assessment?: PromptAssessment };

/** Never join an old submission to the live attempt's prompt costs. Missing snapshots stay unknown. */
export function reportPromptRows(report: PracticeReport): ReportPromptRow[] {
  const assessments = new Map(report.promptAssessments?.map(assessment => [assessment.promptId, assessment]));
  if (report.insights) return report.insights.prompts.map(prompt => ({ ...prompt, assessment: assessments.get(prompt.promptId) }));
  return (report.promptAssessments ?? []).map((assessment, index) => ({ promptId: assessment.promptId,
    index: index + 1, weighted: null, assessment }));
}

export function reportLearning(report: PracticeReport) {
  const usage = report.workspaceUsage;
  const raw = usage?.reduce((sum, item) => ({ input: sum.input + item.raw.input, output: sum.output + item.raw.output,
    cacheRead: sum.cacheRead + item.raw.cacheRead, cacheWrite: sum.cacheWrite + item.raw.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const measured = usage ? usage.reduce((sum, item) => sum + item.weighted, 0) : null;
  const requests = usage?.reduce((sum, item) => sum + item.requests, 0);
  const total = report.insights?.attribution.reduce((sum, item) => sum + item.weighted, 0) ?? 0;
  const buckets = (report.insights?.attribution ?? []).filter(bucket => bucket.requests > 0).map(bucket => ({ ...bucket,
    label: labels[bucket.kind], percent: total ? Math.round(bucket.weighted / total * 1000) / 10 : 0 }));
  const coverageNote = !report.insights ? 'This earlier submission has no activity snapshot. Its saved token totals remain available.'
    : report.insights.coverage === 'unavailable' ? 'Activity history is unavailable. Observed usage is shown without guessing what happened.'
      : report.insights.coverage === 'partial' ? 'Some activity or token counts are incomplete. These are the observations saved at submission.'
        : 'Activity and usage were saved at submission. Later work does not change this report.';
  return { measured, requests, buckets, coverageNote,
    tokens: [{ label: 'Fresh input', value: raw ? raw.input - raw.cacheRead - raw.cacheWrite : null },
      { label: 'Cache reads', value: raw?.cacheRead ?? null }, { label: 'Cache writes', value: raw?.cacheWrite ?? null },
      { label: 'Output', value: raw?.output ?? null }] };
}

/** Presentation facts only: missing historical data stays unknown; no score or advice is inferred. */
export function reportFacts(report: PracticeReport, budgetLimit: number, startedAt?: string) {
  const learning = reportLearning(report), rows = reportPromptRows(report);
  const duration = startedAt ? Date.parse(report.submittedAt) - Date.parse(startedAt) : NaN;
  return { weighted: learning.measured, budgetLimit: report.budget?.limit ?? budgetLimit,
    prompts: report.insights || rows.length || learning.requests === 0 ? rows.length : null,
    minutes: Number.isFinite(duration) && duration >= 0 ? Math.max(1, Math.round(duration / 60_000)) : null,
    models: report.workspaceUsage ? [...new Set(report.workspaceUsage.filter(item => item.requests).map(item => item.scope.model))] : null };
}
