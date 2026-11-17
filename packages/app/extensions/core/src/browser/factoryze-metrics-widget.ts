import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { Disposable } from '@theia/core/lib/common/disposable';
import { WorkbenchMetrics } from './workbench-metrics';
import { WorkbenchPanes, type PaneArea } from './workbench-panes';
import { button, el, icon, meter } from './dom';
import { tokens } from './flow-model';

export type TitleBarActions = { home(): void; settings(): void; runTests(): void; submit(): void };

/**
 * The title row. On Home it shows the product and the model connection. Inside an attempt it shows
 * the way back to Home, the attempt, its per-prompt budget meter, the elapsed time and the two task actions.
 */
export class FactoryzeMetricsWidget extends BaseWidget {
  static readonly ID = 'factoryze-metrics';
  private readonly homeBar = el('div', { class: 'fz-tb fz-tb-home' });
  private readonly attemptBar = el('div', { class: 'fz-tb fz-tb-attempt' });
  private readonly chipDot = el('span', { class: 'fz-dot' });
  private readonly chipLabel = el('span', { class: 'fz-chip-label' });
  private readonly task = el('strong');
  private readonly attempt = el('span');
  private readonly used = el('b');
  private readonly limit = el('span');
  private readonly left = el('span');
  private readonly meterSlot = el('div', { class: 'fz-meter-slot' });
  private readonly budget = el('div', { class: 'fz-budget' });
  private readonly budgetButton = el('button', { type: 'button', class: 'fz-budget-btn', aria: { expanded: 'false', label: 'Token budget details' } });
  private readonly popover = el('div', { class: 'fz-popover', hidden: true, role: 'dialog', aria: { label: 'Token budget details' } });
  private readonly clock = el('time');
  private readonly paneButtons = new Map<PaneArea, HTMLButtonElement>();

  constructor(private readonly metrics: WorkbenchMetrics, private readonly panes: WorkbenchPanes, actions: TitleBarActions) {
    super();
    this.id = FactoryzeMetricsWidget.ID;
    this.addClass('factoryze-metrics');
    const chip = el('button', { type: 'button', class: 'fz-chip', title: 'Model connection', on: { click: () => actions.settings() } }, this.chipDot, this.chipLabel);
    this.homeBar.append(el('span', { class: 'fz-wordmark', text: 'Factoryze' }), el('span', { class: 'fz-grow' }), chip,
      el('button', { type: 'button', class: 'fz-icon-btn', title: 'Settings', aria: { label: 'Settings' }, on: { click: () => actions.settings() } }, icon('settings-gear')));

    this.budgetButton.append(el('span', { class: 'fz-budget-text' }, el('span', {}, this.used, ' of ', this.limit, ' tokens'), this.left), this.meterSlot);
    this.budgetButton.addEventListener('click', () => this.togglePopover());
    this.budget.append(this.budgetButton, this.popover);
    const toggles = el('span', { class: 'fz-toggles', role: 'group', aria: { label: 'Panes' } });
    for (const [area, label, glyph] of [['left', 'Explorer', 'layout-sidebar-left'], ['bottom', 'Terminal and tests', 'layout-panel'], ['right', 'Agent', 'layout-sidebar-right']] as const) {
      const toggle = el('button', { type: 'button', class: 'fz-icon-btn', aria: { label: `Show ${label.toLowerCase()}` }, data: { pane: area } }, icon(glyph));
      toggle.addEventListener('click', () => { toggle.disabled = true; void this.panes.toggle(area).finally(() => { toggle.disabled = false; this.refreshPanes(); }); });
      this.paneButtons.set(area, toggle);
      toggles.append(toggle);
    }
    this.attemptBar.append(
      el('div', { class: 'fz-tb-group' }, button('Home', () => actions.home(), { kind: 'quiet', small: true, icon: 'chevron-left', title: 'Back to Home. This attempt stays in Continue.' }),
        el('span', { class: 'fz-divider' }), el('span', { class: 'fz-attempt-title' }, this.task, this.attempt)),
      this.budget,
      el('div', { class: 'fz-tb-group' }, el('span', { class: 'fz-timer', title: 'Time since this attempt started' }, icon('watch'), this.clock),
        button('Run tests', () => actions.runTests(), { small: true, icon: 'play' }), button('Submit', () => actions.submit(), { kind: 'primary', small: true }), toggles,
        el('button',{type:'button',class:'fz-icon-btn',title:'Settings',aria:{label:'Settings'},on:{click:()=>actions.settings()}},icon('settings-gear'))));
    this.node.append(this.homeBar, this.attemptBar);

    const closePopover = (event: Event) => { if (!this.budget.contains(event.target as Node)) this.togglePopover(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.togglePopover(false); };
    document.addEventListener('mousedown', closePopover); document.addEventListener('keydown', escape);
    const unsubscribe = metrics.subscribe(() => this.render());
    const timer = window.setInterval(() => { this.renderClock(); this.refreshPanes(); }, 1000);
    this.toDispose.push(Disposable.create(() => { unsubscribe(); window.clearInterval(timer); document.removeEventListener('mousedown', closePopover); document.removeEventListener('keydown', escape); }));
    this.render();
    // The layout is already restored when the toolbar is built; start with its real pane state, not "Show".
    this.refreshPanes();
  }

  private togglePopover(open = this.popover.hidden): void {
    this.popover.hidden = !open;
    this.budgetButton.setAttribute('aria-expanded', String(open));
  }

  refreshPanes(): void {
    for (const [area, toggle] of this.paneButtons) {
      const visible = this.panes.isVisible(area);
      toggle.setAttribute('aria-pressed', String(visible));
      const label = area === 'left' ? 'explorer' : area === 'bottom' ? 'terminal and tests' : 'agent';
      toggle.title = `${visible ? 'Hide' : 'Show'} ${label}`;
      toggle.setAttribute('aria-label', toggle.title);
    }
  }

  private render(): void {
    const state = this.metrics.snapshot();
    this.homeBar.hidden = !state.home; this.attemptBar.hidden = state.home;
    this.chipDot.className = `fz-dot${state.model ? '' : ' fz-off'}`;
    this.chipLabel.textContent = state.model ?? (state.model === null ? 'No model connected' : 'Checking model…');
    this.task.textContent = state.taskTitle ?? 'Practice task';
    this.attempt.textContent = state.attempt ? `Attempt ${state.attempt}` : '';
    const limit = state.budgetLimit, used = Math.min(state.weighted, limit || state.weighted), remaining = Math.max(0, limit - state.weighted);
    this.used.textContent = tokens(used); this.limit.textContent = limit ? tokens(limit) : '—';
    this.left.textContent = !limit ? '' : state.status === 'incomplete' ? 'Count incomplete' : remaining ? `${tokens(remaining)} left` : 'Budget used up';
    this.budget.classList.toggle('fz-full', !!limit && !remaining);
    this.meterSlot.replaceChildren(meter(state.segments.map(segment => ({ tokens: segment.tokens, label: segment.label, active: segment.active })), limit || 1));
    const cached = state.raw.cacheRead;
    this.popover.replaceChildren(
      el('dl', {}, el('dt', { text: 'Input' }), el('dd', { text: tokens(state.raw.input) }),
        el('dt', { text: 'Cached input, counted at a tenth' }), el('dd', { text: tokens(cached) }),
        el('dt', { text: 'Output' }), el('dd', { text: tokens(state.raw.output) }),
        el('dt', { text: 'Counted against the budget' }), el('dd', { class: 'fz-total', text: tokens(state.weighted) })),
      el('p', { text: 'Each segment is one prompt. Hover a segment to see what it cost. Input includes the agent\'s instructions, tool descriptions and the conversation so far.' }));
    this.renderClock();
  }

  private renderClock(): void { this.clock.textContent = this.metrics.elapsed(); }
}
