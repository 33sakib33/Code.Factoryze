import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PracticeReport } from '@factoryze/protocol';
import { SoloEngine, SOLO_PROFILE } from '../src/solo.ts';
import { hostedResultFacts, resultWeightedTokens, solutionFiles, type HostedAttempt } from '../src/hosted-results.ts';
import { weightedTokens } from '../src/meter.ts';

const manifest = 'schema: 1\nid: hosted-task\ntitle: Hosted task\nbrief: Fix it.\nminimumPython: "3.11"\nbudgetTokens: 20000\n';
const files: Record<string, string> = { 'task.yaml': manifest, 'workspace/app.py': 'def answer():\n    return 1\n',
  'workspace/tests/test_public.py': 'def test_public(): pass\n', 'tests/hidden/test_hidden.py': 'def test_hidden(): pass\n' };
async function pack(root: string): Promise<string> {
  const source = join(root, 'source');
  for (const [path, value] of Object.entries(files)) { await mkdir(join(source, path, '..'), { recursive: true }); await writeFile(join(source, path), value); }
  return source;
}

const attempt: HostedAttempt = { attemptId: '8a6e0804-2bd0-4672-b79e-d4cb1a7d1abf', workspace: '/w', taskId: 'hosted-task', packSha256: 'a'.repeat(64),
  archiveBytes: 100, budgetTokens: 20000, tests: { digest: 'b'.repeat(64), publicFiles: [] }, results: {} };
const usage = (model: string, over: Partial<NonNullable<PracticeReport['workspaceUsage']>[number]> = {}) => ({
  scope: { userId: 'u', taskId: 'hosted-task', profile: SOLO_PROFILE, model }, raw: { input: 9000, output: 4000, cacheRead: 1000, cacheWrite: 0 },
  weighted: 12100, requests: 3, incompleteRequests: 0, ...over });
const pin = (model: string, funding?: 'trial' | 'byok') => ({ profile: SOLO_PROFILE, model, ...(funding ? { funding } : {}), providerHost: 'code.factoryze.tech', temperature: null, os: 'darwin' as const });
const report = (over: Partial<PracticeReport> = {}): PracticeReport => ({ schema: 1, kind: 'practice', taskId: 'hosted-task', submittedAt: '2026-11-20T10:00:00.000Z',
  correctness: { passed: 6, total: 6 }, usage: [], workspaceUsage: [usage('trial-coder')], executionPins: [pin('trial-coder', 'trial')], ...over });

test('the result body is built from the saved report and the hosted record, with no rank, score or solved flag', () => {
  const { payload, ineligible, facts } = hostedResultFacts(attempt, report());
  assert.equal(ineligible, undefined);
  assert.deepEqual(payload, { attemptId: attempt.attemptId, taskId: 'hosted-task', packSha256: 'a'.repeat(64), funding: 'hosted', model: 'trial-coder',
    budgetTokens: 20000, weightedTokens: 12100, usage: { inputTokens: 9000, cachedInputTokens: 1000, outputTokens: 4000 },
    passed: 6, total: 6, submittedAt: '2026-11-20T10:00:00.000Z' });
  assert.equal(facts.weightedTokens, 12100);
  const sent = payload!.usage;
  assert.equal(payload!.weightedTokens, Math.ceil(sent.inputTokens + sent.outputTokens - 0.9 * sent.cachedInputTokens), 'Weighted tokens follow the service formula on the sent usage');
  assert.equal(resultWeightedTokens({ input: 9000, output: 4000, cacheRead: 1000 }), weightedTokens({ input: 9000, output: 4000, cacheRead: 1000, cacheWrite: 0 }, { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 }));
  const odd = hostedResultFacts(attempt, report({ workspaceUsage: [usage('trial-coder', { raw: { input: 9001, output: 4000, cacheRead: 1001, cacheWrite: 0 }, weighted: 12100.1 })] }));
  assert.equal(odd.payload?.weightedTokens, 12101, 'Fractional weighted tokens round up');
  assert.match(hostedResultFacts(attempt, report({ workspaceUsage: [usage('trial-coder', { weighted: 13000 })] })).ineligible!, /different token weights/);
  assert.equal(hostedResultFacts(attempt, report({ executionPins: [pin('trial-coder')] })).payload?.funding, 'own_key', 'Pins without trial funding are own-key results');
  assert.equal(hostedResultFacts(attempt, report({ budget: { limit: 90000, initialLimit: 20000 } })).payload?.budgetTokens, 20000, 'A raised local budget never changes the task budget sent');
});

test('attempts that cannot be described by one model and funding source are not sent', () => {
  const cases: [Partial<PracticeReport>, RegExp][] = [
    [{ workspaceUsage: [] }, /no model requests/i],
    [{ workspaceUsage: [usage('trial-coder', { incompleteRequests: 1 })] }, /incomplete/i],
    [{ workspaceUsage: [usage('trial-coder'), usage('other')], executionPins: [pin('trial-coder', 'trial'), pin('other')] }, /more than one model/i],
    [{ executionPins: [pin('trial-coder', 'trial'), pin('trial-coder', 'byok')] }, /mixed/i],
    [{ executionPins: undefined }, /not recorded/i],
    [{ workspaceUsage: [usage('bad model id')], executionPins: [pin('bad model id')] }, /cannot be sent/i],
    [{ lab: { id: 'lab', studentId: 's', submissionId: 'x', snapshotHash: 'c'.repeat(64), revision: 0, releasedAt: '2026-11-20T10:00:00.000Z' } }, /lab/i],
  ];
  for (const [over, reason] of cases) {
    const result = hostedResultFacts(attempt, report(over));
    assert.equal(result.payload, undefined); assert.match(result.ineligible!, reason);
  }
});

test('solution files are only changed or added text files outside dot paths and caches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-solution-'));
  try {
    const starter = join(root, 'starter'), workspace = join(root, 'workspace');
    await mkdir(join(starter, 'tests'), { recursive: true }); await mkdir(join(workspace, 'tests'), { recursive: true });
    await writeFile(join(starter, 'app.py'), 'old'); await writeFile(join(workspace, 'app.py'), 'new');
    await writeFile(join(starter, 'same.py'), 'same'); await writeFile(join(workspace, 'same.py'), 'same');
    await writeFile(join(workspace, 'tests/test_new.py'), 'def test_new(): pass\n');
    await writeFile(join(workspace, '.env'), 'SECRET=never-read');
    await mkdir(join(workspace, '.venv')); await writeFile(join(workspace, '.venv/pip.conf'), 'x');
    await mkdir(join(workspace, '__pycache__')); await writeFile(join(workspace, '__pycache__/app.pyc'), 'x');
    await writeFile(join(workspace, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x00]));
    assert.deepEqual(await solutionFiles(starter, workspace), [{ path: 'app.py', content: 'new' }, { path: 'tests/test_new.py', content: 'def test_new(): pass\n' }]);
    await writeFile(join(workspace, 'large.py'), 'x'.repeat(65 * 1024));
    assert.equal(await solutionFiles(starter, workspace), null, 'Over the service limits, no partial solution is offered');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only attempts started from a verified hosted download carry a record, and edits are detected before grading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-hosted-engine-'));
  const engine = new SoloEngine({ dataDir: join(root, 'data'), userId: 'u', preparePython: async () => {}, grade: async () => ({ passed: 1, total: 1 }) });
  try {
    const source = await pack(root);
    const bundled = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'library-fines', join(root, 'workspaces'));
    assert.equal(await engine.hostedAttempt(bundled.workspace), undefined, 'Repo sample tasks never have a hosted record');
    const imported = await engine.importTask(source, join(root, 'workspaces'));
    assert.equal(await engine.hostedAttempt(imported.workspace), undefined, 'A locally opened task ZIP or folder is not hosted');

    const started = await engine.startHostedTask(source, join(root, 'workspaces'), { sha256: 'a'.repeat(64), archiveBytes: 321 });
    const record = await engine.hostedAttempt(started.workspace);
    assert.equal(record?.packSha256, 'a'.repeat(64)); assert.equal(record?.budgetTokens, 20000);
    assert.equal(await engine.hostedTestFiles(started.workspace), 'unchanged');
    await writeFile(join(started.workspace, 'tests/test_public.py'), 'def test_public(): assert True\n');
    assert.equal(await engine.hostedTestFiles(started.workspace), 'edited');
    await engine.restoreHostedTests(started.workspace, source);
    assert.equal(await engine.hostedTestFiles(started.workspace), 'unchanged');

    await engine.submitTask(join(process.cwd(), 'tasks/practice'), started.workspace);
    assert.equal(await engine.submissionCount(started.workspace), 1);
    const plan = await engine.hostedResultPlan(started.workspace, await engine.report(started.workspace, 1), true);
    assert.match(plan.ineligible!, /no model requests/i);
    assert.equal(plan.payload, undefined, 'No consent prompt can read files for an ineligible result');
  } finally { await engine.close(); await rm(root, { recursive: true, force: true }); }
});
