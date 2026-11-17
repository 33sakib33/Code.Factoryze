import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradePracticeTask, runPracticeTests } from '../src/grader.ts';
import { importTaskPack } from '../src/task-import.ts';
import { preparePythonEnvironment } from '../src/python.ts';
import { listPracticeTasks, loadBenchmarkPrompts, startPracticeTask } from '../src/tasks.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packs = join(repo, 'tasks', 'practice');
const args = process.argv.slice(2);

function usage() {
  console.log('Usage: pnpm problem:check TASK_ID [--solution PATH_TO_FIXED_WORKSPACE]');
  console.log('       pnpm problem:check --all');
  console.log('Checks pack import, optional benchmark prompts, public tests and hidden checks without model calls.');
}

async function check(id, solution) {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-problem-check-'));
  try {
    const source = join(packs, id);
    const imported = await importTaskPack(source, join(root, 'imported'));
    assert.equal(imported.task.id, id, 'Folder and task.yaml IDs must match');
    assert.ok(imported.task.entryFile, 'Bundled practice problems need entryFile in task.yaml');
    const promptFile = join(source, 'prompts', 'benchmark.yaml');
    if (await stat(promptFile).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    })) await loadBenchmarkPrompts(packs, id);

    const environment = await preparePythonEnvironment(root, imported.task.minimumPython);
    const python = join(environment.venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const { workspace } = await startPracticeTask(imported.packRoot, id, join(root, 'attempts'));
    const publicResult = await runPracticeTests(workspace, python);
    assert.equal(publicResult.passed, publicResult.total, 'Public tests must pass on the starter');
    const hiddenResult = await gradePracticeTask(imported.packRoot, id, workspace, python);
    assert.ok(hiddenResult.passed < hiddenResult.total, 'The starter must fail at least one hidden check');
    console.log(`${id}: public ${publicResult.passed}/${publicResult.total}, hidden ${hiddenResult.passed}/${hiddenResult.total} (starter)`);

    if (solution) {
      const fixed = resolve(solution);
      assert.ok((await lstat(fixed)).isDirectory(), 'The solution path must be a workspace directory');
      const verified = join(root, 'fixed-workspace');
      await cp(fixed, verified, { recursive: true, filter: path => !['.venv', '.git', 'node_modules', '__pycache__'].includes(basename(path)) });
      const fixedPublic = await runPracticeTests(verified, python);
      const fixedHidden = await gradePracticeTask(imported.packRoot, id, verified, python);
      assert.equal(fixedPublic.passed, fixedPublic.total, 'The corrected workspace must pass public tests');
      assert.equal(fixedHidden.passed, fixedHidden.total, 'The corrected workspace must pass hidden checks');
      console.log(`${id}: public ${fixedPublic.passed}/${fixedPublic.total}, hidden ${fixedHidden.passed}/${fixedHidden.total} (solution)`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}

try {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    usage();
    if (args.length === 0) process.exitCode = 1;
  } else if (args.length === 1 && args[0] === '--all') {
    for (const task of await listPracticeTasks(packs)) await check(task.id);
  } else if (/^[a-z][a-z0-9-]*$/.test(args[0] ?? '') && (args.length === 1 || (args.length === 3 && args[1] === '--solution'))) {
    await check(args[0], args[2]);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Problem check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
