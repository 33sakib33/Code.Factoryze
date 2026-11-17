import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SoloEngine } from '@factoryze/engine/solo';
import { AgentBackendService } from '../src/node/agent-backend-service.ts';
import type { GatewayConnection, UsageTotals } from '@factoryze/protocol';

test('a temperature refusal is actionable, never retried, and a cleared setting recovers with metering', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-temperature-recovery-'));
  const requests: Record<string, unknown>[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    if ('temperature' in body) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"temperature is not supported: synthetic-private-diagnostic"}}');
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n');
    }
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const selected = { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-key', api: 'openai-chat' as const },
    model: 'synthetic', contextWindow: 8192, maxOutputTokens: 256, temperature: 0 as number | undefined,
    budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } };
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }) });
  const service = new AgentBackendService({ engine, settings: async () => selected });
  try {
    const packs = join(process.cwd(), 'tasks/practice');
    const { workspace } = await engine.startTask(packs, 'library-fines', join(root, 'workspaces'));
    await service.start(workspace);
    await assert.rejects(service.prompt('hello'), error => error instanceof Error && /temperature.*Settings.*blank/i.test(error.message) && !error.message.includes('synthetic-private'));
    assert.equal(requests.length, 1, 'Do not silently retry with different sampling or incur another model call');
    assert.equal(requests[0].temperature, 0);
    selected.temperature = undefined;
    await service.start(workspace);
    assert.equal(await service.prompt('hello'), 'end_turn');
    assert.equal(requests.length, 2); assert.equal('temperature' in requests[1], false);
    const report = await engine.submitTask(packs, workspace);
    assert.equal(report.workspaceUsage?.[0].weighted, 14);
    assert.equal(report.workspaceUsage?.[0].incompleteRequests, 0);
    assert.deepEqual(report.executionPins?.map(pin => pin.temperature), [0, null]);
  } finally { await service.stop(); await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('app backend uses the task gateway, publishes usage and preserves exhaustion when New session is clicked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-backend-'));
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    calls++;
    for await (const chunk of req) { /* Drain request. */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"usage":{"prompt_tokens":10,"completion_tokens":4}}');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const selectedSettings = {
    provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-only', api: 'openai-chat' },
    model: 'test', contextWindow: 8192, maxOutputTokens: 2048,
    budget: { limit: 10, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } }
  } as const;
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'test-user', preparePython: async () => {},
    grade: async () => ({ passed: 1, total: 1 }),
    settings: { ...selectedSettings, model: 'fallback-model' } });
  const notifications: UsageTotals[] = [];
  let connection: GatewayConnection | undefined;
  let settingsLoads = 0;
  const service = new AgentBackendService({ engine, settings: async () => { settingsLoads++; return selectedSettings; }, createSession: options => {
    connection = options.gateway;
    return { start: async () => {}, stop() {}, prompt: async () => {
      const response = await fetch(`${connection!.baseURL}/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${connection!.sessionToken}` }, body: '{"model":"test"}'
      });
      await response.text();
      return 'end_turn';
    } };
  } });
  service.setClient({ onUpdate() {}, requestPermission: async () => null, onUsage: totals => notifications.push(totals) });
  try {
    const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
    assert.equal((await service.start(workspace)).weighted, 0);
    assert.equal(settingsLoads, 1);
    assert.equal(connection?.model, 'test');
    assert.ok(connection);
    await service.prompt('Hello');
    const db = new DatabaseSync(join(root, 'data', 'usage.sqlite'));
    const events = db.prepare('SELECT event FROM practice_events').all().map(row => JSON.parse(row.event as string));
    assert.ok(events.some(event => event.type === 'model_request_started@1'));
    assert.ok(events.some(event => event.type === 'model_request_ended@1' && event.data.usage.input === 10));
    assert.equal(JSON.stringify(events).includes('synthetic-only'), false);
    db.close();
    assert.equal(notifications.at(-1)?.weighted, 14);
    const report = await engine.submitTask(join(process.cwd(), 'tasks/practice'), workspace);
    assert.equal(report.workspaceUsage?.[0]?.promptTurns, 1);
    const previousToken = connection.sessionToken;
    assert.equal((await service.start(workspace)).weighted, 14);
    assert.equal(settingsLoads, 2);
    assert.notEqual(connection.sessionToken, previousToken);
    await assert.rejects(() => service.prompt('Another prompt'), /budget exhausted/i);
    assert.equal((await engine.submitTask(join(process.cwd(), 'tasks/practice'), workspace)).workspaceUsage?.[0]?.promptTurns, 1);
    assert.equal(calls, 1);
  } finally { await service.stop(); await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test('Stop interrupts an active prompt without recording a completed turn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-stop-'));
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }),
    settings: { provider: { baseURL: 'https://provider.invalid/v1', apiKey: 'synthetic', api: 'openai-chat' }, model: 'test',
      contextWindow: 8192, maxOutputTokens: 2048, budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } } });
  let rejectPrompt!: (error: Error) => void;
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const service = new AgentBackendService({ engine, createSession: () => ({ start: async () => {},
    prompt: () => new Promise((_resolve, reject) => { rejectPrompt = reject; started(); }),
    stop: () => rejectPrompt?.(new Error('Stopped')) }) });
  try {
    const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
    await service.start(workspace);
    const prompt = service.prompt('Make a precise change');
    const rejected = assert.rejects(prompt, /Stopped/);
    await running; await service.stop(); await rejected;
    const report = await engine.submitTask(join(process.cwd(), 'tasks/practice'), workspace);
    assert.equal(report.workspaceUsage?.[0]?.promptTurns, undefined);
    assert.equal(report.promptAssessments?.length, 1);
  } finally { await service.stop(); await engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Stop during settings loading cannot launch a late OpenCode process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-start-stop-'));
  let ready!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { ready = resolve; });
  const settings = new Promise<undefined>(resolve => { release = () => resolve(undefined); });
  let launches = 0;
  const service = new AgentBackendService({ settings: () => { ready(); return settings; },
    engine: { openGateway: async () => { launches++; throw new Error('Must not launch'); } } });
  try {
    const start = service.start(root); const rejected = assert.rejects(start, /stopped/);
    await entered; await service.stop(); release(); await rejected;
    assert.equal(launches, 0);
  } finally { await service.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('Factoryze backend needs no OpenCode process and releases its gateway after provider rejection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-own-backend-'));
  let requests = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain. */ } requests++;
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":{"message":"private provider detail"}}');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const selected = { agent: 'factoryze' as const, provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' as const }, model: 'vendor/model',
    contextWindow: 8192, maxOutputTokens: 256, budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } };
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {} });
  const service = new AgentBackendService({ engine, settings: async () => selected });
  service.setClient({ onUsage() {}, onUpdate() {}, requestPermission: async () => null });
  try {
    const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
    assert.equal((await service.start(workspace)).scope.profile, 'factoryze@0.1.0');
    assert.equal(requests, 0);
    await assert.rejects(service.prompt('hello'), /could not find this model or endpoint/);
    assert.equal(requests, 1);
    // No leaked active session prevents a configuration/budget change after failure.
    await engine.setTaskBudget(workspace, 2000);
    await assert.rejects(service.prompt('again'), /Start an agent session/);
  } finally { await service.stop(); await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
