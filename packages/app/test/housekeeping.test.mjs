import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('the harness spike exposes help without credentials or a model call', () => {
  const output = execFileSync(process.execPath, ['--experimental-strip-types', 'spikes/factoryze-harness.mjs', '--help'],
    { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH } });
  assert.match(output, /--existing/);
  assert.match(output, /paid|billable/i);
});

test('task files and dependency patches are checked out with LF on every OS', () => {
  const output = execFileSync('git', ['check-attr', 'text', 'eol', '--stdin'], {
    encoding: 'utf8', input: 'tasks/practice/library-fines/task.yaml\ntasks/practice/monthly-revenue/workspace/billing/report.py\npatches/@theia__application-manager@1.76.0.patch\n'
  });
  for (const path of ['tasks/practice/library-fines/task.yaml', 'tasks/practice/monthly-revenue/workspace/billing/report.py', 'patches/@theia__application-manager@1.76.0.patch']) {
    assert.ok(output.includes(`${path}: text: set`));
    assert.ok(output.includes(`${path}: eol: lf`));
  }
});
