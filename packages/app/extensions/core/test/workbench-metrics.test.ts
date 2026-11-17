import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchMetrics } from '../src/browser/workbench-metrics.ts';
import type { UsageTotals } from '@factoryze/protocol';

const totals = (weighted: number): UsageTotals => ({
  scope: { userId: 'test-user', taskId: 'task-a', profile: 'opencode@1.18.29', model: 'test' },
  raw: { input: weighted, output: 0, cacheRead: 0, cacheWrite: 0 },
  weighted, budgetLimit: 100, remaining: Math.max(0, 100 - weighted),
  requests: 1, incompleteRequests: 0, status: 'ready',
});

test('each prompt gets a block proportional to its weighted token use', () => {
  const metrics = new WorkbenchMetrics();
  metrics.onUsage(totals(0));
  metrics.beginPrompt();
  metrics.onUsage(totals(12));
  metrics.onUsage(totals(30));
  metrics.endPrompt();
  metrics.beginPrompt();
  metrics.onUsage(totals(50));
  metrics.endPrompt();
  assert.deepEqual(metrics.snapshot().segments.map(segment => segment.tokens), [30, 20]);
  assert.equal(metrics.snapshot().remaining, 50);
});

test('saved usage is shown as earlier usage and a new scope resets the blocks', () => {
  const metrics = new WorkbenchMetrics();
  metrics.onUsage(totals(40));
  metrics.beginPrompt();
  metrics.onUsage(totals(45));
  assert.deepEqual(metrics.snapshot().segments.map(segment => [segment.label, segment.tokens]),
    [['Earlier usage', 40], ['Prompt 1', 5]]);
  metrics.onUsage({ ...totals(7), scope: { ...totals(7).scope, taskId: 'task-b' } });
  assert.deepEqual(metrics.snapshot().segments.map(segment => segment.tokens), [7]);
});

test('timer tracks elapsed practice time without treating the task estimate as a deadline', () => {
  const metrics = new WorkbenchMetrics();
  metrics.startTask('/workspace/a', 10_000, 'Pagination API');
  assert.equal(metrics.elapsed(71_000), '01:01');
  assert.equal(metrics.snapshot().taskTitle, 'Pagination API');
});

test('Home hides the elapsed display without resetting the task clock or metered totals', () => {
  const metrics = new WorkbenchMetrics();
  metrics.selectWorkspace('/practice', 1000);
  metrics.setHome(true);
  assert.equal(metrics.elapsed(61_000), '—');
  assert.equal(metrics.snapshot().startedAt, 1000);
  assert.equal(metrics.snapshot().home, true);
  metrics.setHome(false);
  assert.equal(metrics.elapsed(61_000), '01:00');
});

test('task source budget is visible before the first model call', () => {
  const metrics = new WorkbenchMetrics(); metrics.selectWorkspace('/assessment'); metrics.setTaskBudget(42);
  assert.equal(metrics.snapshot().budgetLimit, 42); assert.equal(metrics.snapshot().remaining, 42);
});

test('restoring the timer after loading task metadata retains its source budget and title', () => {
  const metrics = new WorkbenchMetrics(); metrics.startTask('/assessment', 1000, 'Assessment', 42);
  metrics.selectWorkspace('/assessment', 1000);
  assert.equal(metrics.snapshot().budgetLimit, 42); assert.equal(metrics.snapshot().taskTitle, 'Assessment');
});

test('input, output and cached tokens remain separate from the weighted budget, including after workspace changes', () => {
  const metrics = new WorkbenchMetrics(); metrics.selectWorkspace('/practice');
  metrics.onUsage({ ...totals(175), raw: { input: 1000, output: 75, cacheRead: 1000, cacheWrite: 0 } });
  assert.deepEqual(metrics.snapshot().raw, { input: 1000, output: 75, cacheRead: 1000, cacheWrite: 0 });
  assert.equal(metrics.snapshot().weighted, 175);
  const snapshot = metrics.snapshot(); snapshot.raw.input = 0;
  assert.equal(metrics.snapshot().raw.input, 1000, 'The presentation snapshot must not mutate engine totals');
  metrics.selectWorkspace('/other');
  assert.deepEqual(metrics.snapshot().raw, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('late usage from the previous task run cannot repopulate fresh input/output meters', () => {
  const metrics = new WorkbenchMetrics(); metrics.selectWorkspace('/run/a');
  metrics.onUsage({ ...totals(40), workspace: '/run/a', raw: { input: 30, output: 10, cacheRead: 0, cacheWrite: 0 } });
  metrics.selectWorkspace('/run/b'); metrics.setTaskBudget(100);
  metrics.onUsage({ ...totals(45), workspace: '/run/a', raw: { input: 32, output: 13, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual(metrics.snapshot().raw, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(metrics.snapshot().weighted, 0); assert.equal(metrics.snapshot().remaining, 100);
  metrics.onUsage({ ...totals(5), workspace: '/run/b', raw: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual(metrics.snapshot().raw, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 });
});

test('an older workspace metadata response cannot lower the latest metered counts', () => {
  const metrics = new WorkbenchMetrics(); metrics.selectWorkspace('/run/a');
  metrics.onUsage({ ...totals(45), workspace: '/run/a' });
  metrics.onUsage({ ...totals(40), workspace: '/run/a' });
  assert.equal(metrics.snapshot().weighted, 45);
});

test('reopening an attempt rebuilds one segment per saved prompt, then keeps counting live', () => {
  const metrics = new WorkbenchMetrics();
  metrics.selectWorkspace('/w/a');
  metrics.onUsage({ ...totals(70), workspace: '/w/a' });
  metrics.seedPrompts('/w/a', [
    { promptId: 'p1', index: 1, weighted: 30, state: 'complete' },
    { promptId: 'p2', index: 2, weighted: 35, state: 'stopped' },
  ]);
  assert.deepEqual(metrics.snapshot().segments.map(segment => [segment.label, segment.tokens]),
    [['Other usage', 5], ['Prompt 1', 30], ['Prompt 2', 35]]);
  metrics.beginPrompt();
  metrics.onUsage({ ...totals(80), workspace: '/w/a' });
  assert.deepEqual(metrics.snapshot().segments.at(-1), { label: 'Prompt 3', tokens: 10, active: true });
  metrics.seedPrompts('/w/other', [{ promptId: 'x', index: 1, weighted: 1, state: 'complete' }]);
  assert.equal(metrics.snapshot().segments.length, 4, 'A late response for another attempt is ignored');
});
