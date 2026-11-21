import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importTaskPack } from '../src/task-import.ts';
import { currentTestFileDigest, packTestFiles, restoreTestFiles, testFileDigest, testFilesUnchanged } from '../src/test-files.ts';

const manifest = 'schema: 1\nid: hosted-task\ntitle: Hosted task\nbrief: Fix it.\nminimumPython: "3.11"\nbudgetTokens: 20000\n';
const packFiles: Record<string, string> = {
  'task.yaml': manifest, 'workspace/app.py': 'def answer():\n    return 1\n',
  'workspace/tests/test_public.py': 'from app import answer\n\ndef test_public():\n    assert answer() == 2\n',
  'tests/hidden/test_hidden.py': 'from app import answer\n\ndef test_hidden():\n    assert answer() == 2\n',
};
const content = (files = packFiles) => Object.entries(files).map(([path, value]) => [path, Buffer.from(value)] as const);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-test-files-'));
  const source = join(root, 'source');
  for (const [path, value] of Object.entries(packFiles)) { await mkdir(join(source, path, '..'), { recursive: true }); await writeFile(join(source, path), value); }
  const imported = await importTaskPack(source, join(root, 'stored'));
  const packDir = join(imported.packRoot, imported.task.id), workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'tests'), { recursive: true });
  await writeFile(join(workspace, 'app.py'), packFiles['workspace/app.py']!);
  await writeFile(join(workspace, 'tests/test_public.py'), packFiles['workspace/tests/test_public.py']!);
  return { root, packDir, workspace, record: imported.tests };
}

test('the test-file digest is stable, order-independent and covers only hidden and public tests', () => {
  const record = packTestFiles(content());
  assert.match(record.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.publicFiles, ['tests/test_public.py']);
  assert.equal(packTestFiles([...content()].reverse()).digest, record.digest);
  assert.equal(packTestFiles(content({ ...packFiles, 'workspace/app.py': 'changed' })).digest, record.digest, 'Source edits are the solution, not test edits');
  assert.equal(packTestFiles(content({ ...packFiles, 'tests/hidden/__pycache__/x.pyc': 'cache' })).digest, record.digest);
  assert.notEqual(packTestFiles(content({ ...packFiles, 'tests/hidden/test_hidden.py': 'def test_hidden(): pass\n' })).digest, record.digest);
  assert.notEqual(testFileDigest([['a', Buffer.from('bc')]]), testFileDigest([['ab', Buffer.from('c')]]), 'Path and content boundaries are unambiguous');
});

test('the recorded digest matches the stored pack and workspace until a test file changes', async () => {
  const { root, packDir, workspace, record } = await fixture();
  try {
    assert.equal(record.digest, packTestFiles(content()).digest, 'Import records the digest from the source pack');
    assert.equal(await testFilesUnchanged(record, packDir, workspace), true);
    await writeFile(join(workspace, 'app.py'), 'def answer():\n    return 2\n');
    await mkdir(join(workspace, 'tests', '__pycache__')); await writeFile(join(workspace, 'tests', '__pycache__', 'x.pyc'), 'cache');
    await writeFile(join(workspace, 'tests', 'test_mine.py'), 'def test_extra(): pass\n');
    assert.equal(await testFilesUnchanged(record, packDir, workspace), true, 'Solution edits, caches and added public tests are not test edits');

    await writeFile(join(workspace, 'tests/test_public.py'), 'def test_public(): pass\n');
    assert.equal(await testFilesUnchanged(record, packDir, workspace), false, 'An edited public test is detected');
    await writeFile(join(workspace, 'tests/test_public.py'), packFiles['workspace/tests/test_public.py']!);
    await unlink(join(workspace, 'tests/test_public.py'));
    assert.equal(await testFilesUnchanged(record, packDir, workspace), false, 'A deleted public test is detected');
    await writeFile(join(workspace, 'tests/test_public.py'), packFiles['workspace/tests/test_public.py']!);

    await writeFile(join(packDir, 'tests/hidden/test_hidden.py'), 'def test_hidden(): pass\n');
    assert.equal(await testFilesUnchanged(record, packDir, workspace), false, 'An edited hidden check is detected');
    await writeFile(join(packDir, 'tests/hidden/test_hidden.py'), packFiles['tests/hidden/test_hidden.py']!);
    assert.equal(await testFilesUnchanged(record, packDir, workspace), true);
    await writeFile(join(packDir, 'tests/hidden/test_extra.py'), 'def test_free(): pass\n');
    assert.equal(await testFilesUnchanged(record, packDir, workspace), false, 'An added hidden check is detected');
    await unlink(join(packDir, 'tests/hidden/test_extra.py'));

    await unlink(join(workspace, 'tests/test_public.py'));
    await symlink(join(packDir, 'workspace/tests/test_public.py'), join(workspace, 'tests/test_public.py'));
    assert.equal(await currentTestFileDigest(record, packDir, workspace), null, 'A linked test file never matches');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restore rewrites hidden and public tests only from matching pack content', async () => {
  const { root, packDir, workspace, record } = await fixture();
  try {
    await writeFile(join(packDir, 'tests/hidden/test_hidden.py'), 'def test_hidden(): pass\n');
    await writeFile(join(packDir, 'tests/hidden/test_extra.py'), 'def test_free(): pass\n');
    await writeFile(join(workspace, 'tests/test_public.py'), 'edited');
    await writeFile(join(workspace, 'app.py'), 'my solution');
    await assert.rejects(restoreTestFiles(content({ ...packFiles, 'tests/hidden/test_hidden.py': 'other' }), record, packDir, workspace), /does not match/);
    await restoreTestFiles(content(), record, packDir, workspace);
    assert.equal(await testFilesUnchanged(record, packDir, workspace), true);
    assert.equal(await readFile(join(workspace, 'app.py'), 'utf8'), 'my solution', 'Restore never touches solution files');
  } finally { await rm(root, { recursive: true, force: true }); }
});
