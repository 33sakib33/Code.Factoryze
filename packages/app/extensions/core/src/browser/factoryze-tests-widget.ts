import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import type { PublicTestResult } from '@factoryze/protocol';
import { el, errorText, icon } from './dom';

/** Public test results, next to the terminal. Hidden checks only run on Submit. */
export class FactoryzeTestsWidget extends BaseWidget {
  static readonly ID = 'factoryze-tests';
  constructor() {
    super();
    this.id = FactoryzeTestsWidget.ID;
    this.title.label = 'Tests';
    this.title.iconClass = 'codicon codicon-beaker';
    this.title.closable = true;
    this.addClass('fz-tests');
    this.node.tabIndex = 0;
    this.idle();
  }
  idle(): void { this.node.replaceChildren(el('p', { class: 'fz-note', text: 'Run tests to check your code against the task\'s public tests.' })); }
  running(): void { this.node.replaceChildren(el('p', { class: 'fz-note', role: 'status', text: 'Running public tests…' })); }
  failed(error: unknown): void { this.node.replaceChildren(el('p', { class: 'fz-error', role: 'alert', text: errorText(error) })); }
  display(result: PublicTestResult, lab = false): void {
    const failures = new Map(result.failures.map(failure => [failure.name, failure.message]));
    this.node.replaceChildren(...[
      el('p', { class: 'fz-sum', role: 'status', text: `${result.passed} of ${result.total} public test${result.total === 1 ? '' : 's'} passed` }),
      result.failures.length ? el('ul', {}, ...[...failures].map(([name, message]) => el('li', { class: 'fz-bad' }, icon('close'), el('span', { text: name }), el('span', { class: 'fz-why', text: message })))) : null,
      el('p', { class: 'fz-note', text: lab ? 'Public tests don\'t cover everything. Lab submissions are saved for isolated grading and instructor release.' : 'Public tests don\'t cover everything. Submitting runs the hidden checks as well.' })].filter((node): node is NonNullable<typeof node> => !!node));
  }
}
