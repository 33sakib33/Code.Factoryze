import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { SoloEngine } from '../src/solo.ts';

test('a budget override resolves native temp-directory aliases to the registered workspace', async () => {
  // Windows TMP commonly contains RUNNER~1, while async realpath expands it to runneradmin.
  const root = await mkdtemp(join(tmpdir(), 'factoryze-budget-alias-'));
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'synthetic', preparePython: async () => {} });
  try {
    const pack = join(process.cwd(), 'tasks/practice');
    const { workspace } = await engine.startTask(pack, 'library-fines', join(root, 'sessions'));
    const originalAlias = join(root, 'sessions', basename(workspace));
    await engine.setTaskBudget(originalAlias, 777);
    assert.equal((await engine.workspaceInfo(pack, workspace))?.budgetTokens, 777);
  } finally { await engine.close(); await rm(root, { recursive: true, force: true }); }
});

test('imported task source, budget and explicit override survive restart without resetting usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-task-budget-')); let calls = 0;
  const upstream = createServer((_req, res) => { calls++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n'); });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const options = { dataDir: join(root, 'data'), userId: 'test-user', preparePython: async () => {},
    grade: async (packs: string, id: string) => { assert.match(await readFile(join(packs, id, 'tests/hidden/test_main.py'), 'utf8'), /private/); return { passed: 1, total: 1 }; },
    settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fake', api: 'openai-chat' as const }, model: 'synthetic', contextWindow: 8192, maxOutputTokens: 1024, budget: { limit: 100000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } } };
  let engine = new SoloEngine(options);
  try {
    const source = join(root, 'source'); await mkdir(join(source, 'workspace'), { recursive: true }); await mkdir(join(source, 'tests/hidden'), { recursive: true });
    await writeFile(join(source, 'task.yaml'), 'schema: 1\nid: external-task\ntitle: External task\nbrief: Fix it\nminimumPython: "3.11"\nbudgetTokens: 42\n');
    await writeFile(join(source, 'workspace/main.py'), 'pass'); await writeFile(join(source, 'tests/hidden/test_main.py'), '# private');
    const { workspace } = await engine.importTask(source, join(root, 'sessions'));
    const reopenedTask = await engine.importTask(source, join(root, 'sessions'));
    assert.notEqual(reopenedTask.workspace, workspace);
    await writeFile(join(source, 'workspace/main.py'), 'different source');
    await assert.rejects(engine.importTask(source, join(root, 'sessions')), /unique id/i);
    await rm(source, { recursive: true });
    await assert.rejects(readFile(join(workspace, 'tests/hidden/test_main.py')));
    let session = await engine.openGateway(workspace); assert.equal(session.totals().budgetLimit, 42);
    await assert.rejects(engine.setTaskBudget(workspace, 10), /stop/i);
    const response = await fetch(`${session.connection.baseURL}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${session.connection.sessionToken}` }, body: '{"model":"synthetic","stream":true}' }); await response.text();
    await session.close();
    await engine.setTaskBudget(workspace, 10);
    session = await engine.openGateway(workspace); assert.equal(session.totals().weighted, 14); assert.equal(session.totals().budgetLimit, 10); assert.throws(() => session.checkBudget(), /exhausted/i);
    await session.close(); await engine.close(); engine = new SoloEngine(options);
    const info = await engine.workspaceInfo('/missing-bundled-catalog', workspace);
    assert.equal(info?.task.title, 'External task'); assert.equal(info?.budgetOverride, 10); assert.equal(info?.budgetTokens, 10);
    session = await engine.openGateway(workspace); assert.equal(session.totals().weighted, 14); assert.throws(() => session.checkBudget(), /exhausted/i); await session.close();
    await engine.setTaskBudget(workspace, null); session = await engine.openGateway(workspace); assert.equal(session.totals().budgetLimit, 42); assert.equal(session.totals().weighted, 14); await session.close();
    assert.equal((await engine.submitTask('/missing-bundled-catalog', workspace)).correctness.passed, 1);
    assert.equal(calls, 1);
  } finally { await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
