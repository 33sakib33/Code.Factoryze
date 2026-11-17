import assert from 'node:assert/strict';
import test from 'node:test';
import { eventSchema, labConfigSchema, taskPackSchema, practiceReportSchema, modelSettingsSchema } from '../src/index.ts';

test('report insights are optional for old submissions and enforce bounded count structure', async () => {
  const { reportInsightsSchema, reportActivityKinds } = await import('../src/index.ts');
  const old = { schema: 1, kind: 'practice', taskId: 'old-task', submittedAt: '2026-10-24T00:00:00.000Z', correctness: { passed: 1, total: 1 }, usage: [] };
  assert.equal(practiceReportSchema.parse(old).insights, undefined);
  const insights = { schema: 1, coverage: 'recorded', prompts: [], tools: { exploration: 0, editing: 0, commands: 0, failed: 0, unfinished: 0 },
    approvals: { approved: 0, declined: 0, cancelled: 0 }, incompleteRequests: 0,
    attribution: reportActivityKinds.map(kind => ({ kind, requests: 0, weighted: 0 })) };
  assert.equal(practiceReportSchema.safeParse({ ...old, insights }).success, true);
  assert.equal(reportInsightsSchema.safeParse({ ...insights, tools: { ...insights.tools, failed: 1 } }).success, false);
  assert.equal(reportInsightsSchema.safeParse({ ...insights, incompleteRequests: 1 }).success, false);
  assert.equal(reportInsightsSchema.safeParse({ ...insights, attribution: Array(6).fill(insights.attribution[0]) }).success, false);
});

test('Python check diagnostics are optional and bounded, preserving existing clients', async () => {
  const { pythonCheckSchema } = await import('../src/index.ts');
  const legacy = { ok: false, minimum: '3.11' };
  assert.deepEqual(pythonCheckSchema.parse(legacy), legacy);
  assert.equal(pythonCheckSchema.parse({ ...legacy, message: 'Install the matching venv package.' }).message, 'Install the matching venv package.');
  assert.equal(pythonCheckSchema.safeParse({ ...legacy, message: 'x'.repeat(1001) }).success, false);
});

test('report execution pins are optional for old reports and validate metadata without credentials', () => {
  const old = { schema: 1, kind: 'practice', taskId: 'old-task', submittedAt: '2026-10-22T10:00:00.000Z', correctness: { passed: 1, total: 1 }, usage: [] };
  assert.deepEqual(practiceReportSchema.parse(old), old);
  const pin = { profile: 'factoryze@0.1.0', model: 'synthetic', providerHost: 'provider.invalid', temperature: null, os: 'darwin' };
  assert.deepEqual(practiceReportSchema.parse({ ...old, executionPins: [pin] }).executionPins, [pin]);
  for (const bad of [{ ...pin, providerHost: 'https://secret@provider.invalid/v1' }, { ...pin, apiKey: 'secret' }, { ...pin, temperature: -1 }]) {
    assert.equal(practiceReportSchema.safeParse({ ...old, executionPins: [bad] }).success, false);
  }
});

test('connection temperature is optional, finite and bounded without changing old defaults', () => {
  const settings = { schema: 1, api: 'openai-chat', baseURL: 'https://provider.invalid/v1', model: 'synthetic', contextWindow: 8192, maxOutputTokens: 256 };
  assert.deepEqual(modelSettingsSchema.parse(settings), settings);
  assert.equal(modelSettingsSchema.parse({ ...settings, temperature: 0 }).temperature, 0);
  for (const temperature of [-1, 2.1, NaN, Infinity, '0', null]) assert.equal(modelSettingsSchema.safeParse({ ...settings, temperature }).success, false);
});

test('task packs require schema 1 and a valid Python minimum', () => {
  const pack = { schema: 1, id: 'pagination-api', title: 'Pagination API', brief: 'Fix the last page.', minimumPython: '3.12' };
  assert.deepEqual(taskPackSchema.parse(pack), pack);
  assert.equal(taskPackSchema.safeParse({ ...pack, schema: 2 }).success, false);
  assert.equal(taskPackSchema.safeParse({ ...pack, minimumPython: 'python3' }).success, false);
});

test('task retirement is optional and preserves existing schema 1 manifests', () => {
  const pack = { schema: 1, id: 'old-task', title: 'Old task', brief: 'Keep existing attempts.', minimumPython: '3.11' };
  assert.deepEqual(taskPackSchema.parse(pack), pack);
  assert.deepEqual(taskPackSchema.parse({ ...pack, retired: true }), { ...pack, retired: true });
  assert.deepEqual(taskPackSchema.parse({ ...pack, retired: false }), { ...pack, retired: false });
  assert.equal(taskPackSchema.safeParse({ ...pack, retired: 'true' }).success, false);
});

test('task recommended knowledge is bounded and optional', () => {
  const pack = { schema: 1, id: 'retry-storm', title: 'Stop a retry storm', brief: 'Fix retries.', minimumPython: '3.11' };
  assert.deepEqual(taskPackSchema.parse(pack), pack);
  assert.deepEqual(taskPackSchema.parse({ ...pack, recommendedKnowledge: ['HTTP status codes', 'Retry backoff'] }).recommendedKnowledge,
    ['HTTP status codes', 'Retry backoff']);
  for (const recommendedKnowledge of [[], [' '], [' x'], ['x'.repeat(101)], Array(6).fill('HTTP status codes'), ['HTTP status codes', 'HTTP status codes']])
    assert.equal(taskPackSchema.safeParse({ ...pack, recommendedKnowledge }).success, false);
});

test('task subject tags are bounded and stay separate from the Python evaluator', () => {
  const pack = { schema: 1, id: 'retry-storm', title: 'Stop a retry storm', brief: 'Fix retries.', minimumPython: '3.11' };
  assert.deepEqual(taskPackSchema.parse({ ...pack, topics: ['sre', 'reliability'] }).topics, ['sre', 'reliability']);
  for (const topics of [[], ['a'], ['SRE'], ['two words'], ['sre', 'sre'], Array(6).fill('topic'), ['x'.repeat(41)]])
    assert.equal(taskPackSchema.safeParse({ ...pack, topics }).success, false);
});

test('lab config pins an agent profile and keeps keys out of the contract', () => {
  const config = {
    schema: 1, lab: 'cs201-lab4', task: 'tasks/pagination-api', timeLimitMinutes: 90,
    agent: { profile: 'opencode@1.2.0', model: 'anthropic/example', permissions: { edit: 'ask', shell: 'ask' } },
    budget: { limit: 60000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } }
  };
  assert.deepEqual(labConfigSchema.parse(config), config);
  assert.equal(labConfigSchema.safeParse({ ...config, apiKey: 'secret' }).success, false);
  assert.equal(labConfigSchema.safeParse({ ...config, agent: { ...config.agent, profile: 'opencode' } }).success, false);
});

test('events are versioned and readers can retain unknown event types', () => {
  const event = { id: 'event-1', sessionId: 'session-1', type: 'future_event@2', at: '2026-10-20T00:00:00.000Z', data: { value: true } };
  assert.deepEqual(eventSchema.parse(event), event);
  assert.equal(eventSchema.safeParse({ ...event, type: 'future_event' }).success, false);
});

test('attempt and report summaries carry only counts, never prompts or keys', async () => {
  const { attemptSummarySchema, reportSummarySchema, promptUsageSchema, practiceReportSchema } = await import('../src/index.ts');
  const attempt = { workspace: '/w/pagination-api-1', taskId: 'pagination-api', title: 'Pagination API', attempt: 2,
    startedAt: '2026-10-22T10:00:00.000Z', lastActivityAt: '2026-10-22T10:12:00.000Z',
    weighted: 7800, budgetLimit: 20000, status: 'ready', submissions: 1, latest: { passed: 1, total: 1, submittedAt: '2026-10-22T10:20:00.000Z' } };
  assert.deepEqual(attemptSummarySchema.parse(attempt), attempt);
  assert.equal(attemptSummarySchema.safeParse({ ...attempt, apiKey: 'x' }).success, false);
  assert.deepEqual(attemptSummarySchema.parse({ ...attempt, lab: 'cs201' }), { ...attempt, lab: 'cs201' });
  assert.equal(attemptSummarySchema.safeParse({ ...attempt, lab: 'CS 201' }).success, false);
  const summary = { workspace: attempt.workspace, taskId: attempt.taskId, title: attempt.title, attempt: 2, submission: 1, submissions: 1,
    submittedAt: '2026-10-22T10:20:00.000Z', passed: 1, total: 1, weighted: 7800, score: null };
  assert.deepEqual(reportSummarySchema.parse(summary), summary);
  assert.deepEqual(promptUsageSchema.parse({ promptId: 'p1', index: 1, weighted: 3180, state: 'complete' }), { promptId: 'p1', index: 1, weighted: 3180, state: 'complete' });
  assert.equal(promptUsageSchema.safeParse({ promptId: 'p1', index: 1, weighted: 1, state: 'complete', text: 'secret prompt' }).success, false);
  const report = { schema: 1, kind: 'practice', taskId: 'pagination-api', submittedAt: '2026-10-22T10:20:00.000Z',
    correctness: { passed: 0, total: 1 }, usage: [],
    checks: [{ name: 'test_each_page_includes_its_last_item', passed: false, message: 'AssertionError' }],
    budget: { limit: 30000, initialLimit: 20000 } };
  assert.deepEqual(practiceReportSchema.parse(report), report);
});

test('a task entryFile may sit at the workspace root or in a folder, never outside it', async () => {
  const { taskPackSchema } = await import('../src/index.ts');
  const pack = { schema: 1, id: 'invoice-cents-example', title: 'Invoice cents', brief: 'Fix the cents.', minimumPython: '3.11' };
  for (const entryFile of ['invoices.py', 'billing/invoices.py', 'app/v2/main.py']) assert.equal(taskPackSchema.safeParse({ ...pack, entryFile }).success, true, entryFile);
  for (const entryFile of ['../invoices.py', 'app/../../x.py', '/etc/passwd', '.hidden.py', 'app\\main.py', '']) assert.equal(taskPackSchema.safeParse({ ...pack, entryFile }).success, false, entryFile);
});
