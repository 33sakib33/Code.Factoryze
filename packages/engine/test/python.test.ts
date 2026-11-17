import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findPython, preparePythonEnvironment } from '../src/python.ts';

test('Python preflight detects missing venv support and gives the matching Debian/Ubuntu package without creating files', async () => {
  const calls: string[][] = [];
  const result = await findPython('3.11', { platform: 'linux', candidates: [{ command: 'python', args: [] }], run: async (_command, args) => {
    calls.push(args);
    if (args.at(-1) === 'import venv, ensurepip') throw new Error('No module named ensurepip');
    return '3.11.9\n';
  } });
  assert.equal(result.ok, false); assert.equal(result.version, '3.11.9');
  assert.match(result.message!, /sudo apt-get install python3\.11-venv/);
  assert.ok(calls.every(args => args.includes('-c') && !args.includes('-m')));
});

test('preflight and setup skip an incomplete Python and use a compatible interpreter with venv and ensurepip', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'factoryze-python-fallback-'));
  const created: string[] = [];
  const options = { candidates: [{ command: 'incomplete', args: [] }, { command: 'complete', args: [] }],
    run: async (command: string, args: string[]) => {
      if (args.at(-1) === 'import venv, ensurepip') { if (command === 'incomplete') throw new Error('venv missing'); return ''; }
      if (args.includes('-c')) return command === 'incomplete' ? '3.11.9\n' : '3.12.4\n';
      created.push(command); await mkdir(args.at(-1)!); await writeFile(join(args.at(-1)!, 'pyvenv.cfg'), 'version = 3.12.4\n'); return '';
    } };
  try {
    assert.deepEqual(await findPython('3.11', options), { ok: true, version: '3.12.4', minimum: '3.11' });
    assert.equal((await preparePythonEnvironment(workspace, '3.11', options)).command, 'complete');
    assert.deepEqual(created, ['complete']);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('Windows discovery supports py selectors and rejects the Microsoft Store alias response', async () => {
  const calls: string[][] = [];
  const run = async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (command === 'py') {
      if (args[0] !== '-3.11') throw new Error('not installed');
      return args.at(-1) === 'import venv, ensurepip' ? '' : '3.11.9\n';
    }
    return 'Python was not found; run without arguments to install from the Microsoft Store';
  };
  assert.equal((await findPython('3.11', { platform: 'win32', run })).ok, true);
  assert.deepEqual(calls[0]?.slice(0, 2), ['py', '-3.11']);
  const missing = await findPython('3.11', { platform: 'win32', candidates: [{ command: 'python', args: [] }], run });
  assert.equal(missing.ok, false);
  assert.match(missing.message!, /py launcher|App execution aliases/i);
});

test('Windows minimum-version errors retain the interpreter version instead of replacing it with alias guidance', async () => {
  await assert.rejects(preparePythonEnvironment(join(tmpdir(), 'factoryze-missing-python'), '3.11', {
    platform: 'win32', candidates: [{ command: 'old-python', args: [] }], run: async () => '3.9.18\n'
  }), /Python 3\.11 or newer is required.*found 3\.9\.18.*Install Python/i);
});

test('uses a compatible Python and creates a task venv', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'factoryze-python-'));
  const calls: string[] = [];
  try {
    const runtime = await preparePythonEnvironment(workspace, '3.11', {
      candidates: [{ command: 'old-python', args: [] }, { command: 'good-python', args: [] }],
      run: async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`);
        if (args.includes('-c')) return command === 'old-python' ? '3.9.18\n' : '3.11.8\n';
        const venv = args.at(-1)!;
        await mkdir(venv);
        await writeFile(join(venv, 'pyvenv.cfg'), 'version = 3.11.8\n');
        return '';
      },
    });
    assert.equal(runtime.version, '3.11.8');
    assert.equal(runtime.command, 'good-python');
    assert.equal(await readFile(join(workspace, '.venv', 'pyvenv.cfg'), 'utf8'), 'version = 3.11.8\n');
    assert.equal(calls.filter(call => call.includes(' -m venv ')).length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('explains when no installed Python meets the task minimum', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'factoryze-python-'));
  try {
    await assert.rejects(preparePythonEnvironment(workspace, '3.11', {
      candidates: [{ command: 'python', args: [] }],
      run: async () => '3.9.18\n',
    }), /Python 3\.11 or newer is required.*3\.9\.18.*Install Python/i);
    await assert.rejects(readFile(join(workspace, '.venv', 'pyvenv.cfg')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('reports a failed venv setup without claiming the workspace is ready', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'factoryze-python-'));
  try {
    await assert.rejects(preparePythonEnvironment(workspace, '3.11', {
      candidates: [{ command: 'python', args: [] }],
      run: async (_command, args) => {
        if (args.includes('-c')) return '3.12.1\n';
        throw new Error('ensurepip is missing');
      },
    }), /Could not create.*virtual environment.*ensurepip is missing/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('python check reports the best match without creating a virtual environment', async () => {
  const { findPython } = await import('../src/python.ts');
  const calls: string[][] = [];
  const versions: Record<string, string> = { old: '3.10.4', good: '3.12.4' };
  const run = async (command: string, args: string[]) => { calls.push([command, ...args]); if (!(command in versions)) throw new Error('missing'); return versions[command]! + '\n'; };
  assert.deepEqual(await findPython('3.11', { platform: 'linux', candidates: [{ command: 'none', args: [] }, { command: 'old', args: [] }, { command: 'good', args: [] }], run }),
    { ok: true, version: '3.12.4', minimum: '3.11' });
  assert.deepEqual(await findPython('3.11', { platform: 'linux', candidates: [{ command: 'old', args: [] }], run }), { ok: false, version: '3.10.4', minimum: '3.11' });
  assert.deepEqual(await findPython('3.11', { platform: 'linux', candidates: [], run }), { ok: false, minimum: '3.11' });
  assert.ok(calls.every(call => !call.includes('venv')));
});
