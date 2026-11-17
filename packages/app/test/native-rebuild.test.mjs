import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Theia invokes the maintained local rebuild tool through pnpm without downloading a legacy package', () => {
  const require = createRequire(import.meta.url);
  const cli = dirname(require.resolve('@theia/cli/package.json'));
  const manager = require.resolve('@theia/application-manager/lib/rebuild.js', { paths: [cli] });
  assert.ok(readFileSync(manager, 'utf8').includes('pnpm exec electron-rebuild --force --which-module=${todo} --only=${todo}'),
    'Use long options: the maintained CLI parses -w=name as the module name =name');
  const rebuilt = JSON.parse(readFileSync(join(dirname(dirname(require.resolve('@electron/rebuild'))), 'package.json'), 'utf8'));
  assert.equal(rebuilt.name, '@electron/rebuild');
  assert.ok(Number(rebuilt.version.split('.')[0]) >= 4);
  const windows = process.platform === 'win32';
  const output = execFileSync(windows ? 'pnpm.cmd' : 'pnpm', ['exec', 'electron-rebuild', '--help'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30000, shell: windows
  });
  assert.match(output, /Usage: electron-rebuild/);
});
