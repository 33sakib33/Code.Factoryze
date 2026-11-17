import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeTask } from '../src/common/task-service.ts';
import { browseTasks, topicFacets } from '../src/browser/task-browser.ts';

const task = (id: string, topics?: string[], brief = 'Investigate the failure.'): PracticeTask =>
  ({ schema: 1, id, title: id.replaceAll('-', ' '), brief, minimumPython: '3.11', topics });

test('topic browsing searches metadata and keeps each page bounded', () => {
  const tasks = [task('retry-storm', ['sre', 'reliability']), task('webhook-guard', ['security']),
    task('linux-parser', ['linux', 'sre']), task('invoice-cents', undefined, 'Fix a billing total.')];
  assert.deepEqual(topicFacets(tasks).map(item => [item.id, item.count]),
    [['sre', 2], ['linux', 1], ['reliability', 1], ['security', 1], ['__untagged', 1]]);
  assert.deepEqual(browseTasks(tasks, { topic: 'sre', query: '', page: 0, pageSize: 1 }).items.map(item => item.id), ['retry-storm']);
  assert.deepEqual(browseTasks(tasks, { topic: 'sre', query: '', page: 1, pageSize: 1 }).items.map(item => item.id), ['linux-parser']);
  assert.deepEqual(browseTasks(tasks, { topic: '', query: 'BILLING', page: 0, pageSize: 20 }).items.map(item => item.id), ['invoice-cents']);
  assert.deepEqual(browseTasks(tasks, { topic: '__untagged', query: '', page: 0, pageSize: 20 }).items.map(item => item.id), ['invoice-cents']);
  const many = Array.from({ length: 10_000 }, (_, index) => task(`task-${index}`, ['sre']));
  const last = browseTasks(many, { topic: 'sre', query: '', page: 499, pageSize: 20 });
  assert.equal(last.total, 10_000);
  assert.equal(last.items.length, 20);
  assert.equal(last.items[0].id, 'task-9980');
  assert.equal(browseTasks(many, { topic: 'sre', query: '', page: 5000, pageSize: 20 }).page, 499);
});
