import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { gradePracticeTask, runPracticeTests } from '../src/grader.ts';
import { startPracticeTask } from '../src/tasks.ts';
import { SoloEngine } from '../src/solo.ts';
import { setTimeout as delay } from 'node:timers/promises';

const packs = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));

test('local grader runs hidden tests on a disposable copy without placing them in the student workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-grade-'));
  try {
    const { workspace } = await startPracticeTask(packs, 'dedupe-ids', join(root, 'sessions'));
    const python = process.env.FACTORYZE_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
    await writeFile(join(workspace, 'app', 'dedupe.py'),
      'def unique_ids(ids: list[str]) -> list[str]:\n    return []\n');
    const initial = await gradePracticeTask(packs, 'dedupe-ids', workspace, python);
    assert.deepEqual({ passed: initial.passed, total: initial.total }, { passed: 0, total: 2 });
    assert.deepEqual(initial.checks?.map(check => [check.name, check.passed]),
      [['test_duplicate_ids_keep_first_seen_order', false], ['test_ids_are_not_normalized', false]]);
    assert.match(initial.checks![0]!.message!, /^AssertionError/);
    await assert.rejects(access(join(workspace, 'tests', 'hidden', 'test_dedupe.py')));
    await writeFile(join(workspace, 'app', 'dedupe.py'),
      'def unique_ids(ids: list[str]) -> list[str]:\n    return list(dict.fromkeys(ids))\n');
    const fixed = await gradePracticeTask(packs, 'dedupe-ids', workspace, python);
    assert.deepEqual(fixed, { passed: 2, total: 2, checks: [
      { name: 'test_duplicate_ids_keep_first_seen_order', passed: true }, { name: 'test_ids_are_not_normalized', passed: true }] });
    assert.match(await readFile(join(workspace, 'app', 'dedupe.py'), 'utf8'), /dict\.fromkeys/);
    await assert.rejects(access(join(workspace, 'tests', 'hidden', 'test_dedupe.py')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local grader rejects missing hidden tests rather than reporting a perfect score', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-grade-empty-'));
  try {
    const { workspace } = await startPracticeTask(packs, 'dedupe-ids', join(root, 'sessions'));
    await assert.rejects(gradePracticeTask(root, 'dedupe-ids', workspace, 'python3'), /hidden tests/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public checks report actionable failures and pass after the workspace is fixed without exposing hidden checks', async () => {
  const python = process.env.FACTORYZE_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
  const root = mkdtempSync(join(tmpdir(), 'factoryze-public-checks-'));
  try {
    mkdirSync(join(root, 'tests')); mkdirSync(join(root, 'app'));
    writeFileSync(join(root, 'app', '__init__.py'), '');
    writeFileSync(join(root, 'app', 'example.py'), 'def answer():\n    return 1\n');
    writeFileSync(join(root, 'tests', 'test_public.py'), 'from app.example import answer\ndef test_answer():\n    assert answer() == 2, "Expected two"\n');
    const failed = await runPracticeTests(root, python);
    assert.equal(failed.passed, 0); assert.equal(failed.total, 1);
    assert.match(failed.failures[0].message, /Expected two/);
    assert.equal(failed.failures[0].name, 'test_answer');
    writeFileSync(join(root, 'app', 'example.py'), 'def answer():\n    return 2\n');
    const passed = await runPracticeTests(root, python);
    assert.deepEqual(passed, { passed: 1, total: 1, failures: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const python = process.env.FACTORYZE_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const timeoutChecks = 'def test_a_times_out():\n    while True:\n        pass\ndef test_z_still_runs():\n    assert True\n';

function timeoutTask() {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-check-timeout-'));
  const packRoot = join(root, 'packs'), task = join(packRoot, 'timeout-task');
  mkdirSync(join(task, 'tests', 'hidden'), { recursive: true });
  mkdirSync(join(task, 'workspace', 'tests'), { recursive: true });
  writeFileSync(join(task, 'task.yaml'), 'schema: 1\nid: timeout-task\ntitle: Timeout task\nbrief: Synthetic timeout regression\nminimumPython: "3.11"\n');
  writeFileSync(join(task, 'tests', 'hidden', 'test_checks.py'), timeoutChecks);
  writeFileSync(join(task, 'workspace', 'tests', 'test_public.py'), timeoutChecks);
  return { root, packRoot, task, workspace: join(task, 'workspace') };
}

test('hidden check timeouts fail by name and allow later checks to run', async () => {
  const task = timeoutTask();
  try {
    const result = await gradePracticeTask(task.packRoot, 'timeout-task', task.workspace, python,
      { checkTimeoutMs: 1000, runTimeoutMs: 15000 });
    assert.deepEqual(result, { passed: 1, total: 2, checks: [
      { name: 'test_a_times_out', passed: false, message: 'Timed out after 1 s' },
      { name: 'test_z_still_runs', passed: true },
    ] });
  } finally { rmSync(task.root, { recursive: true, force: true }); }
});

test('public check timeouts return named failures and allow later checks to run', async () => {
  const task = timeoutTask();
  try {
    const result = await runPracticeTests(task.workspace, python, { checkTimeoutMs: 1000, runTimeoutMs: 15000 });
    assert.deepEqual(result, { passed: 1, total: 2,
      failures: [{ name: 'test_a_times_out', message: 'Timed out after 1 s' }] });
  } finally { rmSync(task.root, { recursive: true, force: true }); }
});

test('the grading run limit reports every remaining check without executing it', async () => {
  const task = timeoutTask();
  const marker = join(task.root, 'should-not-run');
  try {
    writeFileSync(join(task.task, 'tests', 'hidden', 'test_checks.py'), timeoutChecks.replace(
      '    assert True', `    open(${JSON.stringify(marker)}, 'w').write('ran')`));
    const result = await gradePracticeTask(task.packRoot, 'timeout-task', task.workspace, python,
      { checkTimeoutMs: 10000, runTimeoutMs: 2000 });
    assert.equal(result.passed, 0); assert.equal(result.total, 2);
    assert.deepEqual(result.checks?.map(check => check.name), ['test_a_times_out', 'test_z_still_runs']);
    for (const check of result.checks!) {
      assert.equal(check.passed, false); assert.match(check.message!, /Timed out after 2 s.*run limit/);
    }
    await assert.rejects(access(marker));
  } finally { rmSync(task.root, { recursive: true, force: true }); }
});

test('an import timeout or exited check cannot prevent other test files from running', async () => {
  const task = timeoutTask();
  try {
    writeFileSync(join(task.task, 'tests', 'hidden', 'test_checks.py'), 'while True:\n    pass\n');
    writeFileSync(join(task.task, 'tests', 'hidden', 'test_more.py'),
      'import os\ndef test_a_exits():\n    os._exit(7)\ndef test_z_passes():\n    assert True\n');
    const result = await gradePracticeTask(task.packRoot, 'timeout-task', task.workspace, python,
      { checkTimeoutMs: 1000, runTimeoutMs: 15000 });
    assert.equal(result.passed, 1); assert.equal(result.total, 3);
    assert.deepEqual(result.checks?.map(check => [check.name, check.passed]),
      [['test_checks.py', false], ['test_a_exits', false], ['test_z_passes', true]]);
    assert.equal(result.checks![0]!.message, 'Timed out after 1 s');
    assert.match(result.checks![1]!.message!, /Python.*exit/i);
  } finally { rmSync(task.root, { recursive: true, force: true }); }
});

test('a check timeout stops its child processes before grading returns', async () => {
  const task = timeoutTask();
  const heartbeat = join(task.root, 'child-heartbeat');
  try {
    const child = `import time\nwhile True:\n    open(${JSON.stringify(heartbeat)}, 'w').write(str(time.time_ns()))\n    time.sleep(0.02)\n`;
    writeFileSync(join(task.task, 'tests', 'hidden', 'test_checks.py'),
      `import subprocess, sys\ndef test_a_times_out():\n    subprocess.Popen([sys.executable, '-I', '-c', ${JSON.stringify(child)}])\n    while True:\n        pass\ndef test_z_still_runs():\n    assert True\n`);
    const result = await gradePracticeTask(task.packRoot, 'timeout-task', task.workspace, python,
      { checkTimeoutMs: 1500, runTimeoutMs: 15000 });
    assert.deepEqual({ passed: result.passed, total: result.total }, { passed: 1, total: 2 });
    const stopped = await readFile(heartbeat, 'utf8');
    await delay(150);
    assert.equal(await readFile(heartbeat, 'utf8'), stopped);
  } finally { rmSync(task.root, { recursive: true, force: true }); }
});

test('submission saves a report with a timed-out hidden check and retains it after restart', async () => {
  const task = timeoutTask();
  const options = { dataDir: join(task.root, 'data'), userId: 'synthetic-timeout-user', preparePython: async () => {},
    grade: (packRoot: string, id: string, workspace: string) => gradePracticeTask(packRoot, id, workspace, python,
      { checkTimeoutMs: 1000, runTimeoutMs: 15000 }) };
  let engine = new SoloEngine(options);
  try {
    const { workspace } = await engine.startTask(task.packRoot, 'timeout-task', join(task.root, 'attempts'));
    const report = await engine.submitTask(task.packRoot, workspace);
    assert.deepEqual(report.correctness, { passed: 1, total: 2 });
    assert.deepEqual(report.checks, [
      { name: 'test_a_times_out', passed: false, message: 'Timed out after 1 s' },
      { name: 'test_z_still_runs', passed: true },
    ]);
    assert.deepEqual(await engine.latestReport(workspace), report);
    await engine.close(); engine = new SoloEngine(options);
    assert.deepEqual(await engine.latestReport(workspace), report);
  } finally { await engine.close(); rmSync(task.root, { recursive: true, force: true }); }
});
