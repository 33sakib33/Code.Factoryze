import assert from 'node:assert/strict';
import test from 'node:test';
import { homeRecord, recordCellLabel, recordSummary } from '../src/browser/home-record.ts';
import { reportCostSentence } from '../src/browser/report-learning.ts';

const tasks = [{ id: 'library-fines', title: 'Library fines' }, { id: 'delivery-fee', title: 'Delivery fee' }, { id: 'retry-storm', title: 'Retry storm' },
  { id: 'online-one', title: 'Online one', hosted: true as const }];
const result = (taskId: string, passed: number, total: number, weighted: number) => ({ taskId, passed, total, weighted });

test('the record has one square per task on this computer, in catalog order, and starts empty', () => {
  const record = homeRecord(tasks, []);
  assert.deepEqual(record.cells.map(cell => [cell.taskId, cell.state]), [['library-fines', 'new'], ['delivery-fee', 'new'], ['retry-storm', 'new']]);
  assert.deepEqual([record.solved, record.tried, record.total, record.best], [0, 0, 3, undefined]);
  assert.equal(recordSummary(record), '0 of 3 tasks solved');
});

test('a task is solved once any submission passes every check, and keeps its fewest tokens', () => {
  const record = homeRecord(tasks, [result('library-fines', 5, 9, 900), result('library-fines', 9, 9, 2400), result('library-fines', 9, 9, 1840), result('library-fines', 8, 9, 300),
    result('delivery-fee', 3, 4, 500), result('retry-storm', 6, 6, 0)]);
  assert.deepEqual(record.cells, [{ taskId: 'library-fines', title: 'Library fines', state: 'solved', fewest: 1840 }, { taskId: 'delivery-fee', title: 'Delivery fee', state: 'tried' },
    { taskId: 'retry-storm', title: 'Retry storm', state: 'solved', fewest: 0 }]);
  assert.deepEqual([record.solved, record.tried, record.total], [2, 1, 3]);
  assert.deepEqual(record.best, { title: 'Retry storm', tokens: 0 });
  assert.equal(recordSummary(record), '2 of 3 tasks solved, 1 more tried');
  assert.deepEqual(record.cells.map(recordCellLabel), ['Library fines: solved with 1,840 tokens', 'Delivery fee: tried, not solved yet', 'Retry storm: solved without the agent']);
  assert.equal(recordCellLabel({ taskId: 'x', title: 'New one', state: 'new' }), 'New one: not started');
});

test('results for online tasks, lab work and tasks no longer listed do not appear in the record', () => {
  const record = homeRecord(tasks, [result('online-one', 4, 4, 100), result('retired-task', 2, 2, 50), result('lab-task', 1, 1, 10)]);
  assert.deepEqual([record.solved, record.tried, record.total, record.best], [0, 0, 3, undefined]);
});

test('the result card says what the submission cost, in one sentence', () => {
  assert.equal(reportCostSentence({ weighted: 1840, prompts: 3 }), 'You used 1,840 tokens in 3 prompts.');
  assert.equal(reportCostSentence({ weighted: 336.4, prompts: 1 }), 'You used 336 tokens in 1 prompt.');
  assert.equal(reportCostSentence({ weighted: 0, prompts: 0 }), 'You did not use the agent.');
  assert.equal(reportCostSentence({ weighted: 512, prompts: null }), 'You used 512 tokens.');
  // An older report with no recorded usage says nothing rather than guessing.
  assert.equal(reportCostSentence({ weighted: null, prompts: null }), '');
  assert.equal(reportCostSentence({ weighted: null, prompts: 2 }), '');
});

test('a task row says where your own work on it stands', async () => {
  const { taskStatus } = await import('../src/browser/home-record.ts');
  const attempt = (taskId: string, n: number, submissions: number, lab?: string) => ({ taskId, attempt: n, submissions, ...(lab ? { lab } : {}) });
  assert.deepEqual(taskStatus('library-fines', [], []), { kind: 'new', label: 'Not attempted yet' });
  // An open attempt wins over earlier results: that is where the work is.
  assert.deepEqual(taskStatus('library-fines', [attempt('library-fines', 1, 2), attempt('library-fines', 2, 0)], [result('library-fines', 9, 9, 1840)]), { kind: 'progress', label: 'Attempt 2 in progress' });
  assert.deepEqual(taskStatus('library-fines', [attempt('library-fines', 1, 2)], [result('library-fines', 5, 9, 300), result('library-fines', 9, 9, 2400), result('library-fines', 9, 9, 1840)]),
    { kind: 'solved', label: 'Solved with 1,840 tokens' });
  assert.deepEqual(taskStatus('retry-storm', [], [result('retry-storm', 6, 6, 0)]), { kind: 'solved', label: 'Solved without the agent' });
  assert.deepEqual(taskStatus('delivery-fee', [attempt('delivery-fee', 1, 2)], [result('delivery-fee', 1, 4, 100), result('delivery-fee', 3, 4, 900)]), { kind: 'tried', label: 'Best result: 3 of 4 checks' });
  // Lab attempts and other tasks' results say nothing about this practice task.
  assert.deepEqual(taskStatus('library-fines', [attempt('library-fines', 1, 0, 'lab-a'), attempt('delivery-fee', 1, 0)], [result('delivery-fee', 4, 4, 10)]), { kind: 'new', label: 'Not attempted yet' });
});

test('Home shows the three newest results and keeps the rest one click away', async () => {
  const { latestResults } = await import('../src/browser/home-record.ts');
  const rows = ['2026-11-25T10:00:00.000Z', '2026-11-28T09:00:00.000Z', '2026-11-26T10:00:00.000Z', '2026-11-27T10:00:00.000Z', '2026-11-28T08:00:00.000Z'].map((submittedAt, id) => ({ id, submittedAt }));
  const latest = latestResults(rows, false);
  assert.deepEqual([latest.shown.map(row => row.id), latest.hidden], [[1, 4, 3], 2]);
  const all = latestResults(rows, true);
  assert.deepEqual([all.shown.map(row => row.id), all.hidden], [[1, 4, 3, 2, 0], 0]);
  assert.deepEqual(latestResults(rows.slice(0, 2), false), { shown: [rows[1], rows[0]], hidden: 0 });
  assert.deepEqual(latestResults([], false), { shown: [], hidden: 0 });
});
