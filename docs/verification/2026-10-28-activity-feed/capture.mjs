// Reproduce the task's grader evidence with Node 24; no network or model calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradePracticeTask, runPracticeTests } from '../../../packages/engine/src/grader.ts';
import { importTaskPack } from '../../../packages/engine/src/task-import.ts';
import { startPracticeTask } from '../../../packages/engine/src/tasks.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pack = join(repo, 'tasks/benchmark/activity-feed');
const destination = fileURLToPath(new URL('./', import.meta.url));
const python = process.env.FACTORYZE_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const files = [];
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.name === '__pycache__' || item.name.endsWith('.pyc')) continue;
    const file = join(path, item.name);
    if (item.isDirectory()) await walk(file);
    else files.push(file);
  }
}
await walk(pack);
// The task format requires LF endings; only this new pack is normalized.
for (const path of files) {
  const text = await readFile(path, 'utf8');
  if (text.includes('\r')) await writeFile(path, text.replaceAll('\r\n', '\n'));
}
const root = await mkdtemp(join(tmpdir(), 'factoryze-feed-audit-'));
const queryCounts = workspace => JSON.parse(execFileSync(python, ['-I', '-c', `
import json, runpy, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
checks = runpy.run_path(sys.argv[2])
out = {}
for label, kwargs, limit in [
    ('distinct100', {'member_count':100,'entry_count':100},100),
    ('repeated100', {'member_count':1,'entry_count':100,'repeated':True},100),
    ('missing100', {'member_count':0,'entry_count':100,'missing':True},100),
    ('distinct901', {'member_count':901,'entry_count':901},901),
]:
    db = checks['database'](**kwargs)
    try:
        rows, reads = checks['measured'](db, limit)
        out[label] = {'entries':len(rows),'sqlReads':len(reads)}
    finally:
        db.close()
print(json.dumps(out))
`, workspace, join(pack, 'tests/hidden/test_feed.py')], { encoding: 'utf8', windowsHide: true }));
try {
  const imported = await importTaskPack(pack, join(root, 'imports'));
  const { workspace } = await startPracticeTask(imported.packRoot, 'activity-feed', join(root, 'sessions'));
  const starter = { public: await runPracticeTests(workspace, python),
    hidden: await gradePracticeTask(imported.packRoot, 'activity-feed', workspace, python),
    measurements: queryCounts(workspace) };
  await copyFile(join(pack, 'reference/feed.py'), join(workspace, 'feed/feed.py'));
  const reference = { public: await runPracticeTests(workspace, python),
    hidden: await gradePracticeTask(imported.packRoot, 'activity-feed', workspace, python),
    measurements: queryCounts(workspace) };
  assert.equal(starter.public.passed, 6); assert.equal(starter.hidden.passed, 8);
  assert.equal(reference.public.passed, 6); assert.equal(reference.hidden.passed, 12);
  files.push(join(repo, 'packages/engine/test/activity-feed.test.ts'), fileURLToPath(import.meta.url));
  const sources = [];
  for (const path of files.sort()) sources.push({ path: relative(repo, path).replaceAll('\\', '/'),
    sha256: createHash('sha256').update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n')).digest('hex') });
  const fullLog = await readFile(join(destination, 'full-tests.log'), 'utf8');
  const full = key => Number(fullLog.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1]);
  const receipt = { date: '2026-10-28', timezone: 'Asia/Dhaka', capturedAtUtc: new Date().toISOString(),
    taskId: 'activity-feed', status: 'deterministic-content-verified-not-promoted',
    node: process.version, python: execFileSync(python, ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform, paidModelCalls: 0, externalEmails: 0, dockerUsed: false,
    starter, reference,
    integration: { finalFocusedTests: 2, passed: 2, log: 'content-tests-final.log',
      covers: ['immutable task-folder import', 'private material excluded from student workspace',
        'starter public/hidden and reference public/hidden',
        'mutation rejection: stale cache, workspace leak, dropped rows, reordered rows'] },
    fullSuite: { tests: full('tests'), pass: full('pass'), fail: full('fail'), skipped: full('skipped'),
      command: 'pnpm@10.28.2 run test --test-concurrency=4', log: 'full-tests.log',
      limitations: ['Two unchanged Windows symlink EPERM failures: harness-tools.test.ts and task-import.test.ts'] },
    typecheck: { passed: true, log: 'typecheck.log' }, publicUnittest: { passed: 6, log: 'public-unittest.log' },
    developmentCorrections: [
      'System Node was too old for strip-types/test; used bundled Node 24.22.1.',
      'Initial test failed because the task did not exist, then an accidental shadowed-variable assertion was corrected.',
      'Initial pnpm test invocation rejected an option before tests ran; reran through pinned pnpm run test. Raw command error retained.',
      'Automatic approval review blocked deletion of generated Python caches as blocked by policy; caches remain locally and are Git-ignored.'
    ],
    scope: { bundledCatalogChanged: false, appCodeChanged: false, sourceHashEncoding: 'UTF-8 with LF endings',
      preExistingEditsExcluded: ['INSTALL.md', 'packages/app/package.json'] },
    remaining: ['Model measurements and promotion review with separately approved spending',
      'No efficiency baseline or validated skill-separation claim', 'Sandbox measurements deferred with Docker'], sources };
  assert.equal(receipt.fullSuite.tests, 199); assert.equal(receipt.fullSuite.pass, 197);
  assert.equal(receipt.fullSuite.fail, 2);
  await writeFile(join(destination, 'checks.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, starter: starter.measurements,
    reference: reference.measurements, fullSuite: receipt.fullSuite }));
} finally { await rm(root, { recursive: true, force: true }); }
