import { practiceReportSchema, type PracticeReport } from '../packages/protocol/src/index';
import { el } from '../packages/app/extensions/core/src/browser/dom';
import { rememberPrompt } from '../packages/app/extensions/core/src/browser/prompt-history';
import { renderReportFacts, renderReportLearning, renderReportPrompts } from '../packages/app/extensions/core/src/browser/report-learning-section';

import { renderReportResult, type ReportResult } from '../packages/app/extensions/core/src/browser/report-result';

// Synthetic data rendered by the same components and CSS as the app.
const complete: PracticeReport = {
  schema: 1, kind: 'practice', taskId: 'library-fines', submittedAt: '2026-10-24T10:42:00.000Z',
  correctness: { passed: 9, total: 9 }, usage: [],
  // Historical scores deliberately remain in the fixture to verify the new UI never displays them.
  scoring: { scoring_version: 1, correctness: 100, efficiency: null, specificity: 30, total: null, unavailable: ['Synthetic missing baseline'] },
  checks: ['On-time return', 'Late return', 'Branch-local date boundary', 'Missing return date', 'Weekend policy',
    'Multiple loans', 'Fine cap', 'Evening boundary', 'No outstanding loans'].map(name => ({ name, passed: true })),
  workspaceUsage: [{ scope: { userId: 'preview', taskId: 'library-fines', profile: 'factoryze@0.1.0', model: 'Example coding model' },
    raw: { input: 16_000, output: 2_320, cacheRead: 7_200, cacheWrite: 0 }, weighted: 11_840,
    requests: 8, incompleteRequests: 0, promptTurns: 3, promptTurnsComplete: true }],
  insights: { schema: 1, coverage: 'recorded', incompleteRequests: 0,
    prompts: [{ promptId: 'mock-report-p1', index: 1, weighted: 8_200, state: 'complete' },
      { promptId: 'mock-report-p2', index: 2, weighted: 2_640, state: 'complete' },
      { promptId: 'mock-report-p3', index: 3, weighted: 1_000, state: 'complete' }],
    tools: { exploration: 9, editing: 2, commands: 2, failed: 0, unfinished: 0 },
    approvals: { approved: 4, declined: 0, cancelled: 0 },
    attribution: [{ kind: 'prompt', requests: 3, weighted: 2_000 }, { kind: 'exploration', requests: 2, weighted: 7_200 },
      { kind: 'editing', requests: 1, weighted: 1_440 }, { kind: 'commands', requests: 1, weighted: 800 },
      { kind: 'mixed', requests: 1, weighted: 400 }, { kind: 'unattributed', requests: 0, weighted: 0 }] },
  promptAssessments: [
    { promptId: 'mock-report-p1', model: 'Example coding model', status: 'scored', acceptedEdit: false,
      verdict: { category: 'vague', specificity: 30, reason: 'Synthetic historical feedback must not be displayed.' } },
    { promptId: 'mock-report-p2', model: 'Example coding model', status: 'off', acceptedEdit: true },
    { promptId: 'mock-report-p3', model: 'Example coding model', status: 'off', acceptedEdit: false }],
};
rememberPrompt('mock-report-p1', 'Fix the incorrect fines.');
rememberPrompt('mock-report-p2', 'In library/returns.py, use the branch-local date to decide whether a return is late. Check the same-day return at the evening boundary.');
rememberPrompt('mock-report-p3', 'Run python -m unittest discover -s tests and tell me which public checks passed.');
const partial = structuredClone(complete);
partial.correctness = { passed: 7, total: 9 };
partial.checks![2] = { ...partial.checks![2]!, passed: false,
  message: 'Expected the return to be on time on the branch-local due date; it was marked one day late.' };
partial.checks![7] = { ...partial.checks![7]!, passed: false,
  message: 'Expected a zero fine for an evening return on the due date; the report charged one late day.' };
partial.insights!.coverage = 'partial'; partial.insights!.incompleteRequests = 1;
partial.insights!.tools.failed = 1;
partial.insights!.prompts[2] = { ...partial.insights!.prompts[2]!, state: 'stopped', incomplete: true };
partial.workspaceUsage![0]!.incompleteRequests = 1;
const older = structuredClone(complete); delete older.insights; delete older.checks;
const manual = structuredClone(complete); manual.workspaceUsage = []; manual.promptAssessments = [];
manual.insights!.prompts = []; manual.insights!.tools = { exploration: 0, editing: 0, commands: 0, failed: 0, unfinished: 0 };
manual.insights!.approvals.approved = 0;
manual.insights!.attribution = manual.insights!.attribution.map(bucket => ({ ...bucket, requests: 0, weighted: 0 }));
const reports = { complete, partial, older, manual };
Object.values(reports).forEach(report => practiceReportSchema.parse(report));
const select = document.querySelector<HTMLSelectElement>('#report-state')!;
const root = document.querySelector<HTMLElement>('#report-content')!;

let result: ReportResult | undefined;
function render() {
  result?.closeDetails();
  const report = reports[select.value as keyof typeof reports];
  result = renderReportResult(report);
  root.replaceChildren(
    el('div', { class: 'preview-breadcrumb', text: 'Results / Library fines / Attempt 1' }),
    el('div', { class: 'fz-report-head' }, el('div', {}, el('h1', { text: 'Library fines, attempt 1' }),
      el('p', { text: 'Submitted 24 October, 16:42. Practice result, not checked by an instructor.' })),
      el('span', { class: 'preview-submission', text: 'Submission 1 · saved report' })),
    result.node,
    renderReportFacts(report, 25000, '2026-10-24T10:30:00.000Z'),
    renderReportLearning(report),
    el('details', { class: 'fz-details' }, el('summary', { text: 'Recorded agent settings' }),
      el('p', { class: 'fz-help', text: 'Example coding model · factoryze@0.1.0 · Windows · provider-default temperature. Illustrative configuration.' })),
    renderReportPrompts(report),
    el('p', { class: 'preview-footnote', text: 'Interactive mockup · all numbers and prompt text are synthetic. Switch examples above to inspect incomplete counts and older reports.' }));
}
select.addEventListener('change', render);
const theme = document.querySelector<HTMLButtonElement>('#theme')!;
theme.addEventListener('click', () => {
  const dark = document.body.classList.toggle('theia-dark');
  theme.textContent = dark ? 'Light appearance' : 'Dark appearance';
  theme.setAttribute('aria-pressed', String(dark));
});
render();
