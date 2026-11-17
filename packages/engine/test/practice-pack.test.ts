import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gradePracticeTask, runPracticeTests } from '../src/grader.ts';
import { preparePythonEnvironment } from '../src/python.ts';
import { SoloEngine } from '../src/solo.ts';
import { listPracticeTasks, startPracticeTask } from '../src/tasks.ts';

const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
const run = promisify(execFile);

for (const id of ['library-fines', 'monthly-revenue']) {
  test(`${id}: public tests pass on the buggy starter and a targeted fix passes every hidden check`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'factoryze-practice-pack-'));
    try {
      const environment = await preparePythonEnvironment(root, '3.11');
      const python = join(environment.venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const { workspace } = await startPracticeTask(packs, id, join(root, 'attempts'));
      const publicTests = await runPracticeTests(workspace, python);
      assert.equal(publicTests.total, id === 'library-fines' ? 5 : 2);
      assert.equal(publicTests.passed, publicTests.total);
      const unittest = await run(python, ['-m', 'unittest'], { cwd: workspace, timeout: 30000 });
      assert.match(unittest.stderr, new RegExp(`Ran ${publicTests.total} tests`));
      assert.match(unittest.stderr, /\bOK\b/);
      const initial = await gradePracticeTask(packs, id, workspace, python);
      assert.equal(initial.total, 9); assert.ok(initial.passed < initial.total);
      const file = join(workspace, id === 'library-fines' ? 'library/returns.py' : 'billing/promotions.py');
      const source = await readFile(file, 'utf8');
      const fixed = id === 'library-fines'
        ? source.replace('from .calendar import', 'from .clock import local_day\nfrom .calendar import')
          .replace('returned_on = returned_at.date()', 'returned_on = local_day(returned_at, branch)')
        : source.replace('found=[]', 'found=None').replace('    if customer.tier in TIER_DISCOUNTS:',
          '    if found is None:\n        found = []\n    if customer.tier in TIER_DISCOUNTS:');
      assert.notEqual(fixed, source);
      await writeFile(file, fixed);
      const corrected = await gradePracticeTask(packs, id, workspace, python);
      assert.equal(corrected.passed, 9); assert.equal(corrected.total, 9);
      assert.equal((await runPracticeTests(workspace, python)).passed, publicTests.total);
      await assert.rejects(readFile(join(workspace, 'tests', 'hidden', id === 'library-fines' ? 'test_library.py' : 'test_billing.py')));
      await assert.rejects(readFile(join(workspace, 'prompts', 'benchmark.yaml')));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('retiring bundled tasks preserves old attempts, usage, reports and resubmission after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-retirement-upgrade-'));
  const packRoot = join(root, 'packs');
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"usage":{"prompt_tokens":10,"completion_tokens":4}}');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const options = { dataDir: join(root, 'data'), userId: 'synthetic-upgrade-user', settings: {
    provider: { api: 'openai-chat' as const, baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic' },
    model: 'synthetic/test', contextWindow: 8192, maxOutputTokens: 256,
    budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } },
  } };
  let engine = new SoloEngine(options);
  const attempts: { workspace: string; id: string; report: Awaited<ReturnType<SoloEngine['submitTask']>> }[] = [];
  try {
    for (const id of ['dedupe-ids', 'pagination-api']) {
      await cp(join(packs, id), join(packRoot, id), { recursive: true });
      const manifest = join(packRoot, id, 'task.yaml');
      await writeFile(manifest, (await readFile(manifest, 'utf8')).replace(/^retired: true\r?\n/m, ''));
      const { workspace } = await engine.startTask(packRoot, id, join(root, 'attempts'));
      if (id === 'dedupe-ids') await writeFile(join(workspace, 'app', 'dedupe.py'),
        'def unique_ids(ids):\n    return list(dict.fromkeys(ids))\n');
      const gateway = await engine.openGateway(workspace);
      const response = await fetch(`${gateway.connection.baseURL}/chat/completions`, { method: 'POST',
        headers: { authorization: `Bearer ${gateway.connection.sessionToken}` }, body: '{"model":"synthetic/test"}' });
      assert.equal(response.status, 200); await response.text(); await gateway.close();
      attempts.push({ workspace, id, report: await engine.submitTask(packRoot, workspace) });
    }
    await engine.close();
    // Simulate the bundled-manifest update and a pre-snapshot registry entry.
    for (const { id } of attempts) {
      const manifest = join(packRoot, id, 'task.yaml');
      await writeFile(manifest, (await readFile(manifest, 'utf8')) + '\nretired: true\n');
    }
    const db = new DatabaseSync(join(options.dataDir, 'usage.sqlite'));
    db.prepare('UPDATE practice_workspaces SET task_json=NULL WHERE task_id=?').run('dedupe-ids'); db.close();
    assert.deepEqual(await listPracticeTasks(packRoot), []);
    engine = new SoloEngine(options);
    assert.deepEqual((await engine.listAttempts(packRoot)).map(attempt => attempt.taskId), ['dedupe-ids', 'pagination-api']);
    assert.equal((await engine.listReports(packRoot)).length, 2);
    for (const { id, workspace, report } of attempts) {
      assert.deepEqual(await engine.latestReport(workspace), report);
      const info = await engine.workspaceInfo(packRoot, workspace, 1000);
      assert.equal(info!.task.id, id); assert.equal(info!.usage![0]!.weighted, 14);
      assert.equal(info!.budgetTokens, 1000);
      const resubmitted = await engine.submitTask(packRoot, workspace);
      assert.deepEqual(resubmitted.correctness, report.correctness, JSON.stringify({ id, checks: resubmitted.checks }));
      assert.equal(resubmitted.workspaceUsage![0]!.weighted, 14);
      assert.deepEqual(await engine.report(workspace, 1), report);
    }
    assert.equal((await engine.listReports(packRoot)).length, 4);
    assert.ok((await engine.listAttempts(packRoot)).every(attempt => attempt.submissions === 2));
  } finally {
    await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
