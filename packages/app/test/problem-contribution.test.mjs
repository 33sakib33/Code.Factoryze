import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { verifyPracticeTaskResources } from '../scripts/verify-task-resources.mjs';

test('a new practice problem can join the bundled catalog without benchmark prompts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-problem-contribution-'));
  const packs = join(root, 'practice');
  try {
    await cp(resolve('tasks/practice'), packs, { recursive: true });
    const problem = join(packs, 'sample-problem');
    await mkdir(join(problem, 'workspace', 'tests'), { recursive: true });
    await mkdir(join(problem, 'tests', 'hidden'), { recursive: true });
    await writeFile(join(problem, 'task.yaml'), 'schema: 1\nid: sample-problem\ntitle: Sample problem\nbrief: Fix the answer.\nminimumPython: "3.11"\nentryFile: answer.py\n');
    await writeFile(join(problem, 'workspace', 'answer.py'), 'def answer():\n    return 0\n');
    await writeFile(join(problem, 'workspace', 'tests', 'test_public.py'), 'def test_answer():\n    assert True\n');
    await writeFile(join(problem, 'tests', 'hidden', 'test_answer.py'), 'def test_answer():\n    assert True\n');
    await verifyPracticeTaskResources(packs);
    await rm(join(problem, 'tests', 'hidden', 'test_answer.py'));
    await assert.rejects(verifyPracticeTaskResources(packs), /hidden grader/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
