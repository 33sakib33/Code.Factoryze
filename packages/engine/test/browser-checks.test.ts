import assert from 'node:assert/strict';
import test from 'node:test';
import {browserCheckJobSchema, browserCheckResultSchema} from '@factoryze/protocol';
import {browserCheckInputHash, createBrowserChecker} from '../src/browser-checks.ts';
import {DockerExecutionError} from '../src/docker-executor.ts';
import {readBrowserCheckJob} from '../src/browser-check-input.ts';
import {spawnSync} from 'node:child_process';

const image = 'sha256:' + 'a'.repeat(64);
const makeJob = () => {
  const input = {schema: 1 as const, kind: 'public_checks' as const, jobId: 'a'.repeat(24), attemptId: 'b'.repeat(24),
    revision: 3, archiveHash: 'c'.repeat(64), image, minimumPython: '3.11',
    files: [{path: 'main.py', content: 'def answer(): return 42\n'}],
    publicChecks: [{path: 'tests/test_main.py', content: 'from main import answer\ndef test_answer(): assert answer() == 42\n'}]};
  return {...input, inputHash: browserCheckInputHash(input)};
};
const discovery = {stdout: JSON.stringify({checks: [{file: 'tests/test_main.py', name: 'test_answer'}]}), exitCode: 0, oomKilled: false};

test('browser check contract bounds files and rejects execution options, path aliases, invalid text and forged rewards', () => {
  const job = makeJob();
  // Independently calculated with Python's hashlib and UTF-8 length framing.
  assert.equal(job.inputHash, 'b795bc93c76feb920b6e1f51ce7d61dfb9b956ef7ed9c4b800f78e72d9ca0cf4');
  assert.equal(browserCheckJobSchema.parse(job).revision, 3);
  assert.equal(browserCheckJobSchema.parse({...job, revision: 0}).revision, 0);
  const invalid: unknown[] = [{...job, argv: ['sh']}, {...job, files: [{path: '../main.py', content: ''}]},
    {...job, files: [{path: 'main.py', content: '\ud800'}]}, {...job, files: [{path: 'main.py', content: '\0'}]},
    {...job, files: [{path: 'Main.py', content: ''}, {path: 'main.py', content: ''}]},
    {...job, files: [{path: 'a', content: ''}, {path: 'a/b.py', content: ''}]},
    {...job, files: [{path: 'main.py', content: 'é'.repeat(32769)}]},
    {...job, publicChecks: [{path: 'private/test_hidden.py', content: ''}]}, {...job, image: 'python:latest'}];
  for (const input of invalid) assert.equal(browserCheckJobSchema.safeParse(input).success, false);
  assert.equal(browserCheckResultSchema.safeParse({rewardEligible: true, xp: 100}).success, false);
});

test('checker binds the immutable input and image before executing; hashes ignore file order but include revision and tests', async () => {
  let calls = 0;
  const checker = createBrowserChecker({image, run: async () => {calls++; return discovery;}}, {python: '3.13.0'});
  const job = makeJob();
  await assert.rejects(checker({...job, files: [{path: 'main.py', content: 'changed'}]}), /hash/i);
  await assert.rejects(checker({...job, image: 'sha256:' + 'd'.repeat(64)}), /image/i);
  assert.equal(calls, 0);
  assert.notEqual(browserCheckInputHash({...job, revision: 4}), job.inputHash);
  assert.notEqual(browserCheckInputHash({...job, publicChecks: [{path: 'tests/test_main.py', content: 'changed'}]}), job.inputHash);
  const files = [...job.files, {path: 'extra.py', content: 'é\n'}];
  assert.equal(browserCheckInputHash({...job, files}), browserCheckInputHash({...job, files: files.reverse()}));
});

test('checker uses fixed commands and separate trusted tests, returns practice evidence without code or raw output', async () => {
  const runs: any[] = [];
  const checker = createBrowserChecker({image, run: async input => {runs.push(input); return input.argv.includes('discover') ? discovery :
    {stdout: '{"passed":true}', exitCode: 0, oomKilled: false};}}, {python: '3.13.0'});
  const job = makeJob(), result = await checker(job);
  assert.equal(result.status, 'completed');
  assert.equal(result.passed, 1); assert.equal(result.total, 1);
  assert.equal(result.rewardEligible, false); assert.equal(result.trust, 'practice');
  assert.equal(result.inputHash, job.inputHash); assert.equal(result.revision, 3);
  assert.equal(result.checks[0]?.name, 'tests/test_main.py::test_answer');
  assert.ok(runs.every(input => input.argv.slice(0, 3).join(' ') === 'python -I /opt/factoryze/runner.py'));
  assert.equal(Buffer.from(runs[0].hidden[0].data, 'base64').toString(), job.publicChecks[0].content);
  assert.doesNotMatch(JSON.stringify(result), /def answer|stdout|content/);
  assert.equal(browserCheckResultSchema.safeParse({...result, passed: 0}).success, false);
});

test('timeout, output overflow and memory exhaustion are bounded check failures; infrastructure and cleanup failures are job failures', async () => {
  for (const kind of ['timeout', 'output-limit', 'cleanup', 'unavailable'] as const) {
    const checker = createBrowserChecker({image, run: async input => {
      if (input.argv.includes('discover')) return discovery;
      throw new DockerExecutionError(kind, 'sensitive daemon path and synthetic secret');
    }}, {python: '3.13.0'});
    const result = await checker(makeJob());
    assert.equal(result.status, ['timeout', 'output-limit'].includes(kind) ? 'completed' : 'failed');
    assert.equal(result.passed, 0);
    assert.doesNotMatch(JSON.stringify(result), /sensitive|synthetic secret/);
  }
  for (const output of [{stdout: '{"passed":true}', exitCode: 0, oomKilled: true},
    {stdout: '{"passed":true,"xp":999}', exitCode: 0, oomKilled: false},
    {stdout: 'untrusted source and secret', exitCode: 0, oomKilled: false}]) {
    const result = await createBrowserChecker({image, run: async input => input.argv.includes('discover') ? discovery : output}, {python: '3.13.0'})(makeJob());
    assert.equal(result.passed, 0); assert.equal(result.rewardEligible, false);
  }
});

test('malformed, duplicate or non-allowlisted discovery never produces passing evidence', async () => {
  for (const checks of [[], [{file: '../escape.py', name: 'test_answer'}],
    [{file: 'tests/test_main.py', name: 'test_answer'}, {file: 'tests/test_main.py', name: 'test_answer'}]]) {
    const result = await createBrowserChecker({image, run: async () => ({...discovery, stdout: JSON.stringify({checks})})}, {python: '3.13.0'})(makeJob());
    assert.equal(result.status, 'failed'); assert.equal(result.total, 0);
  }
});

test('pre-cancelled work never reaches Docker and cancellation propagates to running checks', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const checker = createBrowserChecker({image, run: async input => {calls++; assert.ok(input.signal); return discovery;}}, {python: '3.13.0'});
  const result = await checker(makeJob(), controller.signal);
  assert.equal(result.status, 'cancelled'); assert.equal(calls, 0);
  const second = new AbortController();
  const cancelled = await createBrowserChecker({image, run: async input => {
    assert.equal(input.signal, second.signal); second.abort(); throw new DockerExecutionError('unavailable', 'cancelled');
  }}, {python: '3.13.0'})(makeJob(), second.signal);
  assert.equal(cancelled.status, 'cancelled');
});

test('cancellation cannot hide a container cleanup failure', async () => {
  const controller = new AbortController();
  const result = await createBrowserChecker({image, run: async input => {
    if (input.argv.includes('discover')) return discovery;
    controller.abort(); throw new DockerExecutionError('cleanup', 'synthetic cleanup failure');
  }}, {python: '3.13.0'})(makeJob(), controller.signal);
  assert.equal(result.status, 'failed'); assert.equal(result.failure, 'execution_unavailable');
});

test('private job transport accepts exactly one bounded UTF-8 JSON value', async () => {
  async function* chunks(...parts: Uint8Array[]) {yield* parts;}
  const raw = Buffer.from(JSON.stringify(makeJob()));
  assert.deepEqual(await readBrowserCheckJob(chunks(raw.subarray(0, 30), raw.subarray(30))), makeJob());
  await assert.rejects(readBrowserCheckJob(chunks(Buffer.from([0xff]))));
  await assert.rejects(readBrowserCheckJob(chunks(Buffer.from('{}\n{}'))));
  await assert.rejects(readBrowserCheckJob(chunks(Buffer.alloc(3 * 1024 * 1024 + 1, 32))));
});

test('total run budget prevents further containers and newer Python requirements fail before execution', async t => {
  let now = 0, calls = 0;
  t.mock.method(Date, 'now', () => now);
  const checker = createBrowserChecker({image, run: async () => {calls++; now = 60001; return discovery;}}, {python: '3.13.0'});
  const result = await checker(makeJob());
  assert.equal(calls, 1); assert.equal(result.checks[0]?.outcome, 'run_limit'); assert.equal(result.passed, 0);
  const input = {...makeJob(), minimumPython: '3.14'};
  const incompatible = await checker({...input, inputHash: browserCheckInputHash(input)});
  assert.equal(incompatible.failure, 'incompatible_python'); assert.equal(calls, 1);
});

test('worker CLI is disabled by default and rejects private malformed jobs without leaking contents', () => {
  const env = {...process.env}; delete env.FACTORYZE_BROWSER_CHECKS;
  for (const enabled of [false, true]) {
    const reply = spawnSync(process.execPath, ['--experimental-strip-types', 'packages/server/scripts/browser-check-worker.mjs'], {
      input: 'sensitive synthetic source', encoding: 'utf8', env: {...env, ...(enabled ? {FACTORYZE_BROWSER_CHECKS: '1'} : {})}, timeout: 5000});
    assert.equal(reply.status, 1); assert.equal(reply.stdout, '');
    assert.doesNotMatch(reply.stderr, /sensitive synthetic source/);
    assert.match(reply.stderr, enabled ? /rejected/i : /disabled/i);
  }
});
