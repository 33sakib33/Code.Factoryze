import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HarnessTools, harnessShellEnvironment } from '../src/node/harness-tools.ts';

test('Windows shells retain OS module/cache locations without inheriting provider keys or another PowerShell module path', () => {
  const source = { Path: 'system-path', SystemRoot: 'C:\\Windows', APPDATA: 'roaming-cache', LOCALAPPDATA: 'local-cache',
    ProgramFiles: 'program-files', 'ProgramFiles(x86)': 'program-files-x86', ProgramW6432: 'program-files-64',
    FACTORYZE_PROVIDER_API_KEY: 'synthetic-private-key', OPENAI_API_KEY: 'synthetic-other-key', PSModulePath: 'pwsh7-modules' };
  const windows = harnessShellEnvironment('C:\\task', undefined, source, 'win32');
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'] as const) assert.equal(windows[key], source[key]);
  assert.ok(windows.PATH?.endsWith(';system-path'));
  assert.equal(windows.FACTORYZE_PROVIDER_API_KEY, undefined); assert.equal(windows.OPENAI_API_KEY, undefined); assert.equal(windows.PSModulePath, undefined);
  const linux = harnessShellEnvironment('/task', undefined, source, 'linux');
  assert.equal(linux.LOCALAPPDATA, undefined); assert.equal(linux.ProgramFiles, undefined);
});

test('harness tools scope reads/searches to the workspace and require a reviewed diff for edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-tools-'));
  const cwd = join(root, 'workspace');
  try {
    await mkdir(cwd); await mkdir(join(root, 'outside'));
    await writeFile(join(cwd, 'a.py'), 'before\n'); await writeFile(join(root, 'outside', 'private.py'), 'private');
    // Junctions exercise real Windows reparse-point rejection without changing OS privileges.
    // POSIX still exercises a file symlink; archive file links have separate portable coverage.
    const linkedFile = process.platform === 'win32' ? join('link', 'private.py') : 'link';
    await symlink(process.platform === 'win32' ? join(root, 'outside') : join(root, 'outside', 'private.py'),
      join(cwd, 'link'), process.platform === 'win32' ? 'junction' : 'file');
    assert.equal((await lstat(join(cwd, 'link'))).isSymbolicLink(), true);
    assert.equal(await readFile(join(cwd, linkedFile), 'utf8'), 'private', 'The real link must resolve outside the workspace');
    let allowed = false; const requests: any[] = [];
    const tools = new HarnessTools({ cwd, onPermission: async request => { requests.push(request); return allowed ? 'allow' : 'reject'; } });
    const run = (name: string, args: unknown) => tools.execute({ id: 'call', name, arguments: args } as any, new AbortController().signal);
    assert.equal(await run('read', { filePath: 'a.py' }), 'before\n');
    await assert.rejects(run('read', { filePath: '../outside' }), /workspace/);
    await assert.rejects(run('read', { filePath: linkedFile }), /workspace|symbolic/);
    await assert.rejects(run('write', { filePath: linkedFile, content: 'wrong' }), /workspace|symbolic/);
    assert.equal(await readFile(join(root, 'outside', 'private.py'), 'utf8'), 'private');
    assert.equal(requests.length, 0, 'Reject linked paths before asking for write approval');
    assert.match(await run('list', {}), /a.py/);
    assert.equal((await run('list', {})).includes('link'), false);
    assert.match(await run('grep', { query: 'before' }), /a.py:1:before/);
    assert.equal(await run('grep', { query: 'private' }), '(No matches)');
    assert.match(await run('edit', { filePath: 'a.py', oldString: 'before', newString: 'after' }), /denied/i);
    assert.equal(await readFile(join(cwd, 'a.py'), 'utf8'), 'before\n');
    assert.deepEqual(requests[0].toolCall.content[0], { type: 'diff', path: 'a.py', oldText: 'before\n', newText: 'after\n' });
    allowed = true;
    await run('edit', { filePath: 'a.py', oldString: 'before', newString: 'after' });
    assert.equal(await readFile(join(cwd, 'a.py'), 'utf8'), 'after\n');
    await run('write', { filePath: 'new.py', content: 'new file\n' });
    assert.equal(await readFile(join(cwd, 'new.py'), 'utf8'), 'new file\n');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(tools.execute({ id: 'stopped', name: 'write', arguments: { filePath: 'new.py', content: 'wrong' } }, aborted.signal));
    assert.equal(await readFile(join(cwd, 'new.py'), 'utf8'), 'new file\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('shell denial never launches a command, approvals cannot overwrite edits made while reviewing', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'factoryze-tools-deny-'));
  await writeFile(join(cwd, 'a.py'), 'before');
  let mode = 'deny';
  const tools = new HarnessTools({ cwd, onPermission: async () => {
    if (mode === 'change') await writeFile(join(cwd, 'a.py'), 'human edit');
    return mode === 'deny' ? 'reject' : 'allow';
  } });
  try {
    assert.match(await tools.execute({ id: 'shell', name: 'shell', arguments: { command: 'echo should-not-run' } }, new AbortController().signal), /denied/i);
    mode = 'change';
    await assert.rejects(tools.execute({ id: 'edit', name: 'edit', arguments: { filePath: 'a.py', oldString: 'before', newString: 'after' } }, new AbortController().signal), /changed/);
    assert.equal(await readFile(join(cwd, 'a.py'), 'utf8'), 'human edit');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('approved shell runs with the task package index and without provider environment credentials', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'factoryze-tools-shell-'));
  const previous = process.env.FACTORYZE_PROVIDER_API_KEY; process.env.FACTORYZE_PROVIDER_API_KEY = 'synthetic-should-not-inherit';
  const gateway = { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic-session', model: 'test', api: 'openai-chat' as const,
    contextWindow: 8192, maxOutputTokens: 256, packageIndexURL: 'http://127.0.0.1:2/simple/', pipConfigFile: join(cwd, 'pip.ini') };
  const tools = new HarnessTools({ cwd, gateway, onPermission: async () => 'allow' });
  try {
    // Qualify the built-in cmdlet: this fixture tests environment isolation, not
    // discovery of the many unrelated third-party modules on Windows CI images.
    const command = process.platform === 'win32' ? 'Microsoft.PowerShell.Utility\\Write-Output $env:PIP_INDEX_URL; Microsoft.PowerShell.Utility\\Write-Output $env:FACTORYZE_PROVIDER_API_KEY' : 'printenv PIP_INDEX_URL; printenv FACTORYZE_PROVIDER_API_KEY || true';
    const output = await tools.execute({ id: 'shell', name: 'shell', arguments: { command } }, new AbortController().signal);
    assert.match(output, /http:\/\/127.0.0.1:2\/simple\//); assert.match(output, /Exit code: 0/);
    assert.equal(output.includes('synthetic-should-not-inherit'), false);
  } finally { if (previous === undefined) delete process.env.FACTORYZE_PROVIDER_API_KEY; else process.env.FACTORYZE_PROVIDER_API_KEY = previous; await rm(cwd, { recursive: true, force: true }); }
});

test('Stop while waiting for approval cancels without a write even if approval arrives later', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'factoryze-tools-stop-')); await writeFile(join(cwd, 'a.py'), 'before');
  let entered!: () => void, approve!: (value: string) => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const tools = new HarnessTools({ cwd, onPermission: () => { entered(); return new Promise(resolve => { approve = resolve; }); } });
  const abort = new AbortController();
  try {
    const result = tools.execute({ id: 'edit', name: 'edit', arguments: { filePath: 'a.py', oldString: 'before', newString: 'after' } }, abort.signal);
    const rejected = assert.rejects(result); await waiting; abort.abort(); await rejected; approve('allow');
    assert.equal(await readFile(join(cwd, 'a.py'), 'utf8'), 'before');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
