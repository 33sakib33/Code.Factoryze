import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLabel, continueAttempts, dateLabel, followsOutput, labAgentNotice, practiceAttempts, relativeTime, taskState, unifiedDiff, workspaceRelative, attemptLabel } from '../src/browser/flow-model.ts';
import type { AttemptSummary } from '@factoryze/protocol';

const attempt = (over: Partial<AttemptSummary>): AttemptSummary => ({ workspace: '/w/a', taskId: 'pagination-api', title: 'Pagination API', attempt: 1,
  startedAt: '2026-10-22T09:00:00.000Z', lastActivityAt: '2026-10-22T09:30:00.000Z', weighted: 0, budgetLimit: 20000, status: 'ready', submissions: 0, ...over });

test('hidden check names read as sentences', () => {
  assert.equal(checkLabel('test_each_page_includes_its_last_item'), 'Each page includes its last item');
  assert.equal(checkLabel('test_public.py'), 'test_public.py');
});

test('times read relative to now, then as dates', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  assert.equal(relativeTime('2026-10-22T11:59:40.000Z', now), 'just now');
  assert.equal(relativeTime('2026-10-22T11:55:00.000Z', now), '5 minutes ago');
  assert.equal(relativeTime('2026-10-22T11:59:00.000Z', now), '1 minute ago');
  assert.equal(relativeTime('2026-10-22T09:00:00.000Z', now), '3 hours ago');
  assert.match(relativeTime('2026-10-19T09:00:00.000Z', now), /^Oct 19$/);
  assert.match(dateLabel('2026-10-22T09:05:00.000Z', now), /^Today, \d\d:\d\d$/);
  assert.match(dateLabel('2026-10-21T09:05:00.000Z', now), /^Oct 21, \d\d:\d\d$/);
});

test('Continue shows the three most recently used attempts', () => {
  const list = [1, 2, 3, 4].map(n => attempt({ workspace: `/w/${n}`, attempt: n, lastActivityAt: `2026-10-22T0${n}:00:00.000Z` }));
  assert.deepEqual(continueAttempts(list).map(item => item.attempt), [4, 3, 2]);
});

test('Continue can reveal every older attempt, including unsubmitted retired work', () => {
  const list = [1, 2, 3, 4, 5].map(n => attempt({ workspace: `/w/${n}`, attempt: n,
    lastActivityAt: `2026-10-22T0${n}:00:00.000Z` }));
  assert.deepEqual(continueAttempts(list, 'all').map(item => item.attempt), [5, 4, 3, 2, 1]);
  assert.deepEqual(list.map(item => item.attempt), [1, 2, 3, 4, 5]);
});

test('each task shows its open attempt, then its best result, then that it has not been tried', () => {
  assert.equal(taskState('pagination-api', []), 'Not attempted yet');
  const submitted = attempt({ attempt: 1, submissions: 2, latest: { passed: 0, total: 1, submittedAt: '2026-10-22T09:30:00.000Z' } });
  const better = attempt({ workspace: '/w/b', attempt: 2, submissions: 1, latest: { passed: 1, total: 1, submittedAt: '2026-10-22T10:30:00.000Z' } });
  assert.equal(taskState('pagination-api', [submitted, better]), 'Best result: 1 of 1 checks');
  assert.equal(taskState('pagination-api', [submitted, better, attempt({ workspace: '/w/c', attempt: 3 })]), 'Attempt 3 in progress');
  assert.equal(taskState('dedupe-ids', [submitted]), 'Not attempted yet');
});

test('practice task rows and Start ignore lab attempts of the same task', () => {
  const labGraded = attempt({ workspace: '/labs/x', lab: 'cs201', submissions: 1, latest: { passed: 9, total: 9, submittedAt: '2026-10-22T09:30:00.000Z' } });
  const labOpen = attempt({ workspace: '/labs/y', lab: 'cs202' });
  assert.equal(taskState('pagination-api', [labGraded, labOpen]), 'Not attempted yet');
  const practice = attempt({ workspace: '/w/b', attempt: 2, submissions: 1, latest: { passed: 1, total: 3, submittedAt: '2026-10-22T10:30:00.000Z' } });
  assert.equal(taskState('pagination-api', [labGraded, practice, labOpen]), 'Best result: 1 of 3 checks');
  assert.deepEqual(practiceAttempts('pagination-api', [labGraded, practice, labOpen, attempt({ taskId: 'dedupe-ids' })]), [practice]);
});

test('attempt label names the task and attempt without punctuation tricks', () => {
  assert.equal(attemptLabel(attempt({ attempt: 2 })), 'Pagination API, attempt 2');
});

test('tool paths are shown relative to the attempt folder', () => {
  assert.equal(workspaceRelative('read /private/var/x/workspaces/pagination-api-1/app/pagination.py', '/private/var/x/workspaces/pagination-api-1'), 'read app/pagination.py');
  assert.equal(workspaceRelative('edit C:\\Users\\me\\task\\app\\a.py', 'C:\\Users\\me\\task'), 'edit app/a.py');
  assert.equal(workspaceRelative('python -m pytest -q', '/w'), 'python -m pytest -q');
});

test('unified diff keeps two lines of context around each change', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
  const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
  assert.deepEqual(unifiedDiff(before, after).map(line => `${line.kind}${line.number ?? ''} ${line.text}`), [
    ' 2 b', ' 3 c', '-4 d', '+4 D', ' 5 e', ' 6 f', ' 7 g', '+8 h',
  ]);
  assert.deepEqual(unifiedDiff('', 'x\ny').map(line => line.kind + line.text), ['+x', '+y']);
  assert.deepEqual(unifiedDiff('same', 'same'), []);
});

test('tool rows read as plain actions, in progress or done', async () => {
  const { toolLabel } = await import('../src/browser/flow-model.ts');
  assert.equal(toolLabel('read app/pagination.py', 'read', 'completed'), 'Read app/pagination.py');
  assert.equal(toolLabel('read app/pagination.py', 'read', 'in_progress'), 'Reading app/pagination.py');
  assert.equal(toolLabel('list .', 'search', 'completed'), 'Listed the files');
  assert.equal(toolLabel('grep app', 'search', 'completed'), 'Searched app');
  assert.equal(toolLabel('edit app/a.py', 'edit', 'completed'), 'Edited app/a.py');
  assert.equal(toolLabel('write app/new.py', 'edit', 'in_progress'), 'Writing app/new.py');
  assert.equal(toolLabel('python -m pytest -q', 'execute', 'completed'), 'Ran python -m pytest -q');
  assert.equal(toolLabel('python -m pytest -q', 'execute', 'failed'), 'Ran python -m pytest -q');
});

test('submission times read naturally in a sentence', async () => {
  const { submittedLabel } = await import('../src/browser/flow-model.ts');
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  assert.match(submittedLabel('2026-10-22T09:05:00.000Z', now), /^today at \d\d:\d\d$/);
  assert.match(submittedLabel('2026-10-19T09:05:00.000Z', now), /^on Oct 19 at \d\d:\d\d$/);
});

test('the agent log follows new output only while the reader is at the bottom', () => {
  assert.equal(followsOutput({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true);
  assert.equal(followsOutput({ scrollTop: 570, clientHeight: 400, scrollHeight: 1000 }), true);
  assert.equal(followsOutput({ scrollTop: 200, clientHeight: 400, scrollHeight: 1000 }), false);
  assert.equal(followsOutput({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 }), true);
});

test('an unavailable lab agent says why, and that work can continue', () => {
  const status = { state: 'open', offline: false, inference: true } as const;
  assert.deepEqual(labAgentNotice({ ...status, inference: false }), { title: 'The agent is off for this lab',
    text: 'Your instructor has not turned on the agent for this lab. You can still edit, run tests and submit.' });
  assert.deepEqual(labAgentNotice({ ...status, state: 'closed' }), { title: 'This lab is closed',
    text: 'The agent and new submissions are no longer available. Your saved submissions are kept.' });
  assert.deepEqual(labAgentNotice({ ...status, offline: true }), { title: "Can't reach the lab server",
    text: 'You can keep editing locally. Reconnect before using the agent or submitting.' });
  assert.deepEqual(labAgentNotice(null), { title: 'Lab agent unavailable', text: 'Check the lab connection with your instructor. Your local files are kept.' });
});
