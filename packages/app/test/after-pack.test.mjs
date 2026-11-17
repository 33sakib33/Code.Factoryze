import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import afterPack from '../scripts/after-pack.cjs';

test('custom Electron packages launch Factoryze instead of the default Electron shell on every platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-pack-'));
  try {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const appOutDir = join(root, platform), resources = join(appOutDir, ...(platform === 'darwin' ? ['Factoryze.app', 'Contents', 'Resources'] : ['resources']));
      await mkdir(resources, { recursive: true }); await writeFile(join(resources, 'app.asar'), 'Factoryze app'); await writeFile(join(resources, 'default_app.asar'), 'Electron shell');
      await afterPack({ appOutDir, electronPlatformName: platform, packager: { appInfo: { productFilename: 'Factoryze' } } });
      await assert.rejects(access(join(resources, 'default_app.asar'))); assert.equal(await readFile(join(resources, 'app.asar'), 'utf8'), 'Factoryze app');
    }
    await assert.rejects(afterPack({ appOutDir: join(root, 'missing'), electronPlatformName: 'linux', packager: { appInfo: { productFilename: 'Factoryze' } } }), /app.asar|ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
