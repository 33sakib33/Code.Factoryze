import type { PracticeReport } from '@factoryze/protocol';

/** A participant-controlled summary. Only immutable report facts are used. */
export function reportShareSummary(report: PracticeReport, title: string, budgetLimit: number): string {
  const lines = [`${title.replace(/\s+/g, ' ').trim().slice(0, 100)} — Factoryze practice`,
    `${report.correctness.passed}/${report.correctness.total} checks passed`];
  const usage = report.workspaceUsage;
  if (usage?.length && usage.every(item => item.incompleteRequests === 0) &&
      usage.some(item => item.requests > 0)) {
    const weighted = usage.reduce((sum, item) => sum + item.weighted, 0);
    const limit = report.budget?.limit ?? budgetLimit;
    if (Number.isFinite(weighted) && Number.isFinite(limit) && limit > 0) {
      lines.push(`${Math.round(weighted).toLocaleString('en-US')}/${Math.round(limit).toLocaleString('en-US')} weighted tokens (${Math.round(weighted / limit * 100)}% of budget)`);
    }
  }
  if (report.scoring?.total !== null && report.scoring?.total !== undefined) {
    lines.push(`${Math.round(report.scoring.total)}/100 optional score`);
  }
  lines.push('Personal practice result · not independently verified');
  return lines.join('\n');
}

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[character]!);

/** Self-contained image for a participant to attach to a social post. */
export function reportShareCard(summary: string): string {
  const lines = summary.split('\n').slice(0, 5).map((line, index) => escapeXml([...line].slice(0, index === 0 ? 42 : index === 4 ? 75 : 65).join('')));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Factoryze practice result"><rect width="1200" height="630" fill="#102b30"/><rect x="48" y="48" width="1104" height="534" rx="28" fill="#f5f7f6"/><rect x="48" y="48" width="1104" height="12" fill="#00a89d"/><text x="96" y="132" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#007e79">FACTORYZE / PRACTICE</text>${lines.map((line, index) => `<text x="96" y="${220 + index * 73}" font-family="Arial,sans-serif" font-size="${index === 0 ? 43 : index === lines.length - 1 ? 25 : 34}" font-weight="${index === 0 ? 700 : 500}" fill="#17343a">${line}</text>`).join('')}</svg>`;
}
