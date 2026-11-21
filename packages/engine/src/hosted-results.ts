import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desktopResultInputSchema, desktopResultModelSchema, hostedResultViewSchema,
  type DesktopResultInput, type HostedResultView, type PracticeReport } from '@factoryze/protocol';
import type { TestFileRecord } from './test-files.ts';

/** A practice attempt started from the service's hosted catalog. Only these attempts can ever send a result. */
export type HostedAttempt = {
  attemptId: string; workspace: string; taskId: string;
  /** The archive sha256 that was verified at download: the task version the service ranks. */
  packSha256: string; archiveBytes: number;
  /** The task manifest's weighted-token budget (or the documented default), never a local override. */
  budgetTokens: number;
  tests: TestFileRecord;
  /** Set once a result for this attempt was recorded by the service. Later submissions are not sent. */
  sent?: { submission: number };
  /** Per-submission outcome shown on the report. A payload is kept only while a retry is possible. */
  results: Record<string, { view: HostedResultView; payload?: DesktopResultInput }>;
};
type HostedFile = { schema: 'hosted-attempts@1'; attempts: Record<string, HostedAttempt> };

/** Small JSON record beside the usage database. It is kept separate so the usage database schema is unchanged. */
export class HostedAttemptStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  private async read(): Promise<HostedFile> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data?.schema === 'hosted-attempts@1' && data.attempts && typeof data.attempts === 'object') return data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    return { schema: 'hosted-attempts@1', attempts: {} };
  }
  private async write(data: HostedFile): Promise<void> {
    const staging = `${this.file}.${process.pid}.tmp`;
    await writeFile(staging, JSON.stringify(data), { mode: 0o600 });
    await rename(staging, this.file);
  }
  /** Serializes read-modify-write cycles within this process. */
  update<T>(change: (data: HostedFile) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { const data = await this.read(); const result = await change(data); await this.write(data); return result; });
    this.queue = next.catch(() => undefined);
    return next;
  }
  async get(attemptId: string): Promise<HostedAttempt | undefined> { await this.queue; return (await this.read()).attempts[attemptId]; }
  add(attempt: Omit<HostedAttempt, 'results'>): Promise<void> { return this.update(data => { data.attempts[attempt.attemptId] = { ...attempt, results: {} }; }); }
}

export const DEFAULT_BUDGET_TOKENS = 100_000;
/** The service's rule: input 1, output 1, cache read 0.1, cache write 1, so weighted = input + output - 0.9 × cached input. */
export function resultWeightedTokens(raw: { input: number; output: number; cacheRead: number }): number { return raw.input + raw.output - 0.9 * raw.cacheRead; }

/** Facts for the report and, when the attempt qualifies, the exact request body. Never includes a rank, score or "solved". */
export function hostedResultFacts(attempt: HostedAttempt, report: PracticeReport): {
  facts: Omit<HostedResultView, 'sync' | 'testFiles'>; payload?: DesktopResultInput; ineligible?: string } {
  const used = (report.workspaceUsage ?? []).filter(item => item.requests > 0);
  const weighted = used.reduce((sum, item) => sum + item.weighted, 0);
  const pins = report.executionPins ?? [];
  const model = used.length === 1 ? used[0]!.scope.model : undefined;
  const fundings = new Set(pins.filter(pin => pin.model === model).map(pin => pin.funding === 'trial' ? 'hosted' as const : 'own_key' as const));
  const funding = fundings.size === 1 ? [...fundings][0] : undefined;
  const facts = { taskId: attempt.taskId, budgetTokens: attempt.budgetTokens, passed: report.correctness.passed, total: report.correctness.total,
    ...(used.length ? { weightedTokens: Math.round(weighted * 1e6) / 1e6 } : {}),
    ...(model ? { model: model.slice(0, 200) } : {}), ...(funding ? { funding } : {}) };
  const ineligible = report.lab ? 'Lab results are never sent.'
    : report.taskId !== attempt.taskId ? 'This report belongs to a different task.'
    : !used.length ? 'No model requests were recorded in this attempt.'
    : used.some(item => item.incompleteRequests > 0) ? 'Token accounting for this attempt is incomplete.'
    : used.length > 1 ? 'This attempt used more than one model.'
    : !funding ? fundings.size > 1 ? 'This attempt mixed trial credits and your own API key.' : 'The model connection for this attempt was not recorded.'
    : !desktopResultModelSchema.safeParse(model).success ? 'This model id cannot be sent.'
    : Math.abs(resultWeightedTokens(used[0]!.raw) - weighted) > 0.01 ? 'This attempt used different token weights.' : undefined;
  if (ineligible) return { facts, ineligible };
  const raw = used[0]!.raw;
  // The service recomputes weighted tokens from these totals with the solo weights; round up, since over-reporting only counts against the player.
  const payload = desktopResultInputSchema.parse({ attemptId: attempt.attemptId, taskId: attempt.taskId, packSha256: attempt.packSha256,
    funding, model, budgetTokens: attempt.budgetTokens, weightedTokens: Math.ceil(Math.round(resultWeightedTokens(raw) * 1e6) / 1e6),
    usage: { inputTokens: raw.input, cachedInputTokens: raw.cacheRead, outputTokens: raw.output },
    passed: report.correctness.passed, total: report.correctness.total, submittedAt: report.submittedAt });
  return { facts, payload };
}

export function hostedResultView(view: HostedResultView): HostedResultView { return hostedResultViewSchema.parse(view); }

const SOLUTION_LIMITS = { files: 32, fileBytes: 64 * 1024, totalBytes: 256 * 1024 };
/** Workspace text files the player added or changed relative to the pack's starter files. Dot paths, caches and
 * environments are skipped, so a local `.env` or `.venv` is never read. Returns null when the files exceed the service limits. */
export async function solutionFiles(starter: string, workspace: string): Promise<{ path: string; content: string }[] | null> {
  const files: { path: string; content: string }[] = [];
  let total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const walk = async (directory: string, prefix: string): Promise<boolean> => {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith('.') || ['__pycache__', 'node_modules'].includes(name) || name.endsWith('.pyc')) continue;
      const path = prefix + name, full = join(directory, name), info = await lstat(full);
      if (info.isDirectory()) { if (!await walk(full, path + '/')) return false; continue; }
      if (!info.isFile()) continue;
      const bytes = await readFile(full);
      const original = await readFile(join(starter, ...path.split('/'))).catch(() => undefined);
      if (original?.equals(bytes)) continue;
      let content: string;
      try { content = decoder.decode(bytes); } catch { continue; }
      total += bytes.length;
      if (files.length >= SOLUTION_LIMITS.files || bytes.length > SOLUTION_LIMITS.fileBytes || total > SOLUTION_LIMITS.totalBytes) return false;
      files.push({ path, content });
    }
    return true;
  };
  return await walk(workspace, '') ? files : null;
}
