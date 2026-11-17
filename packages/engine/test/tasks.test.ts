import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { listPracticeTasks, loadBenchmarkPrompts, startPracticeTask } from '../src/tasks.ts';
import { benchmarkPromptsHash } from '../src/baseline.ts';

test('practice task loader validates metadata and copies only starter files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-tasks-'));
  try {
    const packs = join(root, 'packs');
    const pack = join(packs, 'pagination-api');
    await mkdir(join(pack, 'workspace'), { recursive: true });
    await mkdir(join(pack, 'tests', 'hidden'), { recursive: true });
    await writeFile(join(pack, 'task.yaml'), 'schema: 1\nid: pagination-api\ntitle: Pagination API\nbrief: Fix the missing last page.\nminimumPython: "3.11"\n');
    await writeFile(join(pack, 'workspace', 'orders.py'), 'def page(): pass\n');
    await writeFile(join(pack, 'tests', 'hidden', 'test_secret.py'), 'assert False\n');

    const tasks = await listPracticeTasks(packs);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'Pagination API');
    const first = await startPracticeTask(packs, 'pagination-api', join(root, 'sessions'));
    const second = await startPracticeTask(packs, 'pagination-api', join(root, 'sessions'));
    assert.notEqual(first.workspace, second.workspace);
    assert.equal(await readFile(join(first.workspace, 'orders.py'), 'utf8'), 'def page(): pass\n');
    await assert.rejects(readFile(join(first.workspace, 'tests', 'hidden', 'test_secret.py')));
    await assert.rejects(startPracticeTask(packs, '../outside', join(root, 'sessions')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('practice task removes a partial workspace when setup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-task-setup-'));
  try {
    const packs = join(root, 'packs');
    const pack = join(packs, 'dedupe-ids');
    const sessions = join(root, 'sessions');
    await mkdir(join(pack, 'workspace'), { recursive: true });
    await writeFile(join(pack, 'task.yaml'), 'schema: 1\nid: dedupe-ids\ntitle: Dedupe IDs\nbrief: Preserve order.\nminimumPython: "3.11"\n');
    await writeFile(join(pack, 'workspace', 'main.py'), 'pass\n');
    await assert.rejects(startPracticeTask(packs, 'dedupe-ids', sessions, async workspace => {
      await writeFile(join(workspace, 'partial'), 'temporary');
      throw new Error('Python setup failed');
    }), /Python setup failed/);
    assert.deepEqual(await readdir(sessions), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('practice task loader rejects invalid metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-invalid-task-'));
  try {
    const pack = join(root, 'bad-task');
    await mkdir(join(pack, 'workspace'), { recursive: true });
    await writeFile(join(pack, 'task.yaml'), 'schema: 2\nid: bad-task\ntitle: Bad\nbrief: Invalid schema.\nminimumPython: "3.11"\n');
    await assert.rejects(listPracticeTasks(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundled practice catalog contains the active Python tasks', async () => {
  const root = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const tasks = await listPracticeTasks(root);
  assert.deepEqual(tasks.map(task => task.id), ['library-fines', 'monthly-revenue', 'proc-stat-parser', 'retry-storm', 'webhook-allowlist']);
  assert.ok(tasks.every(task => task.minimumPython === '3.11'));
  assert.deepEqual(tasks.find(task => task.id === 'retry-storm')?.topics, ['sre', 'reliability']);
  assert.deepEqual(tasks.find(task => task.id === 'webhook-allowlist')?.topics, ['security', 'backend']);
  assert.deepEqual(tasks.find(task => task.id === 'proc-stat-parser')?.topics, ['linux', 'observability']);
  const all = await listPracticeTasks(root, { includeRetired: true });
  assert.deepEqual(all.map(task => [task.id, task.retired === true]),
    [['dedupe-ids', true], ['library-fines', false], ['monthly-revenue', false], ['pagination-api', true], ['proc-stat-parser', false], ['retry-storm', false], ['webhook-allowlist', false]]);
});

test('retired tasks stay loadable for existing attempts while hidden from the practice catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-retired-task-'));
  try {
    const pack = join(root, 'packs', 'old-task');
    await mkdir(join(pack, 'workspace'), { recursive: true });
    await writeFile(join(pack, 'task.yaml'), 'schema: 1\nid: old-task\ntitle: Old task\nbrief: Keep attempts.\nminimumPython: "3.11"\nretired: true\n');
    await writeFile(join(pack, 'workspace', 'main.py'), 'answer = 1\n');
    assert.deepEqual(await listPracticeTasks(join(root, 'packs')), []);
    assert.equal((await listPracticeTasks(join(root, 'packs'), { includeRetired: true }))[0]!.id, 'old-task');
    const attempt = await startPracticeTask(join(root, 'packs'), 'old-task', join(root, 'attempts'));
    assert.equal(attempt.task.retired, true);
    assert.equal(await readFile(join(attempt.workspace, 'main.py'), 'utf8'), 'answer = 1\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('benchmark prompts validate against the task and stay outside student workspaces', async () => {
  const root = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  for (const taskId of ['dedupe-ids', 'library-fines', 'monthly-revenue', 'pagination-api']) {
    const prompts = await loadBenchmarkPrompts(root, taskId);
    assert.equal(prompts.taskId, taskId);
    assert.ok(prompts.expert.length > 0);
    assert.ok(prompts.naive.length > 0);
    if (['library-fines', 'monthly-revenue'].includes(taskId)) assert.ok(prompts.middle?.length);
    assert.ok(prompts.expert.every(prompt => prompt.trim() === prompt));
    const sessionRoot = await mkdtemp(join(tmpdir(), 'factoryze-bench-'));
    try {
      const { workspace } = await startPracticeTask(root, taskId, sessionRoot);
      await assert.rejects(readFile(join(workspace, 'prompts', 'benchmark.yaml')));
    } finally { await rm(sessionRoot, { recursive: true, force: true }); }
  }
});

test('benchmark prompt loader rejects missing, mismatched and empty scenarios', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-bench-invalid-'));
  try {
    const pack = join(root, 'dedupe-ids');
    await mkdir(join(pack, 'prompts'), { recursive: true });
    await assert.rejects(loadBenchmarkPrompts(root, 'dedupe-ids'));
    await writeFile(join(pack, 'prompts', 'benchmark.yaml'), 'schema: 1\ntaskId: other-task\nexpert: ["Check code"]\nnaive: ["Fix it"]\n');
    await assert.rejects(loadBenchmarkPrompts(root, 'dedupe-ids'), /task/i);
    await writeFile(join(pack, 'prompts', 'benchmark.yaml'), 'schema: 1\ntaskId: dedupe-ids\nexpert: []\nnaive: ["Fix it"]\n');
    await assert.rejects(loadBenchmarkPrompts(root, 'dedupe-ids'));
    await writeFile(join(pack, 'prompts', 'benchmark.yaml'), 'schema: 1\ntaskId: dedupe-ids\nexpert: ["Check code"]\nnaive: ["Fix it"]\nmiddle: []\n');
    await assert.rejects(loadBenchmarkPrompts(root, 'dedupe-ids'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('benchmark prompts may add an optional middle scenario without changing existing prompt hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-bench-middle-'));
  try {
    const pack = join(root, 'dedupe-ids');
    await mkdir(join(pack, 'prompts'), { recursive: true });
    await writeFile(join(pack, 'prompts', 'benchmark.yaml'), 'schema: 1\ntaskId: dedupe-ids\nexpert: ["Check code"]\nnaive: ["Fix it"]\n');
    const twoScenarios = await loadBenchmarkPrompts(root, 'dedupe-ids');
    assert.equal('middle' in twoScenarios, false);
    assert.equal(benchmarkPromptsHash(twoScenarios), benchmarkPromptsHash({ schema: 1, taskId: 'dedupe-ids', expert: ['Check code'], naive: ['Fix it'] }));
    await writeFile(join(pack, 'prompts', 'benchmark.yaml'), 'schema: 1\ntaskId: dedupe-ids\nexpert: ["Check code"]\nmiddle: ["Look for shared state"]\nnaive: ["Fix it"]\n');
    assert.deepEqual((await loadBenchmarkPrompts(root, 'dedupe-ids')).middle, ['Look for shared state']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
