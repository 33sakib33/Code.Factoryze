import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { taskPackSchema, type TaskPack } from '@factoryze/protocol';
import { open, type ZipFile, type Entry } from 'yauzl';
import { packTestFiles, type TestFileRecord } from './test-files.ts';

type Limits = { maxBytes?: number; maxFiles?: number };
function safePath(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  if (!path || path.includes('\\') || path.length > 500 || parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f:*?"<>|]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw new Error('Task paths must be safe relative paths');
  return parts.join('/');
}

/** Import data only. Never run setup hooks or install dependencies supplied by a pack.
 * `tests` describes the pack's own test files as read from the source, before anything is written to disk. */
export async function importTaskPack(source: string, storage: string, limits: Limits = {}): Promise<{ task: TaskPack; packRoot: string; tests: TestFileRecord }> {
  const { task, content } = await readTaskPack(source, limits);
  const tests = packTestFiles(content);
  const digest = createHash('sha256');
  for (const [path, bytes] of content) { digest.update(JSON.stringify([path, bytes.length])); digest.update(bytes); }
  await mkdir(storage, { recursive: true, mode: 0o700 });
  const packRoot = join(storage, digest.digest('hex'));
  try { if ((await lstat(packRoot)).isDirectory()) return { task, packRoot, tests }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(join(storage, '.import-'));
  try {
    for (const [path, bytes] of content) { const target = join(staging, task.id, path); await mkdir(join(target, '..'), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { mode: 0o600, flag: 'wx' }); }
    try { await rename(staging, packRoot); } catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    return { task, packRoot, tests };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Validates a task folder or ZIP and returns its files relative to the pack root, sorted by path. Nothing is written. */
export async function readTaskPack(source: string, limits: Limits = {}): Promise<{ task: TaskPack; content: (readonly [string, Buffer])[] }> {
  const maxBytes = limits.maxBytes ?? 20 * 1024 * 1024, maxFiles = limits.maxFiles ?? 2000;
  const files = new Map<string, Buffer>(); const names = new Set<string>(); let size = 0, count = 0;
  const add = (path: string, bytes: Buffer): void => {
    const safe = safePath(path), key = safe.toLowerCase();
    if (names.has(key)) throw new Error('Duplicate task path');
    names.add(key); size += bytes.length; if (++count > maxFiles || size > maxBytes) throw new Error('Task exceeds import size or file limit');
    if (safe.startsWith('__MACOSX/') || safe.split('/').includes('.DS_Store')) return;
    files.set(safe, bytes);
  };
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error('Task links are not supported');
  if (stat.isDirectory()) {
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        const path = prefix + name; safePath(path);
        const file = join(directory, name), info = await lstat(file);
        if (info.isSymbolicLink()) throw new Error('Task links are not supported');
        if (info.isDirectory()) { if (++count > maxFiles) throw new Error('Task exceeds file limit'); await walk(file, path + '/'); }
        else if (info.isFile()) { if (info.size + size > maxBytes) throw new Error('Task exceeds import size limit'); add(path, await readFile(file)); }
        else throw new Error('Only regular task files are supported');
      }
    };
    await walk(source);
  } else if (stat.isFile() && basename(source).toLowerCase().endsWith('.zip')) {
    if (stat.size > maxBytes) throw new Error('Task exceeds import size limit');
    const archive = await new Promise<ZipFile>((resolve, reject) => open(source, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
    try {
      await new Promise<void>((resolve, reject) => {
        archive.on('error', reject); archive.on('end', resolve);
        archive.on('entry', (entry: Entry) => {
          void (async () => {
            const path = safePath(entry.fileName);
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode === 0xa000 || (mode && mode !== 0x8000 && mode !== 0x4000)) throw new Error('Task links and special files are not supported');
            if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted task ZIPs are not supported');
            if (entry.fileName.endsWith('/')) { if (++count > maxFiles) throw new Error('Task exceeds file limit'); archive.readEntry(); return; }
            if (entry.uncompressedSize + size > maxBytes || count >= maxFiles) throw new Error('Task exceeds import size or file limit');
            const stream = await new Promise<NodeJS.ReadableStream>((done, fail) => archive.openReadStream(entry, (err, input) => err ? fail(err) : done(input!)));
            const chunks: Buffer[] = []; let read = 0;
            await new Promise<void>((done, fail) => {
              stream.on('error', fail); stream.on('end', done);
              stream.on('data', (chunk: Buffer) => { read += chunk.length; if (read + size > maxBytes) { archive.close(); fail(new Error('Task exceeds import size limit')); } else chunks.push(chunk); });
            });
            add(path, Buffer.concat(chunks)); archive.readEntry();
          })().catch(reject);
        });
        archive.readEntry();
      });
    } finally { archive.close(); }
  } else throw new Error('Choose a task folder or a .zip file');
  const manifests = [...files.keys()].filter(path => path === 'task.yaml' || /^[^/]+\/task\.yaml$/.test(path));
  if (manifests.length !== 1) throw new Error('Task must contain one task.yaml at its root (or one enclosing folder in a ZIP)');
  const manifest = manifests[0]!, prefix = manifest.slice(0, -'task.yaml'.length);
  if ([...files.keys()].some(path => !path.startsWith(prefix))) throw new Error('ZIP must contain one task folder');
  const task = taskPackSchema.parse(parse(files.get(manifest)!.toString('utf8')));
  const content = [...files].map(([path, bytes]) => [path.slice(prefix.length), bytes] as const).sort(([a], [b]) => a.localeCompare(b));
  if (!content.some(([path]) => path.startsWith('workspace/'))) throw new Error('Task has no starter workspace files');
  if (content.some(([path]) => /^workspace\/(\.venv|\.git)(\/|$)/.test(path))) throw new Error('Task workspace cannot contain .venv or .git');
  if (task.entryFile && !content.some(([path]) => path === `workspace/${task.entryFile}`)) throw new Error('Task entryFile is missing from workspace');
  return { task, content };
}
