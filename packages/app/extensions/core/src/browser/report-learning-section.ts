import type { PracticeReport } from '@factoryze/protocol';
import { el } from './dom';
import { tokens } from './flow-model';
import { reportFacts, reportLearning, reportPromptRows } from './report-learning';
import { promptText } from './prompt-history';

/** Shared with the HTML preview so the mockup renders the same report sections as the app. */
export function renderReportLearning(report: PracticeReport): HTMLElement {
  const learning = reportLearning(report), insights = report.insights;
  const figure = (label: string, value: number | null) => el('div', {}, el('dt', { text: label }), el('dd', { text: value === null ? 'Not recorded' : tokens(value) }));
  const stats = insights && insights.coverage !== 'unavailable' ? el('dl', { class: 'fz-activity-stats' },
    figure('Exploration calls', insights.tools.exploration), figure('Edit calls', insights.tools.editing),
    figure('Command calls', insights.tools.commands), figure('Actions approved', insights.approvals.approved)) : null;
  return el('section', { class: 'fz-report-learning', aria: { label: 'Activity and token usage' } },
    el('div', { class: 'fz-row-between' }, el('h2', { text: 'Activity and token usage' }),
      el('span', { class: 'fz-snapshot-label', text: insights ? 'Saved with this submission' : 'Earlier report' })),
    el('p', { class: 'fz-para fz-coverage-note', text: learning.coverageNote }),
    el('div', { class: 'fz-learning-grid' },
      el('div', { class: 'fz-card' }, el('h3', { text: 'Recorded activity' }), stats,
        insights && insights.coverage !== 'unavailable' ? el('p', { class: 'fz-help', text:
          `${insights.tools.failed} failed calls · ${insights.tools.unfinished} unfinished calls · ${insights.approvals.declined} declined approvals · ${insights.approvals.cancelled} cancelled approvals` })
          : el('p', { class: 'fz-help', text: 'No reliable tool counts were recorded for this submission.' }),
        el('p', { class: 'fz-help', text: 'Calls are counted when attempted. A command call alone does not show whether tests ran or passed.' })),
      el('div', { class: 'fz-card' }, el('h3', { text: 'Measured token counts' }),
        el('dl', { class: 'fz-activity-stats' }, ...learning.tokens.map(item => figure(item.label, item.value))),
        el('p', { class: 'fz-help', text: 'Raw provider counts. Input includes instructions, history and tool results. The budget total applies the recorded token weights.' }))),
    el('div', { class: 'fz-card fz-cost-breakdown' }, el('div', { class: 'fz-row-between' }, el('h3', { text: 'Usage after activity' }),
      el('span', { class: 'fz-muted', text: learning.requests === undefined ? 'Request count not recorded' : `${learning.requests} model request${learning.requests === 1 ? '' : 's'}` })),
      el('p', { class: 'fz-help', text: 'Measured model-request tokens, grouped by the tools before each request. Mixed steps stay together. Tools and context are not metered separately.' }),
      learning.buckets.length ? el('ul', { class: 'fz-cost-rows' }, ...learning.buckets.map(bucket => {
        const fill = el('span'); fill.style.width = `${bucket.percent}%`;
        return el('li', {}, el('span', { class: 'fz-cost-label', text: bucket.label }),
          el('span', { class: 'fz-cost-count', text: `${bucket.requests} request${bucket.requests === 1 ? '' : 's'}` }),
          el('strong', { class: 'fz-cost-value', text: `${tokens(bucket.weighted)} tokens · ${bucket.percent}%` }),
          el('span', { class: `fz-cost-bar fz-cost-${bucket.kind}`, aria: { hidden: 'true' } }, fill));
      })) : el('p', { class: 'fz-help', text: insights ? 'No model requests were recorded for this attempt.' : 'Request attribution was not saved in this earlier report.' })));
}

export function renderReportPrompts(report: PracticeReport): HTMLElement {
  const prompts = reportPromptRows(report), max = Math.max(1, ...prompts.map(prompt => prompt.weighted ?? 0));
  return el('section', { class: 'fz-report-prompts' }, el('h2', { text: 'Your prompts and token usage' }),
    prompts.length ? el('p', { class: 'fz-para', text: report.insights
      ? 'Bars compare the observed weighted tokens saved with this submission.'
      : 'Prompt text is stored on this device. Per-prompt costs were not recorded for this earlier submission.' }) : null,
    prompts.length ? el('ol', { class: 'fz-prompts' }, ...prompts.map(prompt => {
      const bar = el('span', { class: 'fz-bar' }, el('span'));
      (bar.firstElementChild as HTMLElement).style.width = `${((prompt.weighted ?? 0) / max * 100).toFixed(1)}%`;
      const state = prompt.incomplete || prompt.state === 'running' ? 'Counts incomplete' : prompt.state === 'failed' ? 'Turn failed'
        : prompt.state === 'stopped' ? 'Turn stopped' : '';
      return el('li', {}, el('span', { class: 'fz-idx', text: String(prompt.index) }),
        el('span', { class: 'fz-text', text: promptText(prompt.promptId) ?? `Prompt ${prompt.index}` }),
        el('span', { class: 'fz-tok', text: prompt.weighted === null ? 'Cost not recorded' : `${tokens(prompt.weighted)} tokens` }),
        prompt.weighted === null ? null : bar,
        state ? el('span', { class: 'fz-fb', text: state }) : null);
    })) : el('p', { class: 'fz-para', text: !report.workspaceUsage || report.workspaceUsage.some(item => item.requests)
      ? 'Prompt history was not recorded for this submission.' : 'You did not use the agent in this attempt.' }));
}

export function renderReportFacts(report: PracticeReport, budgetLimit: number, startedAt?: string): HTMLElement {
  const facts = reportFacts(report, budgetLimit, startedAt);
  const figure = (label: string, value: string, description: string, title?: string) => el('div', {},
    el('dt', { text: label }), el('dd', { text: value, title }), el('dd', { class: 'fz-report-metric-help', text: description }));
  return el('dl', { class: 'fz-figures' },
    figure('Token budget used', `${facts.weighted === null ? 'Not recorded' : tokens(facts.weighted)} / ${tokens(facts.budgetLimit)}`,
      'Weighted tokens used against the attempt limit.'),
    figure('Prompts sent', facts.prompts === null ? 'Not recorded' : String(facts.prompts), 'Messages you sent to the agent.'),
    figure('Time spent', facts.minutes === null ? 'Not recorded' : `${facts.minutes} minute${facts.minutes === 1 ? '' : 's'}`,
      'From the start of the attempt to submission.'),
    figure('Agent model', !facts.models ? 'Not recorded' : facts.models.length > 1 ? `${facts.models.length} models` : facts.models[0] ?? 'No agent used',
      'The model used during this attempt.', facts.models?.join(', ')));
}
