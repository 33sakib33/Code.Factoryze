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
