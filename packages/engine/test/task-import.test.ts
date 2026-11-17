import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importTaskPack } from '../src/task-import.ts';

// A deterministic, stored ZIP fixture, including hostile filenames.
function zip(files: Record<string, string>, unixModes: Record<string, number> = {}): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = Buffer.from(path), bytes = Buffer.from(value); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    if (unixModes[path] !== undefined) { cd.writeUInt16LE((3 << 8) | 20, 4); cd.writeUInt32LE((unixModes[path]! << 16) >>> 0, 38); }
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(bytes.length, 20); cd.writeUInt32LE(bytes.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes); central.push(cd, name); offset += local.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const manifest = 'schema: 1\nid: imported-task\ntitle: Imported task\nbrief: Fix it.\nminimumPython: "3.11"\nbudgetTokens: 42\n';

test('folder and ZIP imports retain a validated private task snapshot and declared budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-import-'));
  try {
    const folder = join(root, 'source'); await mkdir(join(folder, 'workspace'), { recursive: true });
    await mkdir(join(folder, 'tests/hidden'), { recursive: true });
    await writeFile(join(folder, 'task.yaml'), manifest); await writeFile(join(folder, 'workspace/main.py'), 'pass\n');
    await writeFile(join(folder, 'tests/hidden/test_main.py'), 'assert True\n');
    const imported = await importTaskPack(folder, join(root, 'stored'));
    assert.equal(imported.task.budgetTokens, 42);
    await writeFile(join(folder, 'workspace/main.py'), 'changed');
    assert.equal(await readFile(join(imported.packRoot, imported.task.id, 'workspace/main.py'), 'utf8'), 'pass\n');
    const archive = join(root, 'task.zip'); await writeFile(archive, zip({ 'assessment/task.yaml': manifest, 'assessment/workspace/main.py': 'pass\n', 'assessment/tests/hidden/test_main.py': 'assert True\n', '__MACOSX/assessment/._task.yaml': 'Finder metadata', 'assessment/.DS_Store': 'Finder metadata' }));
    const zipped = await importTaskPack(archive, join(root, 'stored'));
    assert.equal(zipped.packRoot, imported.packRoot);
    await assert.rejects(importTaskPack(archive, join(root, 'limited'), { maxBytes: 10 }), /limit/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('imports reject traversal, symlinks and missing starter files without writing outside the pack', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-import-invalid-'));
  try {
    const archive = join(root, 'bad.zip'); await writeFile(archive, zip({ '../escaped': 'unsafe', 'task.yaml': manifest, 'workspace/main.py': 'pass' }));
    await assert.rejects(importTaskPack(archive, join(root, 'stored')), /path|relative/i);
    await assert.rejects(readFile(join(root, 'escaped')));
    const folder = join(root, 'source'); await mkdir(folder); await writeFile(join(folder, 'task.yaml'), manifest);
    await assert.rejects(importTaskPack(folder, join(root, 'stored')), /workspace/i);
    await mkdir(join(folder, 'workspace'));
    await mkdir(join(root, 'outside'));
    // Windows directory junctions need no file-symlink privilege and are genuine links to the importer.
    await symlink(process.platform === 'win32' ? join(root, 'outside') : join(root, 'bad.zip'), join(folder, 'workspace/link'),
      process.platform === 'win32' ? 'junction' : 'file');
    assert.equal((await lstat(join(folder, 'workspace/link'))).isSymbolicLink(), true);
    await assert.rejects(importTaskPack(folder, join(root, 'stored')), /link/i);
    await assert.rejects(lstat(join(root, 'stored')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ZIP imports reject Unix file and directory symlinks on every platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-import-links-'));
  try {
    for (const path of ['workspace/link.py', 'workspace/link/']) {
      const archive = join(root, path.endsWith('/') ? 'directory-link.zip' : 'file-link.zip');
      await writeFile(archive, zip({ 'task.yaml': manifest, 'workspace/main.py': 'pass', [path]: '../../outside' }, { [path]: 0o120777 }));
      await assert.rejects(importTaskPack(archive, join(root, 'stored')), /link|special/i);
    }
    await assert.rejects(readFile(join(root, 'outside')), /ENOENT/);
    await assert.rejects(lstat(join(root, 'stored')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
export { zip };
