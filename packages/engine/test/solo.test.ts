import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { scorePractice } from '../src/scoring.ts';
import { SoloEngine, SOLO_PROFILE } from '../src/solo.ts';
import { loadBenchmarkPrompts } from '../src/tasks.ts';

test('reports retain every distinct execution pin across sessions, resubmission and engine restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-report-pins-'));
  const settings = { provider: { baseURL: 'https://provider.invalid/private/path', apiKey: 'synthetic-secret', api: 'openai-chat' as const },
    model: 'first', contextWindow: 8192, maxOutputTokens: 256, temperature: 0,
    budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } };
  const options = { dataDir: join(root, 'data'), userId: 'student', settings, preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }) };
  let engine = new SoloEngine(options);
  try {
    const packs = join(process.cwd(), 'tasks/practice');
    const { workspace } = await engine.startTask(packs, 'library-fines', join(root, 'workspaces'));
    assert.equal((await engine.submitTask(packs, workspace)).executionPins, undefined, 'Do not invent a pin when no session ran');
    for (let i = 0; i < 2; i++) await (await engine.openGateway(workspace)).close();
    const first = await engine.submitTask(packs, workspace);
    const pins = [{ profile: SOLO_PROFILE, model: 'first', providerHost: 'provider.invalid', temperature: 0, os: process.platform }];
    assert.deepEqual(first.executionPins, pins);
    await (await engine.openGateway(workspace, undefined, { ...settings, model: 'second', temperature: undefined })).close();
    await engine.close(); engine = new SoloEngine({ ...options, settings: { ...settings, model: 'unused-current-model', temperature: 1 } });
    assert.deepEqual((await engine.report(workspace, 2)).executionPins, pins, 'Earlier snapshots never change');
    const report = await engine.submitTask(packs, workspace);
    assert.deepEqual(report.executionPins, [...pins, { ...pins[0], model: 'second', temperature: null }]);
    assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
    assert.equal(JSON.stringify(report).includes('/private/path'), false);
    assert.deepEqual((await engine.latestReport(workspace))?.executionPins, report.executionPins);
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('submission grades only a registered practice workspace and labels the result unverified', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-submit-'));
  const graded: string[] = [];
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'test-user',
    preparePython: async () => {},
    grade: async (packs, taskId, workspace) => {
      graded.push(`${taskId}:${workspace}`);
      return { passed: 2, total: 3 };
    },
  });
  try {
    const packs = fileURLToPath(new URL('../../../tasks/practice', import.meta.url));
    const { workspace } = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    assert.equal(await engine.workspaceInfo(packs, root), null);
    assert.equal((await engine.workspaceInfo(packs, workspace))?.task.entryFile, 'app/dedupe.py');
    await assert.rejects(engine.runTests(root), /practice task/i);
    await assert.rejects(engine.submitTask(packs, root), /practice task/i);
    const report = await engine.submitTask(packs, workspace);
    assert.equal(report.taskId, 'dedupe-ids');
    assert.equal(report.kind, 'practice');
    assert.deepEqual(report.correctness, { passed: 2, total: 3 });
    assert.deepEqual(report.usage, []);
    assert.match(report.submittedAt, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(graded, [`dedupe-ids:${workspace}`]);
    assert.deepEqual(await engine.latestReport(workspace), report);
    await engine.close();
    const reopened = new SoloEngine({ dataDir: join(root, 'data'), userId: 'test-user', preparePython: async () => {} });
    try { assert.deepEqual(await reopened.latestReport(workspace), report); }
    finally { await reopened.close(); }
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('practice session routes to the upstream with engine credentials and persists task totals across engine restarts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-solo-'));
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    calls++;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fake-provider-secret');
    let text = ''; for await (const chunk of req) text += chunk;
    assert.equal(JSON.parse(text).stream_options.include_usage, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const prepared: string[] = [];
  const options = { dataDir: join(root, 'data'), userId: 'test-user',
    preparePython: async (workspace: string, minimum: string) => {
      prepared.push(minimum);
      writeFileSync(join(workspace, '.venv-ready'), minimum);
    },
    grade: async () => ({ passed: 1, total: 1 }),
    settings: {
    provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fake-provider-secret', api: 'openai-chat' as const },
    model: 'test', contextWindow: 8192, maxOutputTokens: 2048, budget: { limit: 10, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } }
  } };
  let engine = new SoloEngine(options);
  try {
    const packs = fileURLToPath(new URL('../../../tasks/practice', import.meta.url));
    const { workspace } = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    assert.deepEqual(prepared, ['3.11']);
    assert.equal(readFileSync(join(workspace, '.venv-ready'), 'utf8'), '3.11');
    await assert.rejects(() => engine.openGateway(root), /practice task/i);
    const configured = await engine.openGateway(workspace, undefined, {
      ...options.settings, model: 'selected-in-launcher', budget: { ...options.settings.budget, limit: 77 }
    });
    assert.equal(configured.connection.model, 'selected-in-launcher');
    assert.equal(configured.totals().budgetLimit, 77);
    await configured.close();
    const session = await engine.openGateway(workspace);
    assert.equal(session.totals().scope.taskId, 'dedupe-ids');
    const response = await fetch(`${session.connection.baseURL}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${session.connection.sessionToken}` },
      body: '{"model":"test","stream":true}'
    });
    await response.text();
    assert.equal(session.totals().weighted, 14);
    assert.equal(session.totals().status, 'exhausted');
    await session.close();
    const report = await engine.submitTask(packs, workspace);
    assert.deepEqual(report.workspaceUsage?.map(item => [item.scope.model, item.weighted, item.requests]), [['test', 14, 1]]);
    assert.equal(report.usage.find(item => item.scope.model === 'test')?.weighted, 14);
    const next = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    const nextReport = await engine.submitTask(packs, next.workspace);
    assert.deepEqual(nextReport.workspaceUsage, []);
    assert.equal(nextReport.usage.find(item => item.scope.model === 'test')?.weighted, 14);
    await engine.close();
    engine = new SoloEngine(options);
    const restarted = await engine.openGateway(workspace);
    assert.equal(restarted.totals().weighted, 14);
    assert.throws(() => restarted.checkBudget(), /budget exhausted/i);
    const denied = await fetch(`${restarted.connection.baseURL}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${restarted.connection.sessionToken}` },
      body: '{"model":"test","stream":true}'
    });
    assert.equal(denied.status, 402); await denied.text();
    assert.equal(calls, 1);
    await restarted.close();
    await engine.close();
    const db = readFileSync(join(options.dataDir, 'usage.sqlite')).toString('latin1');
    assert.equal(db.includes('fake-provider-secret'), false);
    assert.equal(db.includes(session.connection.sessionToken), false);
  } finally { await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('starting the same task again resets this run, while resume/New session/restart preserve each run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-fresh-run-'));
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain synthetic request. */ } calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"usage":{"prompt_tokens":10,"completion_tokens":4}}');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const options = { dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {},
    grade: async () => ({ passed: 1, total: 1 }), settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' as const },
      model: 'test', contextWindow: 8192, maxOutputTokens: 256, budget: { limit: 10, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } } };
  let engine = new SoloEngine(options);
  const packs = fileURLToPath(new URL('../../../tasks/practice', import.meta.url));
  const send = async (session: Awaited<ReturnType<SoloEngine['openGateway']>>) => {
    const res = await fetch(`${session.connection.baseURL}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${session.connection.sessionToken}` }, body: '{"model":"test"}' });
    await res.text(); assert.equal(res.status, 200);
  };
  try {
    const first = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    let session = await engine.openGateway(first.workspace); await send(session);
    assert.equal(session.totals().weighted, 14); await session.close();
    session = await engine.openGateway(first.workspace);
    assert.equal(session.totals().weighted, 14); assert.throws(session.checkBudget, /exhausted/); await session.close();
    const next = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    assert.notEqual(next.workspace, first.workspace);
    const info = await engine.workspaceInfo(packs, next.workspace);
    assert.equal(info!.usage!.find(u => u.scope.model === 'test')!.weighted, 0);
    session = await engine.openGateway(next.workspace);
    assert.equal(session.totals().weighted, 0); assert.equal(session.totals().remaining, 10);
    await send(session); await session.close(); await engine.close();
    engine = new SoloEngine(options);
    for (const workspace of [first.workspace, next.workspace]) {
      session = await engine.openGateway(workspace); assert.equal(session.totals().weighted, 14);
      assert.throws(session.checkBudget, /exhausted/); await session.close();
    }
    const report = await engine.submitTask(packs, next.workspace);
    assert.equal(report.workspaceUsage![0]!.weighted, 14);
    assert.equal(report.usage[0]!.weighted, 28);
    assert.equal(calls, 2);
  } finally { await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('solved practice report snapshots matching expert ratios and preserves correctness when a baseline goes stale', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-comparison-'));
  const packs = join(root, 'packs');
  const source = fileURLToPath(new URL('../../../tasks/practice/dedupe-ids', import.meta.url));
  cpSync(source, join(packs, 'dedupe-ids'), { recursive: true });
  const prompts = await loadBenchmarkPrompts(packs, 'dedupe-ids');
  const baseline = {
    schema: 1, taskId: 'dedupe-ids', profile: SOLO_PROFILE, model: 'synthetic',
    promptsHash: createHash('sha256').update(JSON.stringify(prompts)).digest('hex'),
    recordedAt: '2026-10-21T00:00:00.000Z',
    expert: { correctness: { passed: 1, total: 1 }, raw: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 },
      weightedTokens: 7, requests: 1, turns: 2, elapsedMs: 100 },
    naive: { correctness: { passed: 1, total: 1 }, raw: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 },
      weightedTokens: 14, requests: 1, turns: 3, elapsedMs: 200 }
  };
  const baselineFile = join(packs, 'dedupe-ids', 'baselines', SOLO_PROFILE, 'synthetic.json');
  mkdirSync(join(packs, 'dedupe-ids', 'baselines', SOLO_PROFILE), { recursive: true });
  writeFileSync(baselineFile, JSON.stringify(baseline));
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  let passed = 1;
  const options = { dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {},
    grade: async () => ({ passed, total: 1 }),
    judge: async () => ({ verdict: { category: 'specific' as const, specificity: 90, reason: 'Concrete change and verification' }, usage: { inputTokens: 8, outputTokens: 4 } }),
    settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' as const },
      model: 'synthetic', contextWindow: 8192, maxOutputTokens: 2048,
      modules: { judge: true, scoring: true },
      budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } } };
  let engine = new SoloEngine(options);
  try {
    const { workspace } = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    const session = await engine.openGateway(workspace);
    const assessment = await session.assessPrompt('Fix the ordering and verify the public tests.');
    const response = await fetch(`${session.connection.baseURL}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${session.connection.sessionToken}` },
      body: '{"model":"synthetic","stream":true}'
    });
    assert.equal(response.status, 200); await response.text();
    session.completePrompt(assessment.promptId, 'end_turn'); await session.close();
    const report = await engine.submitTask(packs, workspace);
    assert.deepEqual(report.baselineComparisons, [{ profile: SOLO_PROFILE, model: 'synthetic',
      baselinePromptsHash: baseline.promptsHash, weightedTokensRatio: 2, promptTurnsRatio: 0.5 }]);
    assert.equal(report.scoring?.total, 93.5);
    await engine.close();
    engine = new SoloEngine(options);
    assert.deepEqual((await engine.latestReport(workspace))?.baselineComparisons, report.baselineComparisons);
    assert.deepEqual((await engine.latestReport(workspace))?.scoring, report.scoring);
    const historical = await engine.openGateway(workspace);
    historical.recordTurn(); await historical.close();
    const historicalReport = await engine.submitTask(packs, workspace);
    assert.equal(historicalReport.scoring?.specificity, null, 'Unassessed earlier turns cannot receive a partial judge average');
    assert.deepEqual(scorePractice(historicalReport.correctness, historicalReport.baselineComparisons ?? [],
      historicalReport.promptAssessments ?? [], historicalReport.scoringContext), historicalReport.scoring, 'Saved inputs must reproduce even an unavailable score');
    passed = 0;
    assert.deepEqual((await engine.submitTask(packs, workspace)).baselineComparisons, []);
    passed = 1;
    writeFileSync(baselineFile, JSON.stringify({ ...baseline, promptsHash: '0'.repeat(64) }));
    const stale = await engine.submitTask(packs, workspace);
    assert.deepEqual(stale.correctness, { passed: 1, total: 1 });
    assert.deepEqual(stale.baselineComparisons, []);
    assert.equal(stale.baselineWarning, 'invalid-or-stale');
  } finally { await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('attempts list every practice workspace with its number, usage and submissions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-attempts-'));
  let passed = 0;
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'test-user', preparePython: async () => {},
    grade: async () => ({ passed, total: 1, checks: [{ name: 'test_each_page_includes_its_last_item', passed: passed === 1, ...(passed ? {} : { message: 'AssertionError: short page' }) }] }) });
  try {
    const packs = fileURLToPath(new URL('../../../tasks/practice', import.meta.url));
    assert.deepEqual(await engine.listAttempts(packs), []);
    const first = await engine.startTask(packs, 'pagination-api', join(root, 'workspaces'));
    const second = await engine.startTask(packs, 'pagination-api', join(root, 'workspaces'));
    const other = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    await engine.submitTask(packs, first.workspace);
    passed = 1;
    await engine.submitTask(packs, first.workspace);
    const attempts = await engine.listAttempts(packs, 20000);
    assert.deepEqual(attempts.map(item => [item.taskId, item.attempt, item.submissions]).sort(),
      [['dedupe-ids', 1, 0], ['pagination-api', 1, 2], ['pagination-api', 2, 0]]);
    const firstSummary = attempts.find(item => item.workspace === first.workspace)!;
    assert.equal(firstSummary.title, 'Pagination API');
    assert.equal(firstSummary.budgetLimit, 20000);
    assert.equal(firstSummary.weighted, 0);
    assert.deepEqual({ passed: firstSummary.latest!.passed, total: firstSummary.latest!.total }, { passed: 1, total: 1 });
    assert.ok(attempts.find(item => item.workspace === second.workspace));
    assert.ok(attempts.find(item => item.workspace === other.workspace));
    const reports = await engine.listReports(packs);
    assert.deepEqual(reports.map(item => [item.attempt, item.submission, item.submissions, item.passed]), [[1, 2, 2, 1], [1, 1, 2, 0]]);
    const earlier = await engine.report(first.workspace, 1);
    assert.deepEqual(earlier.checks, [{ name: 'test_each_page_includes_its_last_item', passed: false, message: 'AssertionError: short page' }]);
    await assert.rejects(engine.report(first.workspace, 3), /submission/i);
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('raising the budget in an attempt is recorded on its next report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-raise-'));
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'test-user', preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }) });
  try {
    const packs = fileURLToPath(new URL('../../../tasks/practice', import.meta.url));
    const { workspace } = await engine.startTask(packs, 'dedupe-ids', join(root, 'workspaces'));
    assert.equal((await engine.submitTask(packs, workspace)).budget, undefined);
    await engine.setTaskBudget(workspace, 20000, 100000);
    await engine.openGateway(workspace, undefined, { provider: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', api: 'openai-chat' }, model: 'm',
      contextWindow: 1000, maxOutputTokens: 10, budget: { limit: 100000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } }).then(session => session.close());
    await engine.setTaskBudget(workspace, 30000, 100000);
    const report = await engine.submitTask(packs, workspace);
    assert.deepEqual(report.budget, { limit: 30000, initialLimit: 20000 });
  } finally { await engine.close(); rmSync(root, { recursive: true, force: true }); }
});
