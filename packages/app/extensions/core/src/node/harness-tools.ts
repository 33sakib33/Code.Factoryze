import { spawn } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import { lstat, realpath, readdir, readFile, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { harnessToolInputs, harnessToolCallSchema, type AgentPermission, type HarnessToolCall, type GatewayConnection } from '@factoryze/protocol';
import { HARNESS_LIMITS } from '@factoryze/engine/harness';

type Options = { cwd: string; gateway?: GatewayConnection; onPermission(request: AgentPermission): Promise<string | null> };
const ignored = new Set(['.git', '.venv', 'node_modules', '__pycache__']);

export function harnessShellEnvironment(cwd: string, gateway?: GatewayConnection, source: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keys = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG'];
  // Windows PowerShell uses these for module discovery and startup caches. Keep
  // PSModulePath absent so a parent pwsh cannot inject incompatible PS7 modules.
  if (platform === 'win32') keys.push('APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemDrive', 'HOMEDRIVE', 'HOMEPATH');
  for (const key of keys) {
    const value = platform === 'win32' ? Object.entries(source).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] : source[key];
    if (value) env[key] = value;
  }
  if (gateway?.packageIndexURL) Object.assign(env, { PIP_INDEX_URL: gateway.packageIndexURL, PIP_EXTRA_INDEX_URL: '', PIP_NO_INDEX: 'false', PIP_DISABLE_PIP_VERSION_CHECK: '1' });
  if (gateway?.pipConfigFile) env.PIP_CONFIG_FILE = gateway.pipConfigFile;
  env.PATH = `${join(cwd, '.venv', platform === 'win32' ? 'Scripts' : 'bin')}${platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`;
  return env;
}

/** Local hands for the engine loop. Shell approval authorizes an ordinary OS process, not a sandbox. */
export class HarnessTools {
  private readonly options: Options;
  constructor(options: Options) { this.options = { ...options, cwd: realpathSync.native(options.cwd) }; }

  async execute(input: HarnessToolCall, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const parsed = harnessToolCallSchema.safeParse(input);
    if (!parsed.success) throw new Error('Unsupported tool call');
    const call = parsed.data;
    const valid = harnessToolInputs[call.name].safeParse(call.arguments);
    if (!valid.success) throw new Error(`Invalid ${call.name} arguments`);
    const args = valid.data as Record<string, string>;
    if (call.name === 'shell') {
      if (!(await this.approve(call, { toolCallId: call.id, kind: 'execute', title: args.command!, rawInput: args }, signal))) return 'Permission denied. Do not retry without asking the user.';
      return this.shell(args.command!, signal);
    }
    const file = await this.path(args.filePath ?? args.path ?? '.'); signal.throwIfAborted();
    if (call.name === 'read') return this.read(file);
    if (call.name === 'list' || call.name === 'grep') {
      const paths = await this.files(file, signal);
      if (call.name === 'list') return paths.map(path => relative(this.options.cwd, path)).join('\n') || '(No files)';
      const matches: string[] = [];
      for (const path of paths) {
        signal.throwIfAborted(); let content: string;
        try { content = await this.read(path); } catch { continue; }
        const lines = content.split('\n');
        for (let line = 0; line < lines.length; line++) {
          if (lines[line]!.includes(args.query!)) matches.push(`${relative(this.options.cwd, path)}:${line + 1}:${lines[line]!.slice(0, 300)}`);
          if (matches.length >= 100) return matches.join('\n') + '\n(100 match limit)';
        }
      }
      return matches.join('\n') || '(No matches)';
    }
    let before: string | undefined;
    try { before = await this.read(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let after = args.content!;
    if (call.name === 'edit') {
      if (before === undefined || !before.includes(args.oldString!)) throw new Error('Exact text not found. Read the file before editing.');
      if (before.indexOf(args.oldString!) !== before.lastIndexOf(args.oldString!)) throw new Error('Text is not unique. Include more surrounding text.');
      after = before.replace(args.oldString!, () => args.newString!);
    }
    if (Buffer.byteLength(after) > HARNESS_LIMITS.fileBytes) throw new Error('File exceeds the 64 KB edit limit');
    if (!(await this.approve(call, { toolCallId: call.id, kind: 'edit', title: relative(this.options.cwd, file), rawInput: args,
      content: [{ type: 'diff', path: relative(this.options.cwd, file), oldText: before ?? '', newText: after }] }, signal))) return 'Permission denied. Do not retry without asking the user.';
    // Recheck after human review. Never silently replace a concurrent editor change or a new symlink.
    await this.path(file); signal.throwIfAborted();
    await mkdir(dirname(file), { recursive: true });
    const handle = await open(file, before === undefined ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL : constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      signal.throwIfAborted();
      const stat = await handle.stat(); if (!stat.isFile() || stat.nlink > 1) throw new Error('Only regular workspace files may be edited');
      if (before !== undefined && (await handle.readFile('utf8')) !== before) throw new Error('File changed while awaiting approval. Read it and propose a fresh diff.');
      signal.throwIfAborted();
      await handle.truncate(0); await handle.write(after, 0, 'utf8');
    } finally { await handle.close(); }
    return `Saved ${relative(this.options.cwd, file)}`;
  }

  private async path(input: string): Promise<string> {
    const root = await realpath(this.options.cwd), file = resolve(root, input);
    const inside = (path: string) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
    if (!inside(file)) throw new Error('Path must stay within the task workspace');
    let current = root;
    for (const part of relative(root, file).split(sep).filter(Boolean)) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not supported by workspace tools'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    return file;
  }
  private async read(file: string): Promise<string> {
    const checked = await this.path(file), info = await lstat(checked);
    if (!info.isFile() || info.size > HARNESS_LIMITS.fileBytes) throw new Error('Read requires a regular file of at most 64 KB');
    const text = await readFile(checked, 'utf8');
    if (text.includes('\0')) throw new Error('Binary files are not supported');
    return text;
  }
  private async files(start: string, signal: AbortSignal): Promise<string[]> {
    const paths: string[] = [];
    const visit = async (path: string, depth: number): Promise<void> => {
      signal.throwIfAborted(); if (paths.length >= 1000 || depth > 12) return;
      const info = await lstat(path); if (info.isSymbolicLink()) return;
      if (info.isFile()) { paths.push(path); return; }
      if (!info.isDirectory()) return;
      for (const entry of (await readdir(path)).sort()) { if (!ignored.has(entry)) await visit(join(path, entry), depth + 1); }
    };
    await visit(start, 0); return paths;
  }
  private async approve(_call: HarnessToolCall, toolCall: AgentPermission['toolCall'], signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return new Promise<boolean>((resolve, reject) => {
      const cancel = () => { reject(signal.reason ?? new Error('Session stopped')); };
      signal.addEventListener('abort', cancel, { once: true });
      this.options.onPermission({ toolCall, options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Approve' }, { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
      ] }).then(choice => { signal.removeEventListener('abort', cancel); if (signal.aborted) cancel(); else resolve(choice === 'allow'); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    });
  }
  private shell(command: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const env = harnessShellEnvironment(this.options.cwd, this.options.gateway);
    return new Promise((resolve, reject) => {
      const windows = process.platform === 'win32';
      const child = spawn(windows ? 'powershell.exe' : '/bin/bash', windows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['--noprofile', '--norc', '-c', command],
        { cwd: this.options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
      let output = '', timedOut = false, overflow = false;
      const kill = () => {
        if (!child.pid) return;
        if (windows) { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.on('error', () => child.kill()); }
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      };
      const capture = (chunk: string) => { output += chunk; if (output.length > HARNESS_LIMITS.toolOutputCharacters) { output = output.slice(0, HARNESS_LIMITS.toolOutputCharacters); overflow = true; kill(); } };
      child.stdout.setEncoding('utf8').on('data', capture); child.stderr.setEncoding('utf8').on('data', capture);
      const timer = setTimeout(() => { timedOut = true; kill(); }, HARNESS_LIMITS.shellTimeoutMs);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', kill); };
      signal.addEventListener('abort', kill, { once: true }); if (signal.aborted) kill();
      child.once('error', () => { cleanup(); reject(new Error('Could not start the platform shell')); });
      child.once('close', code => { cleanup(); if (signal.aborted) reject(signal.reason ?? new Error('Session stopped'));
        else resolve(`${output}\nExit code: ${code ?? 'terminated'}${timedOut ? ' (30 second limit)' : overflow ? ' (output limit)' : ''}`); });
    });
  }
}
