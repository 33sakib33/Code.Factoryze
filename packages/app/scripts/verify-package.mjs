import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPracticeTaskResources } from './verify-task-resources.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const app = process.platform === 'darwin'
  ? join(repo, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app/Contents')
  : join(repo, 'dist', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked');
const resources = join(app, process.platform === 'darwin' ? 'Resources' : 'resources');
assert.equal((await import('node:fs')).existsSync(join(resources, 'default_app.asar')), false, 'Packaged app must not contain the default Electron launcher');
assert.equal((await import('node:fs')).existsSync(join(resources, 'opencode')), false, 'The own-harness app must not bundle OpenCode');
await verifyPracticeTaskResources(join(resources, 'practice-tasks'));
for (const [source, target] of [
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['packages/app/licenses/THEIA-LICENSE-EPL', 'licenses/theia/LICENSE-EPL'],
  ['packages/app/licenses/THEIA-NOTICE.md', 'licenses/theia/NOTICE.md'],
  ['packages/app/node_modules/electron/dist/LICENSE', 'licenses/electron/LICENSE'],
  ['packages/app/node_modules/electron/dist/LICENSES.chromium.html', 'licenses/electron/LICENSES.chromium.html']
]) {
  assert.deepEqual(await readFile(join(resources, target)), await readFile(join(repo, source)), `Packaged notice differs from ${source}`);
}
if (process.platform === 'darwin') {
  const helper = join(resources, 'app.asar.unpacked/lib/prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  const file = await stat(helper);
  if (!file.isFile() || !(file.mode & 0o111)) throw new Error(`Packaged terminal helper is not executable: ${helper}`);
}
console.log('Factoryze-only package, practice tasks, retained retired graders and platform resources verified.');
