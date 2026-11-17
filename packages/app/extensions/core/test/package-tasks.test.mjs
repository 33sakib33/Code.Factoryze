import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyPracticeTaskResources } from '../../../scripts/verify-task-resources.mjs';

const packs = fileURLToPath(new URL('../../../../../tasks/practice/', import.meta.url));

test('packaged task verification accepts the promoted catalog without requiring OpenCode baselines', async () => {
  await verifyPracticeTaskResources(packs);
});

test('packaged task verification requires retired graders and active tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-package-tasks-'));
  try {
    await cp(packs, root, { recursive: true });
    await rm(join(root, 'dedupe-ids', 'tests', 'hidden'), { recursive: true });
    await assert.rejects(verifyPracticeTaskResources(root), /hidden|ENOENT/);
    await cp(join(packs, 'dedupe-ids', 'tests'), join(root, 'dedupe-ids', 'tests'), { recursive: true });
    const file = join(root, 'library-fines', 'task.yaml');
    await writeFile(file, (await readFile(file, 'utf8')) + '\nretired: true\n');
    await assert.rejects(verifyPracticeTaskResources(root), /Active practice task is missing: library-fines/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
