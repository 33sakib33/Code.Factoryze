import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { listPracticeTasks, loadBenchmarkPrompts } from '../../engine/src/tasks.ts';

export async function verifyPracticeTaskResources(packRoot) {
  const tasks = await listPracticeTasks(packRoot, { includeRetired: true });
  for (const id of ['delivery-fee', 'duplicate-customers', 'latency-report', 'library-fines', 'login-lockout', 'monthly-revenue', 'proc-stat-parser', 'retry-storm', 'webhook-allowlist']) {
    assert.ok(tasks.some(task => task.id === id && !task.retired), `Active practice task is missing: ${id}`);
  }
  for (const id of ['dedupe-ids', 'pagination-api']) {
    assert.equal(tasks.find(task => task.id === id)?.retired, true, `Retired task must remain bundled: ${id}`);
  }
  for (const task of tasks) {
    assert.ok(task.entryFile, `Bundled task needs an entryFile: ${task.id}`);
    assert.ok((await stat(join(packRoot, task.id, 'workspace', task.entryFile))).isFile());
    const publicTests = join(packRoot, task.id, 'workspace', 'tests');
    assert.ok((await readdir(publicTests)).some(file => /^test_.*\.py$/.test(file)), `Missing public tests for ${task.id}`);
    const hidden = join(packRoot, task.id, 'tests', 'hidden');
    assert.ok((await readdir(hidden)).some(file => /^test_.*\.py$/.test(file)), `Missing hidden grader for ${task.id}`);
    const benchmark = join(packRoot, task.id, 'prompts', 'benchmark.yaml');
    const benchmarkFile = await stat(benchmark).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (benchmarkFile) {
      assert.ok(benchmarkFile.isFile(), `Invalid benchmark prompts for ${task.id}`);
      await loadBenchmarkPrompts(packRoot, task.id);
    }
  }
}
