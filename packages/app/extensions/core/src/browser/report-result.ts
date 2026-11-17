import type { PracticeReport } from '@factoryze/protocol';
import { el } from './dom';
import { checkLabel } from './flow-model';

export type ReportResult = { node: HTMLElement; closeDetails(): void };

/** One segment per recorded check position. Older reports keep missing check details unknown. */
export function renderReportResult(report: PracticeReport): ReportResult {
  const { passed, total } = report.correctness, allPassed = passed === total, failed = Math.max(0, total - passed);
  let activeDialog: HTMLDialogElement | undefined;
  const closeDetails = () => { activeDialog?.close(); activeDialog?.remove(); activeDialog = undefined; };
  const progress = el('div', { class: 'fz-report-sticker', aria: { hidden: 'true' } },
    el('div', { class: 'fz-report-sticker-face' },
      el('span', { class: 'fz-report-sticker-percent', text: `${Math.round(passed / total * 100)}%` }),
      el('span', { class: 'fz-report-sticker-caption', text: 'passed' })));
  const ns = 'http://www.w3.org/2000/svg', perimeter = document.createElementNS(ns, 'svg');
  perimeter.setAttribute('viewBox', '0 0 96 96'); perimeter.setAttribute('class', 'fz-report-check-segments');
  const step = 360 / total, gap = Math.min(8, step * 0.2);
  const point = (angle: number) => {
    const radians = (angle - 90) * Math.PI / 180;
    return `${(48 + 44 * Math.cos(radians)).toFixed(3)} ${(48 + 44 * Math.sin(radians)).toFixed(3)}`;
  };
  for (let index = 0; index < total; index++) {
    const check = report.checks?.[index], start = index * step + gap / 2, end = (index + 1) * step - gap / 2;
    const status = check ? check.passed ? 'passed' : 'failed' : 'unknown';
    const segment = document.createElementNS(ns, 'path');
    segment.setAttribute('class', `fz-report-check-segment fz-report-segment-${status}`);
    segment.setAttribute('d', `M ${point(start)} A 44 44 0 ${end - start > 180 ? 1 : 0} 1 ${point(end)}`);
    const title = document.createElementNS(ns, 'title'); title.textContent = `${check ? checkLabel(check.name) : `Check ${index + 1}`}: ${status}`;
    segment.append(title); perimeter.append(segment);
  }
  progress.prepend(perimeter);
  const details = el('button', { type: 'button', class: 'fz-btn fz-report-result-details',
    text: !report.checks?.length ? 'View check details' : allPassed ? `View all ${total} checks` : `See ${failed} failed check${failed === 1 ? '' : 's'}`,
    on: { click: () => {
      if (activeDialog) return;
      const checks = report.checks ?? [], failures = checks.filter(check => !check.passed), successes = checks.filter(check => check.passed);
      const dialog = el('dialog', { class: 'fz-report-check-dialog', aria: { labelledby: 'fz-check-details-title', describedby: 'fz-check-details-summary' } });
      activeDialog = dialog;
      const close = el('button', { type: 'button', class: 'fz-btn fz-quiet fz-sm', text: 'Close details', on: { click: closeDetails } });
      const row = (check: (typeof checks)[number]) => el('li', { class: `fz-report-check-row ${check.passed ? 'fz-report-check-passed' : 'fz-report-check-failed'}` },
        el('div', { class: 'fz-report-check-name' }, el('strong', { text: checkLabel(check.name) }),
          el('span', { class: 'fz-report-check-state', text: check.passed ? 'Passed' : 'Failed' })),
        !check.passed ? el('p', { text: check.message ?? 'No failure reason was recorded.' }) : null);
      dialog.append(
        el('div', { class: 'fz-report-dialog-head' }, el('div', {}, el('h2', { id: 'fz-check-details-title', text: 'Hidden-check details' }),
          el('p', { id: 'fz-check-details-summary', text: `${passed} of ${total} passed${failed ? ` · ${failed} need attention` : ' · all checks passed'}` })), close),
        el('div', { class: 'fz-report-dialog-body' },
          checks.length !== total ? el('p', { class: 'fz-report-dialog-note', text: checks.length
            ? `Details were recorded for ${checks.length} of ${total} checks.` : 'Individual check details were not recorded for this earlier submission.' }) : null,
          failures.length ? el('section', {}, el('h3', { text: `Needs attention (${failures.length})` }),
            el('ul', { class: 'fz-report-check-list' }, ...failures.map(row))) : null,
          successes.length ? failures.length ? el('details', { class: 'fz-details' }, el('summary', { text: `Passed checks (${successes.length})` }),
            el('ul', { class: 'fz-report-check-list' }, ...successes.map(row))) : el('ul', { class: 'fz-report-check-list' }, ...successes.map(row)) : null));
      dialog.addEventListener('close', () => {
        dialog.remove(); if (activeDialog === dialog) activeDialog = undefined;
        if (details.isConnected) details.focus();
      }, { once: true });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetails();
      });
      document.body.append(dialog); dialog.showModal(); close.focus();
    } } });
  return { closeDetails, node: el('section', { class: `fz-report-result ${allPassed ? 'fz-report-result-pass' : 'fz-report-result-partial'}`,
    aria: { labelledby: 'fz-report-result-title' } }, progress,
    el('div', { class: 'fz-report-result-copy' }, el('p', { class: 'fz-report-result-label', text: 'Correctness' }),
      el('h2', { id: 'fz-report-result-title' }, el('strong', { class: 'fz-report-result-number', text: `${passed} / ${total}` }),
        el('span', { text: `hidden check${total === 1 ? '' : 's'} passed` })),
      el('p', { class: 'fz-report-result-message', text: allPassed ? 'All checks passed.' : `${failed} check${failed === 1 ? ' needs' : 's need'} attention.` })), details) };
}
