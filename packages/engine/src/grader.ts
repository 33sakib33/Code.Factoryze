import { execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { taskPackSchema, publicTestResultSchema, type HiddenCheck } from '@factoryze/protocol';

export type GradingLimits = { checkTimeoutMs?: number; runTimeoutMs?: number };
const defaultLimits = { checkTimeoutMs: 10_000, runTimeoutMs: 120_000 };

// Discovery and each plain test_ function run separately, without requiring pytest.
const testRunner = `
import contextlib, inspect, json, os, runpy, sys
sys.path.insert(0, sys.argv[1])
try:
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        tests = runpy.run_path(sys.argv[2])
        if sys.argv[3] == 'discover':
            result = {'names': sorted(name for name, fn in tests.items() if name.startswith('test_') and inspect.isfunction(fn))}
        else:
            tests[sys.argv[3]]()
            result = {'passed': True}
except BaseException as error:
    result = {'passed': False, 'message': (type(error).__name__ + ': ' + str(error))[:2000]}
print(json.dumps(result))
`;

export async function gradePracticeTask(
  packRoot: string, taskId: string, workspace: string, python: string, limits: GradingLimits = {},
): Promise<{ passed: number; total: number; checks?: HiddenCheck[] }> {
  const id = taskPackSchema.shape.id.parse(taskId);
  const hidden = join(packRoot, id, 'tests', 'hidden');
  if (!(await lstat(hidden).catch(() => undefined))?.isDirectory() ||
      !(await readdir(hidden)).some(name => /^test_.*\.py$/.test(name))) {
    throw new Error('Practice task has no hidden tests');
  }
  return runChecks(workspace, python, hidden, false, limits);
}

export async function runPracticeTests(workspace: string, python: string, limits: GradingLimits = {}) {
  const { checks, ...counts } = await runChecks(workspace, python, undefined, true, limits);
  return publicTestResultSchema.parse({ ...counts, failures: checks.filter(check => !check.passed)
    .map(({ name, message }) => ({ name, message: message! })) });
}

async function runChecks(workspace: string, python: string, hidden: string | undefined, publicTests: boolean, limits: GradingLimits) {
  const checkTimeoutMs = limits.checkTimeoutMs ?? defaultLimits.checkTimeoutMs;
  const runTimeoutMs = limits.runTimeoutMs ?? defaultLimits.runTimeoutMs;
  if (![checkTimeoutMs, runTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0))
    throw new Error('Grading time limits must be positive integer milliseconds');
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-grade-'));
  try {
    const snapshot = join(scratch, 'workspace');
    await cp(workspace, snapshot, { recursive: true, filter: async source => {
      if (source === workspace) return true;
      if (['.venv', '.git', 'node_modules', '__pycache__'].includes(basename(source))) return false;
      return !(await lstat(source)).isSymbolicLink();
    } });
    const tests = publicTests ? join(snapshot, 'tests') : hidden!;
    const deadline = performance.now() + runTimeoutMs;
    const runTimeout = `Timed out after ${runTimeoutMs / 1000} s (grading run limit)`;
    const invoke = async (path: string, name: string) => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return { passed: false, message: runTimeout };
      const result = await runPython(python, snapshot, path, name, Math.ceil(Math.min(checkTimeoutMs, remaining)));
      if (result === 'timeout') return { passed: false,
        message: remaining <= checkTimeoutMs ? runTimeout : `Timed out after ${checkTimeoutMs / 1000} s` };
      return result;
    };
    const pending: { path: string; name: string; failure?: string }[] = [];
    for (const file of (await readdir(tests).catch(error => {
      if (publicTests && error.code === 'ENOENT') return [];
      throw error;
    })).filter(name => /^test_.*\.py$/.test(name)).sort()) {
      const path = join(tests, file);
      const result = await invoke(path, 'discover');
      if ('names' in result) pending.push(...result.names.map(name => ({ path, name })));
      else pending.push({ path, name: file, failure: result.message ?? 'Invalid test discovery result' });
    }
    const checks: HiddenCheck[] = [];
    for (const { path, name, failure } of pending) {
      if (failure !== undefined) { checks.push({ name, passed: false, message: failure }); continue; }
      const result = await invoke(path, name);
      checks.push('passed' in result ? { name, ...result } : { name, passed: false, message: 'Invalid check result' });
    }
    if (!checks.length) throw new Error('Invalid grading result: no checks found');
    return { passed: checks.filter(check => check.passed).length, total: checks.length, checks };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

type PythonResult = { names: string[] } | { passed: boolean; message?: string };

function runPython(python: string, workspace: string, path: string, name: string, timeout: number): Promise<PythonResult | 'timeout'> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let outputExceeded = false;
    let spawnError: Error | undefined;
    let stopped: Promise<void> | undefined;
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    const child = spawn(python, ['-I', '-c', testRunner, workspace, path, name], {
      cwd: workspace, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP, TMP: process.env.TMP,
        PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0',
      },
    });
    const stop = () => { stopped ??= stopProcessTree(child.pid, () => child.kill('SIGKILL')); };
    const output = (data: Buffer, keep: boolean) => {
      if (outputExceeded) return;
      outputBytes += data.length;
      if (outputBytes > 64 * 1024) { outputExceeded = true; stop(); }
      else if (keep) stdout.push(data);
    };
    child.stdout.on('data', (data: Buffer) => output(data, true));
    child.stderr.on('data', (data: Buffer) => output(data, false));
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      clearTimeout(timer);
      void (async () => {
        await stopped;
        if (timedOut) { resolve('timeout'); return; }
        if (spawnError) { reject(spawnError); return; }
        if (outputExceeded || code !== 0) {
          resolve({ passed: false, message: outputExceeded
            ? 'Python output exceeded 64 KiB' : `Python process exited before returning a check result${code === null ? '' : ` (code ${code})`}` });
          return;
        }
        try {
          const result: unknown = JSON.parse(Buffer.concat(stdout).toString('utf8'));
          if (result && typeof result === 'object') {
            if (name === 'discover' && 'names' in result && Array.isArray(result.names) &&
                result.names.every(value => typeof value === 'string' && value.startsWith('test_'))) {
              resolve({ names: result.names }); return;
            }
            if ('passed' in result && typeof result.passed === 'boolean' &&
                (result.passed || ('message' in result && typeof result.message === 'string'))) {
              resolve({ passed: result.passed, ...(!result.passed && 'message' in result ? { message: String(result.message).slice(0, 2000) } : {}) }); return;
            }
          }
        } catch { /* A check cannot supply valid counts by printing arbitrary output. */ }
        resolve({ passed: false, message: 'Python did not return a valid check result' });
      })().catch(reject);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
  });
}

async function stopProcessTree(pid: number | undefined, fallback: () => unknown) {
  if (!pid) { fallback(); return; }
  if (process.platform === 'win32') {
    const run = promisify(execFile);
    try { await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }); }
    catch { /* The parent may have exited while taskkill was starting. */ }
    finally { fallback(); }
  } else {
    try { process.kill(-pid, 'SIGKILL'); }
    catch { fallback(); }
  }
}
