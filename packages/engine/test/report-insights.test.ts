import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { FactoryzeEvent } from '@factoryze/protocol';
import { summarizeReportActivity } from '../src/report-insights.ts';
import { SoloEngine } from '../src/solo.ts';
import { UsageStore } from '../src/usage-store.ts';

let sequence = 0;
const event = (type: string, data: Record<string, unknown>, sessionId = 'session'): FactoryzeEvent =>
  ({ id: String(++sequence), sessionId, type, at: '2026-10-24T00:00:00.000Z', data });
const tool = (id: string, kind: string, status = 'in_progress', sessionId = 'session') =>
  event('acp_update@1', { sessionUpdate: status === 'in_progress' ? 'tool_call' : 'tool_call_update', toolCallId: id, kind, status }, sessionId);

test('report activity deduplicates updates and groups measured requests by preceding tools without inventing context costs', () => {
  const events = [event('prompt_started@1', { promptId: 'p1' }), event('model_request_started@1', { requestId: 'r1' }),
    tool('read', 'read'), tool('read', 'read'), tool('read', 'read', 'completed'), tool('read', 'read', 'completed'),
    tool('grep', 'search'), tool('grep', 'search', 'completed'), event('model_request_started@1', { requestId: 'r2' }),
    tool('edit', 'edit'), event('permission_decision@1', { toolCallId: 'edit', outcome: 'allow_once', approved: true }),
    tool('edit', 'edit', 'completed'), event('model_request_started@1', { requestId: 'r3' }),
    tool('shell', 'execute'), event('permission_decision@1', { toolCallId: 'shell', outcome: 'reject_once', approved: false }),
    tool('shell', 'execute', 'failed'), event('model_request_started@1', { requestId: 'r4' }),
    tool('read', 'read'), tool('read', 'read', 'completed'), tool('shell2', 'execute'), tool('shell2', 'execute', 'completed'),
    event('model_request_started@1', { requestId: 'r5' }), event('prompt_ended@1', { promptId: 'p1', reason: 'end_turn' })];
  const requests = [10, 20, 30, 40, 50].map((weighted, index) => ({ id: `r${index + 1}`, weighted, incomplete: false }));
  const result = summarizeReportActivity(events, requests, [{ promptId: 'p1', index: 1, weighted: 150, state: 'complete' }]);
  assert.equal(result.coverage, 'recorded');
  assert.deepEqual(result.tools, { exploration: 3, editing: 1, commands: 2, failed: 1, unfinished: 0 });
  assert.deepEqual(result.approvals, { approved: 1, declined: 1, cancelled: 0 });
  assert.deepEqual(result.attribution.map(bucket => [bucket.kind, bucket.weighted]),
    [['prompt', 10], ['exploration', 20], ['editing', 30], ['commands', 40], ['mixed', 50], ['unattributed', 0]]);
  assert.equal(result.attribution.reduce((sum, bucket) => sum + bucket.requests, 0), 5);
  assert.equal(JSON.stringify(result).includes('context'), false);
});

test('legacy, incomplete and unknown activity keeps all observed usage and discloses missing history', () => {
  const request = { id: 'legacy', weighted: 12.5, incomplete: true };
  const legacy = summarizeReportActivity([], [request], []);
  assert.equal(legacy.coverage, 'unavailable');
  assert.equal(legacy.incompleteRequests, 1);
  assert.deepEqual(legacy.attribution.at(-1), { kind: 'unattributed', requests: 1, weighted: 12.5 });
  const partial = summarizeReportActivity([event('prompt_started@1', { promptId: 'p' }),
    event('model_request_started@1', { requestId: 'current' }), tool('open', 'read'),
    event('permission_decision@1', { toolCallId: 'open', outcome: 'cancelled' }),
    event('future_type@2', { secret: 'private content' })],
    [request, { id: 'current', weighted: 2.1, incomplete: false }], []);
  assert.equal(partial.coverage, 'partial');
  assert.equal(partial.tools.unfinished, 1);
  assert.equal(partial.approvals.cancelled, 1);
  assert.equal(partial.attribution.reduce((sum, bucket) => sum + bucket.weighted, 0), 14.6);
  assert.equal(JSON.stringify(partial).includes('private content'), false);
});

test('request attribution resets between prompts and sessions, including reused tool IDs', () => {
  const result = summarizeReportActivity([event('prompt_started@1', { promptId: 'p1' }), tool('same', 'read'), tool('same', 'read', 'completed'),
    event('prompt_ended@1', { promptId: 'p1', reason: 'cancelled' }),
    event('prompt_started@1', { promptId: 'p2' }), event('model_request_started@1', { requestId: 'r1' }),
    event('prompt_started@1', { promptId: 'p3' }, 'other'), tool('same', 'edit', 'in_progress', 'other'),
    tool('same', 'edit', 'completed', 'other'), event('model_request_started@1', { requestId: 'r2' }, 'other')],
    [{ id: 'r1', weighted: 10, incomplete: false }, { id: 'r2', weighted: 20, incomplete: false }], []);
  assert.equal(result.tools.exploration, 1);
  assert.equal(result.tools.editing, 1);
  assert.equal(result.attribution.find(bucket => bucket.kind === 'prompt')!.weighted, 10);
  assert.equal(result.attribution.find(bucket => bucket.kind === 'editing')!.weighted, 20);
});

test('missing prompt history stays unavailable and duplicate request starts preserve the next activity group', () => {
  const request = { id: 'r1', weighted: 10, incomplete: false };
  assert.equal(summarizeReportActivity([event('model_request_started@1', { requestId: 'r1' })], [request], []).coverage, 'unavailable');
  const result = summarizeReportActivity([event('prompt_started@1', { promptId: 'p' }),
    event('model_request_started@1', { requestId: 'r1' }), tool('read', 'read'), tool('read', 'read', 'completed'),
    event('model_request_started@1', { requestId: 'r1' }), event('model_request_started@1', { requestId: 'r2' })],
    [request, { id: 'r2', weighted: 20, incomplete: false }], []);
  assert.equal(result.attribution.find(bucket => bucket.kind === 'exploration')!.weighted, 20);
});

test('activity attribution uses recorded cache weights and reconciled ledger usage instead of stale event counts', () => {
  const store = new UsageStore(':memory:');
  try {
    const scope = { userId: 'synthetic', taskId: 'synthetic', profile: 'factoryze@0.1.0', model: 'synthetic' };
    const account = store.account(scope, { limit: 1000, weights: { input: 2, output: 3, cacheRead: 0.2, cacheWrite: 1.5 } });
    store.registerWorkspace('/synthetic', scope.userId, scope.taskId);
    store.appendEvent('/synthetic', account, 's', 'prompt_started@1', { promptId: 'p' });
    const requestId = store.begin(account, '/synthetic');
    store.appendEvent('/synthetic', account, 's', 'model_request_started@1', { requestId });
    const usage = { input: 100, output: 10, cacheRead: 60, cacheWrite: 5 };
    store.finish(requestId, usage, false);
    store.appendEvent('/synthetic', account, 's', 'model_request_ended@1', { requestId, usage });
    store.appendEvent('/synthetic', account, 's', 'prompt_ended@1', { promptId: 'p', reason: 'cancelled' });
    const before = store.reportInsights('/synthetic', scope.userId);
    assert.equal(before.attribution[0]!.weighted, 119.5); assert.equal(before.incompleteRequests, 1);
    store.reconcile('/synthetic', scope.userId, { requestId, usage: { ...usage, output: 20 }, reference: 'synthetic provider record', confirmed: true });
    const after = store.reportInsights('/synthetic', scope.userId);
    assert.equal(after.attribution[0]!.weighted, 149.5); assert.equal(after.incompleteRequests, 0);
    assert.equal(after.prompts[0]!.weighted, 149.5);
    assert.equal(before.attribution[0]!.weighted, 119.5);
    assert.throws(() => store.reportInsights('/synthetic', 'another-user'), /practice task/i);
  } finally { store.close(); }
});

test('saved report insights and prompt costs survive later prompts, resubmission and restart without prompt text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-report-insights-'));
  const upstream = createServer(async (request, response) => {
    for await (const _ of request) { /* Drain synthetic request. */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"usage":{"prompt_tokens":10,"completion_tokens":4}}');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const settings = { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-key', api: 'openai-chat' as const },
    model: 'synthetic', contextWindow: 8192, maxOutputTokens: 256,
    budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } };
  const options = { dataDir: join(root, 'data'), userId: 'synthetic', settings,
    preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }) };
  let engine = new SoloEngine(options);
  const packs = join(process.cwd(), 'tasks/practice');
  try {
    const { workspace } = await engine.startTask(packs, 'library-fines', join(root, 'attempts'));
    const session = await engine.openGateway(workspace);
    const send = async () => {
      const prompt = await session.assessPrompt('synthetic private prompt');
      const response = await fetch(`${session.connection.baseURL}/chat/completions`, { method: 'POST',
        headers: { authorization: `Bearer ${session.connection.sessionToken}` }, body: '{"model":"synthetic"}' });
      await response.text();
      session.recordAgentEvent('acp_update@1', { sessionUpdate: 'tool_call', toolCallId: prompt.promptId, kind: 'read', status: 'in_progress' });
      session.recordAgentEvent('acp_update@1', { sessionUpdate: 'tool_call_update', toolCallId: prompt.promptId, kind: 'read', status: 'completed' });
      session.completePrompt(prompt.promptId, 'end_turn');
    };
    await send();
    const first = await engine.submitTask(packs, workspace);
    assert.equal(first.insights!.prompts.length, 1);
    assert.equal(first.insights!.prompts[0]!.weighted, 14);
    assert.equal(first.insights!.tools.exploration, 1);
    await send(); await session.close();
    const second = await engine.submitTask(packs, workspace);
    assert.equal(second.insights!.prompts.length, 2);
    assert.equal(second.insights!.attribution.reduce((sum, bucket) => sum + bucket.weighted, 0), second.workspaceUsage![0]!.weighted);
    assert.deepEqual(await engine.report(workspace, 1), first);
    assert.equal(JSON.stringify(first).includes('synthetic private prompt'), false);
    assert.equal(JSON.stringify(first).includes('synthetic-key'), false);
    await engine.close(); engine = new SoloEngine(options);
    assert.deepEqual(await engine.report(workspace, 1), first);
    assert.deepEqual(await engine.latestReport(workspace), second);
  } finally {
    await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
