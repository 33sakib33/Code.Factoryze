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
