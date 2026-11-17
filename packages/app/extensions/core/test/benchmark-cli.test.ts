import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import test from 'node:test';

const run = promisify(execFile);
const script = join(process.cwd(), 'packages/app/scripts/bench-record.mjs');

test('benchmark command explains its required profile and task without starting a run', async () => {
  const { stdout } = await run(process.execPath, ['--experimental-strip-types', script, '--help']);
  assert.match(stdout, /--profile factoryze/);
  assert.match(stdout, /--task/);
  await assert.rejects(run(process.execPath, ['--experimental-strip-types', script, '--profile', 'unknown', '--task', 'dedupe-ids']),
    error => { assert.match(String(error), /Only the factoryze profile/); return true; });
});
