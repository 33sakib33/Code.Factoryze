import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserCheckResultSchema} from '@factoryze/protocol';
import {browserCheckInputHash, createBrowserChecker} from '../src/browser-checks.ts';
import {DockerExecutor, runDocker} from '../src/docker-executor.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = join(repo, 'dist/browser-worker-verification'); mkdirSync(output, {recursive: true});
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'factoryze-browser-worker-')));
const owner = 'browser-probe-' + randomUUID(), docker = process.env.FACTORYZE_DOCKER_COMMAND ?? 'docker';
const receipt = {verifiedAt: new Date().toISOString(), passed: false, realDockerChecks: false,
  hostStudentCodeExecutions: 0, paidModelCalls: 0, xpGranted: 0, publicAPIConnected: false};
const image = process.env.FACTORYZE_BROWSER_GRADER_IMAGE ?? readFileSync(join(repo, 'dist/docker-grader-image.txt'), 'utf8').trim();
let starts = 0;
const command = async args => {
  const result = await runDocker(docker, {args, timeoutMs: 10000, maxOutputBytes: 65536});
  assert.equal(result.code, 0, 'Docker inspection failed'); return result.stdout.trim();
};
function job(content, checks = 'from main import answer\ndef test_answer(): assert answer() == 42\n') {
  const value = {schema: 1, kind: 'public_checks', jobId: 'a'.repeat(24), attemptId: 'b'.repeat(24), revision: 1,
    archiveHash: 'c'.repeat(64), image, minimumPython: '3.11', files: [{path: 'main.py', content}],
    publicChecks: [{path: 'tests/test_main.py', content: checks}]};
  return {...value, inputHash: browserCheckInputHash(value)};
}
const cli = (value, state, {cancel = false} = {}) => new Promise((resolveReply, reject) => {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'packages/server/scripts/browser-check-worker.mjs'], {cwd: repo,
    env: {...process.env, FACTORYZE_BROWSER_CHECKS: '1', FACTORYZE_BROWSER_WORKER_STATE: state, FACTORYZE_BROWSER_GRADER_IMAGE: image}, stdio: ['pipe', 'pipe', 'pipe']});
  const stdout = [], stderr = []; let polls, cancelled = false;
  const deadline = setTimeout(() => {child.kill('SIGTERM'); reject(Error('Worker CLI verification timed out'));}, 90000);
  child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk)); child.on('error', reject);
  child.on('close', code => {clearTimeout(deadline); clearInterval(polls); resolveReply({code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), cancelled});});
  child.stdin.end(JSON.stringify(value));
  if (cancel) {
    const label = 'browser-' + createHash('sha256').update(state).digest('hex').slice(0, 40);
    let inspecting = false;
    polls = setInterval(async () => {
      if (inspecting || cancelled) return; inspecting = true;
      try {
        const ids = await command(['ps', '--quiet', '--filter', `label=org.factoryze.executor.owner=${label}`]);
        if (ids) {
          // Wait for actual student execution, not the short health/discovery containers.
          for (const id of ids.split(/\s+/)) {
            const argv = JSON.parse(await command(['inspect', '--format', '{{json .Config.Cmd}}', id]));
            if (argv.includes('check')) {cancelled = true; child.kill('SIGTERM'); break;}
          }
        }
      } catch { /* A health/discovery container may disappear during inspection. */ }
      finally {inspecting = false;}
    }, 100);
  }
});

try {
  const executor = new DockerExecutor({image, owner, execute: async request => {if (request.args.includes('start')) starts++; return runDocker(docker, request);}});
  const health = await executor.initialize();
  Object.assign(receipt, {realDockerChecks: true, image, python: health.python});
  const check = createBrowserChecker(executor, {python: health.python});
  const broken = await check(job('def answer(): return 0\n'));
  assert.equal(broken.status, 'completed'); assert.equal(broken.passed, 0); receipt.starter = broken;
  const fixed = await cli(job('def answer(): return 42\n'), join(root, 'success'));
  assert.equal(fixed.code, 0); const result = browserCheckResultSchema.parse(JSON.parse(fixed.stdout));
  assert.equal(result.passed, 1); assert.equal(result.rewardEligible, false); receipt.fixed = result;
  const probes = [
    ['network_and_socket', 'import socket, os\ndef answer():\n try: socket.create_connection(("1.1.1.1", 443), timeout=.2); return 0\n except OSError: return 42 if not os.path.exists("/var/run/docker.sock") else 0\n', true],
    ['timeout', 'def answer():\n while True: pass\n', false],
    ['output_limit', 'import os\ndef answer():\n os.write(1, b"x" * 131072)\n return 42\n', false],
    ['memory_limit', 'def answer():\n x = bytearray(512 * 1024 * 1024)\n return 42\n', false],
    ['fresh_container_per_check', 'import os\ndef answer():\n if os.path.exists("/tmp/student-marker"): return 0\n open("/tmp/student-marker", "w").write("test")\n return 42\n', true]
  ];
  receipt.probes = {};
  for (const [name, source, passed] of probes) {
    const checks = name === 'fresh_container_per_check' ? 'from main import answer\ndef test_a(): assert answer() == 42\ndef test_b(): assert answer() == 42\n' : undefined;
    const feedback = await check(job(source, checks));
    assert.equal(feedback.status, 'completed', name); assert.equal(feedback.passed === feedback.total, passed, name);
    assert.equal(feedback.rewardEligible, false); receipt.probes[name] = {passed: true, result: feedback};
  }
  const cancelled = await cli(job('def answer():\n while True: pass\n'), join(root, 'cancel'), {cancel: true});
  assert.equal(cancelled.cancelled, true, 'Cancellation must reach a running check container'); assert.equal(cancelled.code, 2);
  assert.equal(browserCheckResultSchema.parse(JSON.parse(cancelled.stdout)).status, 'cancelled'); receipt.cancellation = true;
  for (const label of [owner, ...['success', 'cancel'].map(state => 'browser-' + createHash('sha256').update(join(root, state)).digest('hex').slice(0, 40))])
    assert.equal(await command(['ps', '--all', '--quiet', '--filter', `label=org.factoryze.executor.owner=${label}`]), '', 'Owned containers must be removed');
  receipt.ownedContainersRemaining = 0; receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : 'Verification failed'; process.exitCode = 1;
} finally {
  receipt.directExecutorContainersStarted = starts;
  writeFileSync(join(output, 'checks.json'), JSON.stringify(receipt, null, 2) + '\n');
  // This directory contains only our synthetic fixture and worker lock files.
  rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 100});
  console.log(JSON.stringify(receipt));
}
