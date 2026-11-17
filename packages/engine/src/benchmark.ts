import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { benchmarkBaselineSchema, type BenchmarkBaseline, type GatewayConnection } from '@factoryze/protocol';
import { gradePracticeTask } from '#grader';
import { preparePythonEnvironment } from '#python';
import { loadBenchmarkPrompts } from '#tasks';
import { SoloEngine, SOLO_PROFILE, type SoloSettings } from './solo.ts';
import { benchmarkPromptsHash } from './baseline.ts';
export { loadBenchmarkBaseline } from './baseline.ts';

type Scenario = 'expert' | 'middle' | 'naive';
type Options = {
  packRoot: string; taskId: string; outputRoot: string; settings: SoloSettings;
  run(input: { scenario: Scenario; workspace: string; connection: GatewayConnection; prompts: string[]; recordTurn(): void; checkBudget(): void; temperature?: number }): Promise<void>;
  preparePython?: (workspace: string, minimum: string) => Promise<unknown>;
  grade?: typeof gradePracticeTask;
  temperature?: number;
};
type ScenarioResult = BenchmarkBaseline['expert'];

/** One prompt sequence in its own disposable ledger and workspace. */
/** With keepFailed, a run that stops early still reports its usage and grade, with the error alongside. */
async function runScenario(options: Omit<Options, 'outputRoot'>, scenario: Scenario, prompts: string[], scratch: string,
  keepFailed = false): Promise<ScenarioResult & { error?: string }> {
  const engine = new SoloEngine({ dataDir: join(scratch, 'data'), userId: `benchmark-${scenario}`,
    settings: { ...options.settings, ...(options.temperature === undefined ? {} : { temperature: options.temperature }) }, preparePython: options.preparePython ?? preparePythonEnvironment,
    grade: options.grade ?? gradePracticeTask });
  try {
    const { workspace } = await engine.startTask(options.packRoot, options.taskId, join(scratch, 'workspaces'));
    const gateway = await engine.openGateway(workspace);
    const started = performance.now();
    let failure: string | undefined;
    try { await options.run({ scenario, workspace, connection: gateway.connection, prompts, recordTurn: gateway.recordTurn, checkBudget: gateway.checkBudget, temperature: gateway.connection.temperature }); }
    catch (error) { if (!keepFailed) throw error; failure = error instanceof Error ? error.message : String(error); }
    finally { await gateway.close(); }
    const elapsedMs = Math.round(performance.now() - started);
    const report = await engine.submitTask(options.packRoot, workspace);
    const usage = report.workspaceUsage?.filter(item => item.requests > 0);
    if (usage?.length !== 1 || usage[0].scope.profile !== SOLO_PROFILE || usage[0].scope.model !== options.settings.model ||
      usage[0].incompleteRequests) throw new Error(failure ?? `Benchmark ${scenario} run has missing or incomplete token usage`);
    if (failure === undefined && usage[0].promptTurns !== prompts.length)
      throw new Error(`Benchmark ${scenario} run has missing or mismatched completed prompt turns`);
    return { correctness: report.correctness, raw: usage[0].raw,
      weightedTokens: usage[0].weighted, requests: usage[0].requests,
      turns: usage[0].promptTurns ?? 0, elapsedMs, ...(failure === undefined ? {} : { error: failure }) };
  } finally { await engine.close(); }
}

/** Runs each prompt sequence in its own disposable ledger and workspace. */
export async function recordBenchmark(options: Options): Promise<{ file: string; baseline: BenchmarkBaseline }> {
  const prompts = await loadBenchmarkPrompts(options.packRoot, options.taskId);
  const file = join(options.outputRoot, options.taskId, 'baselines', SOLO_PROFILE, `${encodeURIComponent(options.settings.model)}.json`);
  try { await lstat(file); throw new Error(`Benchmark baseline already exists: ${file}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-'));
  try {
    const results = {} as Pick<BenchmarkBaseline, 'expert' | 'naive'>;
    for (const scenario of ['expert', 'naive'] as const)
      results[scenario] = await runScenario(options, scenario, prompts[scenario], join(scratch, scenario));
    const baseline = benchmarkBaselineSchema.parse({ schema: 1, taskId: options.taskId,
      profile: SOLO_PROFILE, model: options.settings.model,
      promptsHash: benchmarkPromptsHash(prompts),
      recordedAt: new Date().toISOString(), ...results });
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Benchmark baseline already exists: ${file}`);
        throw error;
      }
    } finally { await unlink(temporary).catch(() => {}); }
    return { file, baseline };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

type VarianceRun = Partial<ScenarioResult> & { error?: string };
type Spread = { completed: number; failed: number; solved: number; min: number; median: number; max: number; mean: number; stdev: number };

/** Spread of weighted tokens per scenario. Separated means every completed expert run cost less than every completed naive run. */
export function summarizeRuns(expert: VarianceRun[], naive: VarianceRun[], middle?: VarianceRun[]): { expert: Spread; naive: Spread; middle?: Spread; separated: boolean } {
  const spread = (runs: VarianceRun[]): Spread => {
    const done = runs.filter(run => run.weightedTokens !== undefined), tokens = done.map(run => run.weightedTokens!).sort((a, b) => a - b);
    const mean = tokens.reduce((sum, value) => sum + value, 0) / (tokens.length || 1), middle = tokens.length >> 1;
    const round = (value: number) => Math.round(value * 10) / 10;
    // Failed runs that spent tokens count towards the spread: dropping them would flatter the prompts that fail most.
    return { completed: runs.filter(run => !run.error).length, failed: runs.filter(run => run.error).length,
      solved: done.filter(run => run.correctness && run.correctness.passed === run.correctness.total).length,
      min: tokens[0] ?? 0, median: tokens.length % 2 ? tokens[middle] ?? 0 : round((tokens[middle - 1]! + tokens[middle]!) / 2),
      max: tokens.at(-1) ?? 0, mean: round(mean),
      stdev: round(Math.sqrt(tokens.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (tokens.length || 1))) };
  };
  const summary = { expert: spread(expert), naive: spread(naive), ...(middle ? { middle: spread(middle) } : {}) };
  return { ...summary, separated: summary.expert.completed > 0 && summary.naive.completed > 0 && summary.expert.max < summary.naive.min };
}

/** Repeats the expert and naive scripts, alternating them, to measure run-to-run spread. Writes no baseline. */
export async function measureBenchmarkVariance(options: Omit<Options, 'outputRoot'> & { runs: number }) {
  if (!Number.isSafeInteger(options.runs) || options.runs < 1) throw new Error('Runs must be a positive integer');
  const prompts = await loadBenchmarkPrompts(options.packRoot, options.taskId);
  const scratch = await mkdtemp(join(tmpdir(), 'factoryze-benchmark-variance-'));
  try {
    const scenarios = prompts.middle ? ['expert', 'middle', 'naive'] as const : ['expert', 'naive'] as const;
    const runs: Partial<Record<Scenario, VarianceRun[]>> = Object.fromEntries(scenarios.map(scenario => [scenario, []]));
    for (let index = 0; index < options.runs; index++) {
      for (const scenario of scenarios) {
        try { runs[scenario]!.push(await runScenario(options, scenario, prompts[scenario]!, join(scratch, `${scenario}-${index}`), true)); }
        catch (error) { runs[scenario]!.push({ error: error instanceof Error ? error.message : String(error) }); }
      }
    }
    return { taskId: options.taskId, profile: SOLO_PROFILE, model: options.settings.model, temperature: options.temperature ?? options.settings.temperature,
      promptsHash: benchmarkPromptsHash(prompts), recordedAt: new Date().toISOString(), expert: runs.expert!, naive: runs.naive!,
      ...(runs.middle ? { middle: runs.middle } : {}), summary: summarizeRuns(runs.expert!, runs.naive!, runs.middle) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
