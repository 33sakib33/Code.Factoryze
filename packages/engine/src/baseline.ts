import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baselineComparisonSchema, benchmarkBaselineSchema,
  type BaselineComparison, type BenchmarkBaseline, type BenchmarkPrompts, type WorkspaceUsage } from '@factoryze/protocol';
import { loadBenchmarkPrompts } from '#tasks';

export const benchmarkPromptsHash = (prompts: BenchmarkPrompts): string =>
  createHash('sha256').update(JSON.stringify(prompts)).digest('hex');

/** Missing baselines are expected; stale or mismatched files cannot be compared. */
export async function loadBenchmarkBaseline(options: {
  packRoot: string; baselineRoot?: string; taskId: string; profile: string; model: string;
}): Promise<BenchmarkBaseline | null> {
  const taskId = benchmarkBaselineSchema.shape.taskId.parse(options.taskId);
  const profile = benchmarkBaselineSchema.shape.profile.parse(options.profile);
  const model = benchmarkBaselineSchema.shape.model.parse(options.model);
  const file = join(options.baselineRoot ?? options.packRoot, taskId, 'baselines', profile, `${encodeURIComponent(model)}.json`);
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const baseline = benchmarkBaselineSchema.parse(JSON.parse(source));
  if (baseline.taskId !== taskId || baseline.profile !== profile || baseline.model !== model)
    throw new Error('Benchmark baseline does not match the requested task, profile and model');
  if (baseline.promptsHash !== benchmarkPromptsHash(await loadBenchmarkPrompts(options.packRoot, taskId)))
    throw new Error('Benchmark baseline does not match the current prompt script');
  return baseline;
}

/** Descriptive ratios, not a scoring-version formula. Correctness gates comparison. */
export function compareWithExpertBaseline(
  correctness: { passed: number; total: number }, usage: WorkspaceUsage, baseline: BenchmarkBaseline
): BaselineComparison | null {
  if (correctness.total === 0 || correctness.passed !== correctness.total ||
    baseline.expert.correctness.total !== correctness.total ||
    baseline.expert.correctness.passed !== baseline.expert.correctness.total ||
    baseline.expert.weightedTokens <= 0 || usage.requests === 0 || usage.incompleteRequests !== 0 ||
    !usage.promptTurns || usage.promptTurnsComplete !== true || usage.scope.taskId !== baseline.taskId ||
    usage.scope.profile !== baseline.profile || usage.scope.model !== baseline.model) return null;
  return baselineComparisonSchema.parse({ profile: baseline.profile, model: baseline.model,
    baselinePromptsHash: baseline.promptsHash,
    weightedTokensRatio: usage.weighted / baseline.expert.weightedTokens,
    promptTurnsRatio: usage.promptTurns / baseline.expert.turns });
}
