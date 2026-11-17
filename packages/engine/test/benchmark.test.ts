import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadBenchmarkBaseline, measureBenchmarkVariance, recordBenchmark, summarizeRuns } from '../src/benchmark.ts';

test('benchmark records isolated expert and naive runs only after both are measured', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-'));
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const upstream = createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const workspaces: string[] = [];
  const options = {
    packRoot: packs, taskId: 'dedupe-ids', outputRoot: scratch,
    settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'provider-secret-not-in-baseline', api: 'openai-chat' as const },
      model: 'synthetic/test', contextWindow: 8192, maxOutputTokens: 2048,
      budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
    preparePython: async () => {},
    grade: async () => ({ passed: 1, total: 1 }),
    run: async ({ workspace, connection, prompts, recordTurn }: { workspace: string; connection: { baseURL: string; sessionToken: string }; prompts: string[]; recordTurn(): void }) => {
      workspaces.push(workspace);
      assert.equal(prompts.length, 1);
      const response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${connection.sessionToken}` },
        body: '{"model":"synthetic/test","stream":true}'
      });
      assert.equal(response.status, 200);
      await response.text();
      recordTurn();
    }
  };
  try {
    const { file, baseline } = await recordBenchmark(options);
    assert.equal(workspaces.length, 2);
    assert.notEqual(workspaces[0], workspaces[1]);
    assert.equal(baseline.taskId, 'dedupe-ids');
    assert.equal(baseline.profile, 'factoryze@0.1.0');
    assert.equal(baseline.model, 'synthetic/test');
    assert.equal(baseline.expert.weightedTokens, 14);
    assert.equal(baseline.naive.weightedTokens, 14);
    assert.equal(baseline.expert.turns, 1);
    assert.deepEqual(baseline.expert.correctness, { passed: 1, total: 1 });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), baseline);
    assert.deepEqual(await loadBenchmarkBaseline({ packRoot: packs, baselineRoot: scratch,
      taskId: 'dedupe-ids', profile: 'factoryze@0.1.0', model: 'synthetic/test' }), baseline);
    assert.equal(await loadBenchmarkBaseline({ packRoot: packs, baselineRoot: scratch,
      taskId: 'dedupe-ids', profile: 'factoryze@0.1.0', model: 'another-model' }), null);
    await writeFile(file, JSON.stringify({ ...baseline, promptsHash: '0'.repeat(64) }));
    await assert.rejects(loadBenchmarkBaseline({ packRoot: packs, baselineRoot: scratch,
      taskId: 'dedupe-ids', profile: 'factoryze@0.1.0', model: 'synthetic/test' }), /prompt script/i);
    await writeFile(file, JSON.stringify({ ...baseline, model: 'wrong-model' }));
    await assert.rejects(loadBenchmarkBaseline({ packRoot: packs, baselineRoot: scratch,
      taskId: 'dedupe-ids', profile: 'factoryze@0.1.0', model: 'synthetic/test' }), /does not match/i);
    await writeFile(file, '{bad json');
    await assert.rejects(loadBenchmarkBaseline({ packRoot: packs, baselineRoot: scratch,
      taskId: 'dedupe-ids', profile: 'factoryze@0.1.0', model: 'synthetic/test' }));
    assert.equal(file.includes('synthetic%2Ftest.json'), true);
    assert.equal(JSON.stringify(baseline).includes('provider-secret-not-in-baseline'), false);
    await assert.rejects(recordBenchmark(options), /already exists/i);
    assert.equal(workspaces.length, 2);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(scratch, { recursive: true, force: true }); }
});

test('failed benchmark leaves no baseline and closes its run', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-fail-'));
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  try {
    await assert.rejects(recordBenchmark({ packRoot: packs, taskId: 'pagination-api', outputRoot: scratch,
      settings: { provider: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'synthetic', api: 'openai-chat' },
        model: 'synthetic', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }),
      run: async () => { throw new Error('agent failed'); }
    }), /agent failed/);
    assert.deepEqual(await readdir(scratch), []);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('benchmark refuses a run without metered model usage', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-unmetered-'));
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  try {
    await assert.rejects(recordBenchmark({ packRoot: packs, taskId: 'dedupe-ids', outputRoot: scratch,
      settings: { provider: { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'synthetic', api: 'openai-chat' },
        model: 'synthetic', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }), run: async () => {}
    }), /missing or incomplete token usage/i);
    assert.deepEqual(await readdir(scratch), []);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('benchmark refuses model usage without completed prompt turns', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-turns-'));
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(recordBenchmark({ packRoot: packs, taskId: 'dedupe-ids', outputRoot: scratch,
      settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' },
        model: 'synthetic', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }),
      run: async ({ connection }) => {
        const response = await fetch(`${connection.baseURL}/chat/completions`, {
          method: 'POST', headers: { authorization: `Bearer ${connection.sessionToken}` },
          body: '{"model":"synthetic","stream":true}'
        });
        assert.equal(response.status, 200);
        await response.text();
      }
    }), /completed prompt turns/i);
    assert.deepEqual(await readdir(scratch), []);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(scratch, { recursive: true, force: true }); }
});

test('variance runs alternate expert and naive, keep failed runs, and write no baseline', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-variance-'));
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const upstream = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const tokens = JSON.parse(raw).scenario === 'expert' ? 10 : 40;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: {"usage":{"prompt_tokens":${tokens},"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const order: string[] = [], workspaces = new Set<string>();
  try {
    const result = await measureBenchmarkVariance({ packRoot: packs, taskId: 'dedupe-ids', runs: 3, temperature: 0,
      settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'provider-secret-not-in-result', api: 'openai-chat' },
        model: 'synthetic/test', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }),
      run: async ({ scenario, workspace, connection, recordTurn }) => {
        order.push(scenario); workspaces.add(workspace);
        if (scenario === 'naive' && order.length === 4) throw new Error('agent stopped: max_steps');
        const response = await fetch(`${connection.baseURL}/chat/completions`, { method: 'POST',
          headers: { authorization: `Bearer ${connection.sessionToken}` }, body: JSON.stringify({ model: 'synthetic/test', stream: true, scenario }) });
        await response.text(); recordTurn();
      } });
    assert.deepEqual(order, ['expert', 'naive', 'expert', 'naive', 'expert', 'naive']);
    assert.equal(workspaces.size, 6);
    assert.equal(result.temperature, 0);
    assert.deepEqual(result.expert.map(run => run.weightedTokens), [14, 14, 14]);
    assert.deepEqual(result.naive.map(run => run.weightedTokens ?? null), [44, null, 44]);
    assert.match(result.naive[1].error!, /max_steps/);
    assert.deepEqual(result.summary.expert, { completed: 3, failed: 0, solved: 3, min: 14, median: 14, max: 14, mean: 14, stdev: 0 });
    assert.equal(result.summary.naive.failed, 1);
    assert.equal(result.summary.separated, true);
    assert.equal(JSON.stringify(result).includes('provider-secret-not-in-result'), false);
    assert.deepEqual((await readdir(join(packs, 'dedupe-ids'))).filter(name => name.startsWith('.')), []);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); await rm(scratch, { recursive: true, force: true }); }
});

test('run summaries report spread and whether expert and naive overlap', () => {
  const run = (weightedTokens: number, passed = 1) => ({ weightedTokens, correctness: { passed, total: 1 } });
  const summary = summarizeRuns([run(100), run(120), run(110, 0)], [run(115), run(300)]);
  assert.deepEqual(summary.expert, { completed: 3, failed: 0, solved: 2, min: 100, median: 110, max: 120, mean: 110, stdev: 8.2 });
  assert.equal(summary.naive.median, 207.5);
  assert.equal(summary.separated, false);
  assert.equal(summarizeRuns([run(100)], [run(101)]).separated, true);
  assert.equal(summarizeRuns([], [run(101)]).separated, false);
});

test('variance runs include the middle scenario when the task defines one', async () => {
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const upstream = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const tokens = { expert: 10, middle: 20, naive: 40 }[JSON.parse(raw).scenario as string];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: {"usage":{"prompt_tokens":${tokens},"completion_tokens":4},"choices":[]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const order: string[] = [];
  try {
    const result = await measureBenchmarkVariance({ packRoot: packs, taskId: 'monthly-revenue', runs: 2,
      settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' },
        model: 'synthetic/test', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 9, total: 9 }),
      run: async ({ scenario, connection, recordTurn }) => {
        order.push(scenario);
        const response = await fetch(`${connection.baseURL}/chat/completions`, { method: 'POST',
          headers: { authorization: `Bearer ${connection.sessionToken}` }, body: JSON.stringify({ model: 'synthetic/test', stream: true, scenario }) });
        await response.text(); recordTurn();
      } });
    assert.deepEqual(order, ['expert', 'middle', 'naive', 'expert', 'middle', 'naive']);
    assert.deepEqual(result.middle?.map(run => run.weightedTokens), [24, 24]);
    assert.equal(result.summary.middle?.median, 24);
    assert.equal(result.summary.separated, true);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});

test('a variance run that fails after spending tokens keeps its usage and grade', async () => {
  const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"usage":{"prompt_tokens":30,"completion_tokens":5},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  try {
    const result = await measureBenchmarkVariance({ packRoot: packs, taskId: 'dedupe-ids', runs: 1,
      settings: { provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic', api: 'openai-chat' },
        model: 'synthetic/test', contextWindow: 8192, maxOutputTokens: 2048,
        budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
      preparePython: async () => {}, grade: async () => ({ passed: 0, total: 1 }),
      run: async ({ scenario, connection, recordTurn }) => {
        for (let request = 0; request < 2; request++) {
          const response = await fetch(`${connection.baseURL}/chat/completions`, { method: 'POST',
            headers: { authorization: `Bearer ${connection.sessionToken}` }, body: '{"model":"synthetic/test","stream":true}' });
          await response.text();
        }
        if (scenario === 'naive') throw new Error('Stopped after 16 model steps.');
        recordTurn();
      } });
    assert.equal(result.naive[0].error, 'Stopped after 16 model steps.');
    assert.equal(result.naive[0].weightedTokens, 70);
    assert.deepEqual(result.naive[0].correctness, { passed: 0, total: 1 });
    assert.deepEqual(result.summary.naive, { completed: 0, failed: 1, solved: 0, min: 70, median: 70, max: 70, mean: 70, stdev: 0 });
    assert.equal(result.expert[0].error, undefined);
    assert.equal(result.summary.expert.completed, 1);
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});
