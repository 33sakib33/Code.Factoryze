/**
 * What Home shows once a person has a result: one square per practice task, filled in as tasks are solved.
 * A task counts as solved when any submission passed every hidden check.
 */
export type RecordCell = { taskId: string; title: string; state: 'solved' | 'tried' | 'new'; /** Fewest tokens among the submissions that solved it. */ fewest?: number };
export type HomeRecord = { cells: RecordCell[]; solved: number; tried: number; total: number; best?: { title: string; tokens: number } };

type Task = { id: string; title: string; hosted?: true };
type Result = { taskId: string; passed: number; total: number; weighted: number };

/** Tasks on this computer, in catalog order. Results for tasks that are no longer listed, online tasks and lab work are left out. */
export function homeRecord(tasks: readonly Task[], results: readonly Result[]): HomeRecord {
  const cells = tasks.filter(task => !task.hosted).map((task): RecordCell => {
    const mine = results.filter(result => result.taskId === task.id), solved = mine.filter(result => result.passed === result.total);
    if (solved.length) return { taskId: task.id, title: task.title, state: 'solved', fewest: Math.min(...solved.map(result => result.weighted)) };
    return { taskId: task.id, title: task.title, state: mine.length ? 'tried' : 'new' };
  });
  const solved = cells.filter(cell => cell.state === 'solved');
  const best = solved.reduce<RecordCell | undefined>((least, cell) => !least || cell.fewest! < least.fewest! ? cell : least, undefined);
  return { cells, solved: solved.length, tried: cells.filter(cell => cell.state === 'tried').length, total: cells.length,
    ...(best ? { best: { title: best.title, tokens: best.fewest! } } : {}) };
}

/** One sentence per square, for the tooltip and for people who cannot see the map. */
export function recordCellLabel(cell: RecordCell): string {
  const count = (value: number) => Math.round(value).toLocaleString('en-US');
  if (cell.state === 'solved') return cell.fewest ? `${cell.title}: solved with ${count(cell.fewest)} tokens` : `${cell.title}: solved without the agent`;
  return cell.state === 'tried' ? `${cell.title}: tried, not solved yet` : `${cell.title}: not started`;
}

export function recordSummary(record: HomeRecord): string {
  const parts = [`${record.solved} of ${record.total} tasks solved`];
  if (record.tried) parts.push(`${record.tried} more tried`);
  return parts.join(', ');
}

export type TaskStatus = { kind: 'progress' | 'solved' | 'tried' | 'new'; label: string };
type Attempt = { taskId: string; attempt: number; submissions: number; lab?: string };

/**
 * What a task row says about your own work, so the list answers "what should I do next" by itself.
 * An attempt that is still open comes first, because that is where the work is.
 */
export function taskStatus(taskId: string, attempts: readonly Attempt[], results: readonly Result[]): TaskStatus {
  const open = attempts.filter(item => item.taskId === taskId && !item.lab && item.submissions === 0).sort((a, b) => b.attempt - a.attempt)[0];
  if (open) return { kind: 'progress', label: `Attempt ${open.attempt} in progress` };
  const mine = results.filter(result => result.taskId === taskId), solved = mine.filter(result => result.passed === result.total);
  if (solved.length) {
    const fewest = Math.min(...solved.map(result => result.weighted));
    return { kind: 'solved', label: fewest ? `Solved with ${Math.round(fewest).toLocaleString('en-US')} tokens` : 'Solved without the agent' };
  }
  const best = [...mine].sort((a, b) => b.passed / b.total - a.passed / a.total)[0];
  return best ? { kind: 'tried', label: `Best result: ${best.passed} of ${best.total} checks` } : { kind: 'new', label: 'Not attempted yet' };
}

/** Home shows the newest results first and keeps the rest one click away. */
export function latestResults<T extends { submittedAt: string }>(results: readonly T[], showAll: boolean, limit = 3): { shown: T[]; hidden: number } {
  const newest = [...results].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const shown = showAll ? newest : newest.slice(0, limit);
  return { shown, hidden: newest.length - shown.length };
}
