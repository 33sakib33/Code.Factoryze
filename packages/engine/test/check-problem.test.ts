import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

test('problem checker validates a real starter without using a model', async () => {
  const { stdout } = await run(process.execPath, [
    '--experimental-strip-types', 'packages/engine/scripts/check-problem.mjs', 'library-fines'
  ], { timeout: 120_000 });
  assert.match(stdout, /library-fines: public 5\/5, hidden 5\/9/);
});
