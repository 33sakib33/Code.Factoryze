import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import type { PracticeWorkspace } from '@factoryze/protocol';
import { el } from './dom';
import { tokens } from './flow-model';

/** The task brief, pinned above the file tree in the Explorer. */
export class FactoryzeBriefWidget extends BaseWidget {
  static readonly ID = 'factoryze-brief';
  constructor() {
    super();
    this.id = FactoryzeBriefWidget.ID;
    this.title.label = 'Task';
    this.title.caption = 'Task brief';
    this.addClass('fz-brief');
  }
  display(context: PracticeWorkspace | null, python?: string): void {
    if (!context) { this.node.replaceChildren(el('p', { class: 'fz-muted', text: 'This folder isn\'t a Factoryze attempt.' })); return; }
    const { task } = context;
    this.node.replaceChildren(el('p', { text: task.brief }), el('dl', {},
      el('dt', { text: 'Time' }), el('dd', { text: `About ${task.timeHintMinutes ?? 30} minutes` }),
      el('dt', { text: 'Budget' }), el('dd', { text: `${tokens(context.budgetTokens ?? 100000)} tokens` }),
      el('dt', { text: 'Python' }), el('dd', { text: python ? `${python} in .venv` : `${task.minimumPython} or newer, in .venv` }),
      ...(task.recommendedKnowledge?.length ? [el('dt', { text: 'Helpful background' }), el('dd', { text: task.recommendedKnowledge.join(' · ') })] : [])));
  }
}
