import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Test-file integrity for hosted tasks. Grading runs the hidden checks from the engine's stored pack copy
 * (`<packRoot>/<id>/tests/hidden`), never from the editable workspace; public tests live in the workspace's `tests/`.
 * Both can be edited on this computer, so a result is sent only while both still match the downloaded archive.
 * This detects casual edits only: a modified app can report anything.
 */
export type TestFileRecord = {
  /** sha256 over every hidden test file and every public test file shipped in the pack, with their pack paths. */
  digest: string;
  /** Workspace-relative paths of the public test files the pack shipped, for example `tests/test_main.py`. */
  publicFiles: string[];
};

const hiddenPrefix = 'tests/hidden/', publicPrefix = 'workspace/tests/';
// Interpreter caches and Finder metadata are not test content.
const ignored = (path: string): boolean => path.endsWith('.pyc') || path.split('/').some(part => ['__pycache__', '.pytest_cache', '.DS_Store'].includes(part));
const byPath = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number => a < b ? -1 : a > b ? 1 : 0;

export function testFileDigest(files: Iterable<readonly [string, Uint8Array]>): string {
  const hash = createHash('sha256').update('factoryze-test-files@1\n');
  for (const [path, bytes] of [...files].sort(byPath)) { hash.update(JSON.stringify([path, bytes.length])); hash.update(bytes); }
  return hash.digest('hex');
}

/** The test files of a validated pack, with paths relative to the pack root. */
export function packTestFiles(content: Iterable<readonly [string, Uint8Array]>): TestFileRecord {
  const tests = [...content].filter(([path]) => (path.startsWith(hiddenPrefix) || path.startsWith(publicPrefix)) && !ignored(path));
  return { digest: testFileDigest(tests),
    publicFiles: tests.filter(([path]) => path.startsWith(publicPrefix)).map(([path]) => path.slice('workspace/'.length)).sort() };
}

/** Recomputes the digest from disk. Any added hidden file counts; added public files do not, because grading never runs them.
 * Returns null when a test path is a link or another non-regular file. */
export async function currentTestFileDigest(record: TestFileRecord, packDir: string, workspace: string): Promise<string | null> {
  const files: [string, Uint8Array][] = [];
  const walk = async (directory: string, prefix: string): Promise<boolean> => {
    let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
    for (const name of names) {
      const path = prefix + name, full = join(directory, name), info = await lstat(full);
      if (ignored(path)) continue;
      if (info.isDirectory()) { if (!await walk(full, path + '/')) return false; }
      else if (info.isFile()) files.push([path, await readFile(full)]);
      else return false;
    }
    return true;
  };
  if (!await walk(join(packDir, 'tests', 'hidden'), hiddenPrefix)) return null;
  for (const path of record.publicFiles) {
    const full = join(workspace, ...path.split('/'));
    const info = await lstat(full).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!info) continue;
    if (!info.isFile()) return null;
    files.push([`workspace/${path}`, await readFile(full)]);
  }
  return testFileDigest(files);
}

export async function testFilesUnchanged(record: TestFileRecord, packDir: string, workspace: string): Promise<boolean> {
  return await currentTestFileDigest(record, packDir, workspace) === record.digest;
}

/** Rewrites the hidden tests in the stored pack and the shipped public tests in the workspace from verified pack content. */
export async function restoreTestFiles(content: Iterable<readonly [string, Uint8Array]>, record: TestFileRecord, packDir: string, workspace: string): Promise<void> {
  const files = [...content];
  if (packTestFiles(files).digest !== record.digest) throw new Error('The downloaded task does not match the version this attempt started with.');
  const hidden = join(packDir, 'tests', 'hidden');
  await rm(hidden, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    if (ignored(path)) continue;
    let target: string;
    if (path.startsWith(hiddenPrefix)) target = join(packDir, ...path.split('/'));
    else if (path.startsWith(publicPrefix)) target = join(workspace, ...path.slice('workspace/'.length).split('/'));
    else continue;
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: path.startsWith(hiddenPrefix) ? 0o600 : 0o644 });
  }
}
