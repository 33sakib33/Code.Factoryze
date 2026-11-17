import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { UsageStore } from '../src/usage-store.ts';
import { scorePractice } from '../src/scoring.ts';
import { judgePrompt } from '../src/judge.ts';

const scope = { userId: 'student', taskId: 'task', profile: 'opencode@1.18.29', model: 'synthetic' };
const budget = { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } };
const raw = { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 };

test('schema 5 upgrades to append-only scoped events and auditable usage reconciliation', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-phase1-'));
  const file = join(root, 'usage.sqlite');
  let store = new UsageStore(file);
  try {
    const account = store.account(scope, budget);
    store.registerWorkspace('/workspace', scope.userId, scope.taskId);
    const request = store.begin(account, '/workspace');
    store.checkpoint(request, raw); store.finish(request, raw, false);
    store.close();
    const previous = new DatabaseSync(file);
    previous.exec('DROP INDEX practice_workspaces_attempt; ALTER TABLE practice_workspaces DROP COLUMN attempt_id; DROP TABLE task_budget_overrides; ALTER TABLE practice_workspaces DROP COLUMN pack_root; ALTER TABLE practice_workspaces DROP COLUMN task_json; DROP TABLE practice_events; ALTER TABLE model_requests DROP COLUMN owner_pid; PRAGMA user_version=5;');
    previous.close(); store = new UsageStore(file);
    assert.equal(store.unresolved('/workspace', scope.userId).length, 1);
    assert.throws(() => store.reconcile('/workspace', 'another-user', { requestId: request, usage: raw, reference: 'provider record', confirmed: true }), /practice task/);
    assert.throws(() => store.reconcile('/workspace', scope.userId, { requestId: request, usage: { ...raw, output: 1 }, reference: 'provider record', confirmed: true }), /observed/);
    store.reconcile('/workspace', scope.userId, { requestId: request, usage: { ...raw, output: 6 }, reference: 'provider request synthetic-1', confirmed: true });
    assert.equal(store.totals(account).weighted, 16);
    assert.equal(store.totals(account).status, 'ready');
    assert.equal(store.events('/workspace', scope.userId)[0].type, 'usage_reconciled@1');
    store.appendEvent('/workspace', account, 'session', 'permission_decision@1', { promptId: 'p1', approved: false });
    store.close(); store = new UsageStore(file);
    assert.equal(store.events('/workspace', scope.userId).length, 2);
    assert.equal(store.unresolved('/workspace', scope.userId).length, 0);
    assert.throws(() => store.reconcile('/workspace', scope.userId, { requestId: request, usage: raw, reference: 'again', confirmed: true }), /already/);
    const db = new DatabaseSync(file);
    assert.throws(() => db.exec('DELETE FROM practice_events'), /append.only/);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 8);
    db.close();
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('scoring v1 is deterministic, gates incorrect work, and never invents missing judge/baseline scores', () => {
  const comparisons = [{ profile: scope.profile, model: scope.model, baselinePromptsHash: '0'.repeat(64), weightedTokensRatio: 2, promptTurnsRatio: 2 }];
  const prompts = [{ promptId: 'p1', status: 'scored' as const, model: 'judge', verdict: { category: 'specific' as const, specificity: 100, reason: 'Names the function and expected behavior' }, acceptedEdit: true },
    { promptId: 'p2', status: 'scored' as const, model: 'judge', verdict: { category: 'vague' as const, specificity: 40, reason: 'No concrete change' }, acceptedEdit: false }];
  const score = scorePractice({ passed: 1, total: 1 }, comparisons, prompts);
  assert.equal(score.scoring_version, 1);
  assert.equal(score.correctness, 100);
  assert.equal(score.efficiency, 50);
  assert.equal(score.specificity, 80);
  assert.equal(score.total, 84.7);
  assert.deepEqual(scorePractice({ passed: 1, total: 1 }, comparisons, prompts), score);
  assert.equal(scorePractice({ passed: 0, total: 1 }, comparisons, prompts).total, 0);
  assert.equal(scorePractice({ passed: 1, total: 1 }, [], []).total, null);
  assert.equal(scorePractice({ passed: 1, total: 1 }, [], []).specificity, null);
});

test('judge treats prompts as data, validates structured provider output, and returns separate usage', async () => {
  const upstream = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-secret');
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    assert.equal(body.model, 'small-judge');
    assert.match(JSON.stringify(body.messages), /untrusted/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'judge-1', object: 'chat.completion', created: 1, model: 'small-judge',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ category: 'specific', specificity: 90, reason: 'Concrete file and expected result' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4 } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  try {
    const result = await judgePrompt({ baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-secret', api: 'openai-chat' }, 'small-judge', 'Fix pagination.py boundary; keep page numbering.');
    assert.equal(result.verdict.specificity, 90);
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});

test('session judge usage stays outside the student budget and report assessments survive restart', async () => {
  const { SoloEngine } = await import('../src/solo.ts');
  const root = mkdtempSync(join(tmpdir(), 'factoryze-assess-'));
  const options = { dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }),
    judge: async () => ({ verdict: { category: 'specific' as const, specificity: 90, reason: 'Specific change' }, usage: { inputTokens: 99, outputTokens: 5 } }),
    settings: { provider: { baseURL: 'https://provider.invalid/v1', apiKey: 'synthetic-key', api: 'openai-chat' as const }, model: 'synthetic',
      contextWindow: 8192, maxOutputTokens: 2048, budget, modules: { judge: true, scoring: true }, judgeModel: 'small-judge' } };
  let engine = new SoloEngine(options);
  try {
    const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
    const session = await engine.openGateway(workspace);
    const assessment = await session.assessPrompt('Change dedupe to preserve first occurrence.');
    assert.equal(assessment.verdict?.specificity, 90);
    session.recordAgentEvent('permission_decision@1', { toolCallId: 'edit1', kind: 'edit', approved: true });
    session.recordAgentEvent('acp_update@1', { toolCallId: 'edit1', kind: 'edit', status: 'completed' });
    session.completePrompt(assessment.promptId, 'end_turn');
    assert.equal(session.totals().weighted, 0);
    const report = await engine.submitTask(join(process.cwd(), 'tasks/practice'), workspace);
    assert.equal(report.promptAssessments?.[0]?.acceptedEdit, true);
    assert.equal(report.scoring?.specificity, 90);
    assert.equal(report.scoring?.total, null);
    await engine.close(); engine = new SoloEngine(options);
    assert.deepEqual((await engine.latestReport(workspace))?.scoring, report.scoring);
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('judge is disabled by default, failures do not block prompts, and stopping aborts pending judgement', async () => {
  const { SoloEngine } = await import('../src/solo.ts');
  const root = mkdtempSync(join(tmpdir(), 'factoryze-judge-lifecycle-'));
  let calls = 0;
  let notify!: () => void;
  const entered = new Promise<void>(resolve => { notify = resolve; });
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {},
    judge: async (_provider, _model, _text, signal) => {
      calls++; if (calls === 1) throw new Error('Synthetic unavailable provider');
      notify(); await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      throw new Error('Unreachable');
    } });
  const settings = { provider: { baseURL: 'https://provider.invalid/v1', apiKey: 'synthetic', api: 'openai-chat' as const }, model: 'test',
    contextWindow: 8192, maxOutputTokens: 2048, budget };
  try {
    const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
    let session = await engine.openGateway(workspace, undefined, settings);
    assert.equal((await session.assessPrompt('Specific prompt')).status, 'off');
    assert.equal(calls, 0); await session.close();
    session = await engine.openGateway(workspace, undefined, { ...settings, modules: { judge: true, scoring: false } });
    const unavailable = await session.assessPrompt('Specific prompt');
    assert.equal(unavailable.status, 'unavailable'); session.completePrompt(unavailable.promptId, 'end_turn');
    const pending = session.assessPrompt('Another prompt');
    const rejected = assert.rejects(pending, /stopped/);
    await entered; await engine.close(); await rejected;
    assert.doesNotThrow(() => session.recordAgentEvent('permission_decision@1', { approved: false }));
    const db = new DatabaseSync(join(root, 'data', 'usage.sqlite'));
    const events = db.prepare('SELECT event FROM practice_events').all().map(row => JSON.parse(row.event as string));
    assert.equal(events.filter(event => event.type === 'prompt_assessed@1').length, 3, 'Cancelled judgement must remain visible as unavailable');
    db.close();
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Anthropic-compatible judge validates the structured JSON tool response and usage', async () => {
  let recorded: { tool_choice: { type: string }; tools: { name: string }[] } | undefined;
  const upstream = createServer(async (req, res) => {
    assert.equal(req.headers['x-api-key'], 'synthetic-secret');
    let text = ''; for await (const chunk of req) text += chunk;
    recorded = JSON.parse(text);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg-synthetic', type: 'message', role: 'assistant', model: 'small-judge',
      content: [{ type: 'tool_use', id: 'json-1', name: 'json', input: { category: 'specific', specificity: 90, reason: 'Concrete expected result' } }],
      stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 8, output_tokens: 4 } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  try {
    const result = await judgePrompt({ baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-secret', api: 'anthropic-messages' }, 'small-judge', 'Fix unique_ids order without normalizing IDs.');
    assert.equal(recorded?.tool_choice.type, 'any');
    assert.ok(recorded?.tools.some((tool: { name: string }) => tool.name === 'json'));
    assert.equal(result.verdict.specificity, 90);
    assert.equal(result.usage.inputTokens, 8);
    assert.equal(result.usage.outputTokens, 4);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});
