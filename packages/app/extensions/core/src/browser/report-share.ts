import type { PracticeReport } from '@factoryze/protocol';

/** Where a reader goes to try it themselves: the tasks run in the desktop editor, so the dare leads to its download. */
export const SHARE_LINK = 'https://code.factoryze.tech/download/';
const NOTE = 'Personal practice result · not independently verified';
const count = (value: number): string => Math.round(value).toLocaleString('en-US');

type ShareFacts = { headline: string; detail: string | null; dare: string };
/** Only immutable report facts are used. "Fixed" is said only when every check passed. */
function shareFacts(report: PracticeReport, title: string, budgetLimit: number, titleLimit: number): ShareFacts {
  const name = [...title.replace(/\s+/g, ' ').trim()].slice(0, titleLimit).join('');
  const { passed, total } = report.correctness;
  const solved = total > 0 && passed === total;
  const checks = `${passed}/${total} checks passed`;
  let tokens: string | null = null;
  const usage = report.workspaceUsage;
  if (usage?.length && usage.every(item => item.incompleteRequests === 0) &&
      usage.some(item => item.requests > 0)) {
    const weighted = usage.reduce((sum, item) => sum + item.weighted, 0);
    const limit = report.budget?.limit ?? budgetLimit;
    if (Number.isFinite(weighted) && Number.isFinite(limit) && limit > 0) {
      tokens = `${count(weighted)} of ${count(limit)} weighted tokens (${Math.round(weighted / limit * 100)}% of budget)`;
    }
  }
  const score = report.scoring?.total !== null && report.scoring?.total !== undefined
    ? `${Math.round(report.scoring.total)}/100 optional score` : null;
  const dare = solved ? 'Can you beat it?' : 'Can you fix it?';
  if (solved && tokens) return { headline: `Fixed “${name}” in ${tokens}.`, detail: [checks, score].filter(Boolean).join(' · '), dare };
  if (solved) return { headline: `Fixed “${name}”. ${checks}.`, detail: score, dare };
  return { headline: `“${name}”: ${checks}${tokens ? `, using ${tokens}` : ''}.`, detail: score, dare };
}

/** A participant-controlled summary: the result first, then a dare and where to take it up. */
export function reportShareSummary(report: PracticeReport, title: string, budgetLimit: number, link: string = SHARE_LINK): string {
  const facts = shareFacts(report, title, budgetLimit, 100);
  return [facts.headline, facts.detail, `${facts.dare} ${link}`, NOTE].filter(Boolean).join('\n');
}

/** A compose link for X. The address travels as its own field, so the text carries no link. */
export function reportSharePostURL(report: PracticeReport, title: string, budgetLimit: number, link: string = SHARE_LINK): string {
  const facts = shareFacts(report, title, budgetLimit, 60);
  const text = [facts.headline, facts.dare, 'Self-reported practice result.'].join('\n');
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
}

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[character]!);

/** Self-contained image for a participant to attach to a social post. */
export function reportShareCard(summary: string): string {
  const [headline = '', ...rest] = summary.split('\n').slice(0, 5);
  const words = headline.split(' '); const rows: string[] = [''];
  for (const word of words) {
    const row = rows[rows.length - 1]!;
    if (row && [...row].length + [...word].length + 1 > 44 && rows.length < 3) rows.push(word); else rows[rows.length - 1] = row ? `${row} ${word}` : word;
  }
  const head = rows.map(row => escapeXml([...row].slice(0, 48).join('')));
  const body = rest.map(line => escapeXml([...line].slice(0, 70).join('')));
  let y = 148;
  const text = (line: string, size: number, weight: number, gap: number): string => { y += gap; return `<text x="96" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="#17343a">${line}</text>`; };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Factoryze practice result"><rect width="1200" height="630" fill="#102b30"/><rect x="48" y="48" width="1104" height="534" rx="28" fill="#f5f7f6"/><rect x="48" y="48" width="1104" height="12" fill="#00a89d"/><text x="96" y="132" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#007e79">FACTORYZE / PRACTICE</text>${head.map(row => text(row, 43, 700, 62)).join('')}${body.map((line, index) => text(line, index === body.length - 1 ? 25 : 34, index === body.length - 2 ? 700 : 500, index === 0 ? 76 : 60)).join('')}</svg>`;
}
