import {createHash} from 'node:crypto';
import {browserCheckInputSchema, browserCheckJobSchema, browserCheckResultSchema,
  type BrowserCheckInput, type BrowserCheckResult} from '@factoryze/protocol';
import {DockerExecutionError, type DockerExecutor} from './docker-executor.ts';

const checkTimeoutMs = 5000, runTimeoutMs = 60000;
// Length-framed UTF-8 fields, rather than language-specific JSON escaping/order.
// The Go queue adapter must use this exact framing; see docs/browser-check-worker.md.
export function browserCheckInputHash(input: BrowserCheckInput): string {
  const value = browserCheckInputSchema.parse(Object.fromEntries(Object.keys(browserCheckInputSchema.shape).map(key => [key, input[key as keyof BrowserCheckInput]])));
  const hash = createHash('sha256');
  const field = (text: string) => {hash.update(String(Buffer.byteLength(text)) + ':'); hash.update(text);};
  for (const text of ['factoryze-browser-public-v1', String(value.schema), value.kind, value.jobId, value.attemptId,
    String(value.revision), value.archiveHash, value.image, value.minimumPython]) field(text);
  for (const entries of [value.files, value.publicChecks]) {
    field(String(entries.length));
    for (const file of [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {field(file.path); field(file.content);}
  }
  return hash.digest('hex');
}

/** Trusted worker only. Public checks provide feedback, never reward evidence. */
export function createBrowserChecker(executor: Pick<DockerExecutor, 'image' | 'run'>, options: {python: string}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(executor.image) || !/^3\.\d{1,2}\.\d{1,3}$/.test(options.python)) throw Error('Invalid browser checker configuration');
  return async (input: unknown, signal?: AbortSignal): Promise<BrowserCheckResult> => {
    const job = browserCheckJobSchema.parse(input);
    if (job.image !== executor.image) throw Error('Browser check image pin does not match this worker');
    if (browserCheckInputHash(job) !== job.inputHash) throw Error('Browser check input hash does not match the saved snapshot');
    const base = {schema: 1 as const, kind: 'public_checks' as const, jobId: job.jobId, attemptId: job.attemptId,
      revision: job.revision, inputHash: job.inputHash, trust: 'practice' as const, rewardEligible: false as const,
      provenance: {executor: 'docker' as const, image: executor.image, runner: 'factoryze-browser-public-v1' as const,
        python: options.python, checkTimeoutMs, runTimeoutMs}};
    const failure = (code: NonNullable<BrowserCheckResult['failure']>) => browserCheckResultSchema.parse({...base,
      status: code === 'cancelled' ? 'cancelled' : 'failed', passed: 0, total: 0, checks: [], failure: code});
    if (signal?.aborted) return failure('cancelled');
    if (Number(options.python.split('.')[1]) < Number(job.minimumPython.split('.')[1])) return failure('incompatible_python');
    const encode = (files: BrowserCheckInput['files']) => files.map(file => ({path: file.path, data: Buffer.from(file.content).toString('base64')}));
    const files = encode(job.files), hidden = encode(job.publicChecks), deadline = Date.now() + runTimeoutMs;
    const run = (argv: string[], limit: number) => executor.run({files, hidden, argv: ['python', '-I', '/opt/factoryze/runner.py', ...argv],
      timeoutMs: limit, ...(signal ? {signal} : {})});
    let pending: {file: string; name: string}[];
    try {
      const discovery = await run(['discover'], 10000);
      const data = JSON.parse(discovery.stdout), allowed = new Set(job.publicChecks.map(file => file.path)), seen = new Set<string>();
      if (discovery.exitCode || discovery.oomKilled || !Array.isArray(data.checks) || !data.checks.length || data.checks.length > 20) return failure('invalid_checks');
      pending = data.checks.map((check: any) => {
        if (!check || !allowed.has(check.file) || typeof check.name !== 'string' || !/^test_[A-Za-z0-9_]+$/.test(check.name) || check.name.length > 64) throw Error('Invalid discovery');
        const key = `${check.file}::${check.name}`;
        if (seen.has(key)) throw Error('Duplicate discovery');
        seen.add(key); return {file: check.file, name: check.name};
      });
    } catch (error) {
      if (error instanceof DockerExecutionError && error.kind === 'cleanup') return failure('execution_unavailable');
      if (signal?.aborted) return failure('cancelled');
      return failure(error instanceof DockerExecutionError ? 'execution_unavailable' : 'invalid_checks');
    }
    const checks: BrowserCheckResult['checks'] = [];
    for (const check of pending) {
      if (signal?.aborted) return failure('cancelled');
      let outcome: BrowserCheckResult['checks'][number]['outcome'] = 'did_not_pass';
      const remaining = deadline - Date.now();
      if (remaining <= 0) outcome = 'run_limit';
      else try {
        const limit = Math.min(checkTimeoutMs, remaining);
        const result = await run(['check', check.file, check.name, String(Math.max(1, limit - 500))], limit);
        if (signal?.aborted) return failure('cancelled');
        if (result.oomKilled) outcome = 'memory_limit';
        else try {
          const verdict = JSON.parse(result.stdout);
          if (result.exitCode === 0 && verdict?.passed === true && Object.keys(verdict).length === 1) outcome = 'passed';
        } catch { /* Raw student output and exception text never leave the worker. */ }
      } catch (error) {
        if (error instanceof DockerExecutionError && error.kind === 'cleanup') return failure('execution_unavailable');
        if (signal?.aborted) return failure('cancelled');
        if (error instanceof DockerExecutionError && ['timeout', 'output-limit'].includes(error.kind)) outcome = error.kind === 'timeout' ? 'timeout' : 'output_limit';
        else return failure('execution_unavailable');
      }
      checks.push({name: `${check.file}::${check.name}`, passed: outcome === 'passed', outcome});
    }
    return browserCheckResultSchema.parse({...base, status: 'completed', passed: checks.filter(check => check.passed).length, total: checks.length, checks});
  };
}
