import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkBaselineSchema, workspaceUsageSchema } from '@factoryze/protocol';
import { compareWithExpertBaseline } from '../src/baseline.ts';

const baseline = benchmarkBaselineSchema.parse({
  schema: 1, taskId: 'dedupe-ids', profile: 'opencode@1.18.29', model: 'synthetic',
  promptsHash: 'a'.repeat(64), recordedAt: '2026-10-21T00:00:00.000Z',
  expert: { correctness: { passed: 1, total: 1 }, raw: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 },
    weightedTokens: 7, requests: 1, turns: 2, elapsedMs: 100 },
  naive: { correctness: { passed: 1, total: 1 }, raw: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 },
    weightedTokens: 14, requests: 1, turns: 3, elapsedMs: 200 }
});
const usage = workspaceUsageSchema.parse({
  scope: { userId: 'student', taskId: 'dedupe-ids', profile: 'opencode@1.18.29', model: 'synthetic' },
  raw: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 }, weighted: 14,
  requests: 1, incompleteRequests: 0, promptTurns: 1, promptTurnsComplete: true
});

test('expert comparison requires solved work, matching model, complete usage and known turns', () => {
  assert.deepEqual(compareWithExpertBaseline({ passed: 1, total: 1 }, usage, baseline), {
    profile: 'opencode@1.18.29', model: 'synthetic', baselinePromptsHash: 'a'.repeat(64),
    weightedTokensRatio: 2, promptTurnsRatio: 0.5
  });
  assert.equal(compareWithExpertBaseline({ passed: 0, total: 1 }, usage, baseline), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, { ...usage, incompleteRequests: 1 }, baseline), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, { ...usage, promptTurns: undefined }, baseline), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, { ...usage, promptTurnsComplete: false }, baseline), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, { ...usage, scope: { ...usage.scope, model: 'other' } }, baseline), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, usage,
    { ...baseline, expert: { ...baseline.expert, correctness: { passed: 0, total: 1 } } }), null);
  assert.equal(compareWithExpertBaseline({ passed: 1, total: 1 }, usage,
    { ...baseline, expert: { ...baseline.expert, weightedTokens: 0 } }), null);
});
