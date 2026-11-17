import {createHash} from 'node:crypto';
import {mkdirSync, realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {DockerExecutor} from '@factoryze/engine/docker-executor';
import {createBrowserChecker, browserCheckInputHash} from '@factoryze/engine/browser-checks';
import {readBrowserCheckJob} from '@factoryze/engine/browser-check-input';
import {claimServerLock} from '../src/server-lock.ts';

// Private one-shot controller. It has no listener, database access, inference client or native fallback.
let releaseLock, inputTimer;
const controller = new AbortController();
const stop = () => {controller.abort(); if (inputTimer) process.stdin.destroy(Error('Cancelled'));};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
try {
  if (process.env.FACTORYZE_BROWSER_CHECKS !== '1') {
    process.stderr.write('Browser checks are disabled.\n'); process.exitCode = 1;
  } else {
    if (process.argv.length !== 2) throw Error('Unexpected arguments');
    inputTimer = setTimeout(() => process.stdin.destroy(Error('Input timeout')), 30000);
    const job = await readBrowserCheckJob(process.stdin);
    clearTimeout(inputTimer); inputTimer = undefined;
    const state = process.env.FACTORYZE_BROWSER_WORKER_STATE, image = process.env.FACTORYZE_BROWSER_GRADER_IMAGE;
    if (!state || !isAbsolute(state) || !image || job.image !== image || browserCheckInputHash(job) !== job.inputHash) throw Error('Invalid pinned configuration');
    if (controller.signal.aborted) throw Error('Cancelled');
    mkdirSync(state, {recursive: true, mode: 0o700});
    const root = realpathSync.native(state);
    releaseLock = claimServerLock(root);
    const owner = 'browser-' + createHash('sha256').update(root).digest('hex').slice(0, 40);
    const executor = new DockerExecutor({image, owner, docker: process.env.FACTORYZE_DOCKER_COMMAND});
    const health = await executor.initialize();
    const result = await createBrowserChecker(executor, {python: health.python})(job, controller.signal);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'completed') process.exitCode = 2;
  }
} catch {
  // Never log parser errors, source text, Docker diagnostics, host paths or credentials.
  process.stderr.write('Browser check job rejected or executor unavailable; no result was recorded.\n'); process.exitCode = 1;
} finally {
  clearTimeout(inputTimer); releaseLock?.();
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
}
