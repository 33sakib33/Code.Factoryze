import test from 'node:test';
import assert from 'node:assert/strict';
import type { PracticeReport } from '@factoryze/protocol';
import { reportShareSummary, reportShareCard } from '../src/browser/report-share.ts';

const report = (overrides: Partial<PracticeReport> = {}): PracticeReport => ({
  schema: 1, kind: 'practice', taskId: 'delivery-rule', submittedAt: '2026-11-17T00:00:00.000Z',
  correctness: { passed: 3, total: 3 }, usage: [], workspaceUsage: [], ...overrides
});

test('share summary uses saved token totals and labels local practice honestly', () => {
  const result = reportShareSummary(report({ workspaceUsage: [{
    scope: { userId: 'local', taskId: 'delivery-rule', profile: 'factoryze@1', model: 'test-model' }, raw: { input: 250, output: 50, cacheRead: 0, cacheWrite: 0 },
    weighted: 300, requests: 2, promptTurns: 1, incompleteRequests: 0
  }] as PracticeReport['workspaceUsage'], scoring: { scoring_version: 1, correctness: 100, efficiency: 80, specificity: null, total: 90, unavailable: [] } }),
  'Delivery <rule>', 900);
  assert.match(result, /3\/3 checks/);
  assert.match(result, /300\/900 weighted tokens \(33% of budget\)/);
  assert.match(result, /90\/100 optional score/);
  assert.match(result, /Personal practice result/);
  assert.doesNotMatch(result, /test-model|prompt/i);
  const card = reportShareCard(result);
  assert.match(card, /Delivery &lt;rule&gt;/);
  assert.doesNotMatch(card, /Delivery <rule>/);
});

test('old or incomplete reports never claim a token efficiency result', () => {
  const old = reportShareSummary(report(), 'Old report', 900);
  assert.doesNotMatch(old, /weighted tokens|optional score/);
  const incomplete = reportShareSummary(report({ workspaceUsage: [{
    scope: { userId: 'local', taskId: 'delivery-rule', profile: 'factoryze@1', model: 'test-model' }, raw: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    weighted: 2, requests: 1, incompleteRequests: 1
  }] as PracticeReport['workspaceUsage'] }), 'Incomplete', 900);
  assert.doesNotMatch(incomplete, /weighted tokens/);
  assert.equal(reportShareSummary(report(), 'Problem\nVerified: yes', 900).split('\n').length, 3);
});
