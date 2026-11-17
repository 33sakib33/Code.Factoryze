import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PythonCheck } from '@factoryze/protocol';

const execFileAsync = promisify(execFile);
const versionScript = 'import sys; print("%d.%d.%d" % sys.version_info[:3])';

type Candidate = { command: string; args: string[] };
type Runner = (command: string, args: string[]) => Promise<string>;
type ProbeOptions = { candidates?: Candidate[]; run?: Runner; platform?: NodeJS.Platform };

function candidates(minimum: string, platform: NodeJS.Platform, override?: string): Candidate[] {
  const minor = Number(minimum.split('.')[1]);
  const versions = Array.from({ length: Math.max(1, 16 - minor) }, (_, offset) => `3.${minor + offset}`);
  const result: Candidate[] = platform === 'win32'
    ? [...versions.map(version => ({ command: 'py', args: [`-${version}`] })), { command: 'py', args: ['-3'] }]
    : versions.map(version => ({ command: `python${version}`, args: [] }));
  result.push({ command: 'python3', args: [] }, { command: 'python', args: [] });
  if (override) result.unshift({ command: override, args: [] });
  return result;
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: args.includes('venv') ? 120_000 : 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Probe the same interpreter capabilities used by setup, without creating a venv or bytecode files. */
async function compatiblePython(minimum: string, options: ProbeOptions): Promise<{ check: PythonCheck; candidate?: Candidate }> {
  const required = /^3\.(\d+)$/.exec(minimum);
  if (!required) throw new Error(`Invalid minimum Python version: ${minimum}`);
  const execute = options.run ?? run;
  const platform = options.platform ?? process.platform;
  let found: string | undefined;
  let incomplete: string | undefined;
  for (const candidate of options.candidates ?? candidates(minimum, platform, process.env.FACTORYZE_PYTHON_BIN)) {
    let version: string;
    try { version = (await execute(candidate.command, [...candidate.args, '-B', '-c', versionScript])).trim(); }
    catch { continue; }
    const parts = /^3\.(\d+)\.(\d+)$/.exec(version);
    if (!parts) continue;
    found ??= version;
    if (Number(parts[1]) < Number(required[1])) continue;
    try { await execute(candidate.command, [...candidate.args, '-B', '-c', 'import venv, ensurepip']); }
    catch { incomplete ??= version; continue; }
    return { check: { ok: true, version, minimum }, candidate };
  }
  if (incomplete) {
    const packageName = `python${incomplete.split('.').slice(0, 2).join('.')}-venv`;
    const remedy = platform === 'linux'
      ? `On Debian/Ubuntu, run sudo apt-get install ${packageName}, then check again. On other distributions, install Python's venv and ensurepip support.`
      : 'Repair or reinstall Python from python.org with venv and pip enabled, then check again.';
    return { check: { ok: false, version: incomplete, minimum, message: `Python ${incomplete} is missing venv or ensurepip. ${remedy}` } };
  }
  return { check: { ok: false, ...(found ? { version: found } : {}), minimum,
    ...(platform === 'win32' && !found ? { message: `Install Python ${minimum}+ from python.org with the py launcher enabled. If python opens Microsoft Store, review App execution aliases in Windows Settings, then check again.` } : {}) } };
}

/** Finds a Python interpreter with venv/ensurepip support without creating an environment. */
export async function findPython(minimum: string, options: ProbeOptions = {}): Promise<PythonCheck> {
  return (await compatiblePython(minimum, options)).check;
}

export async function preparePythonEnvironment(
  workspace: string,
  minimum: string,
  options: ProbeOptions = {},
): Promise<{ command: string; version: string; venv: string }> {
  const execute = options.run ?? run;
  const { check, candidate } = await compatiblePython(minimum, options);
  if (candidate) {
    const venv = join(workspace, '.venv');
    try {
      await execute(candidate.command, [...candidate.args, '-m', 'venv', venv]);
      if (!(await stat(join(venv, 'pyvenv.cfg'))).isFile()) throw new Error('pyvenv.cfg is missing');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not create the Python virtual environment: ${detail}`);
    }
    return { command: candidate.command, version: check.version!, venv };
  }
  throw new Error(check.message ?? `Python ${minimum} or newer is required${check.version ? ` (found ${check.version})` : ''}. Install Python ${minimum}+ and try again.`);
}
