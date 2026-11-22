import test from 'node:test';
import assert from 'node:assert/strict';
import type { PracticeReport } from '@factoryze/protocol';
import { reportShareSummary, reportShareCard, reportSharePostURL } from '../src/browser/report-share.ts';

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
  assert.equal(result, ['Fixed “Delivery <rule>” in 300 of 900 weighted tokens (33% of budget).',
    '3/3 checks passed · 90/100 optional score',
    'Can you beat it? https://code.factoryze.tech/download/',
    'Personal practice result · not independently verified'].join('\n'));
  assert.doesNotMatch(result, /test-model|prompt/i);
  const card = reportShareCard(result);
  assert.match(card, /Delivery &lt;rule&gt;/);
  assert.match(card, /Can you beat it\? https:\/\/code\.factoryze\.tech\/download\//);
  assert.match(card, /not independently verified/);
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

test('a result that did not pass every check is never called fixed', () => {
  const partial = reportShareSummary(report({ correctness: { passed: 2, total: 3 } }), 'Retry storm', 900);
  assert.equal(partial.split('\n')[0], '“Retry storm”: 2/3 checks passed.');
  assert.match(partial, /Can you fix it\? https:\/\/code\.factoryze\.tech\/download\/$/m);
  assert.doesNotMatch(partial, /Fixed|beat it/);
  assert.equal(reportShareSummary(report(), 'Old report', 900).split('\n')[0], 'Fixed “Old report”. 3/3 checks passed.');
});

test('the X compose link carries the words and a link of its own, and fits in one post', () => {
  const href = reportSharePostURL(report(), 'T'.repeat(200), 900, 'https://code.factoryze.tech/api/attempt-shares/abc');
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('url'), 'https://code.factoryze.tech/api/attempt-shares/abc');
  const text = url.searchParams.get('text')!;
  assert.match(text, /^Fixed “T{60}”\. 3\/3 checks passed\.\nCan you beat it\?\nSelf-reported practice result\.$/);
  assert.ok(text.length + 24 <= 280);
  assert.doesNotMatch(text, /https?:/);
  // With no public link yet, the post leads to the editor's download page.
  assert.equal(new URL(reportSharePostURL(report(), 'Library fines', 900)).searchParams.get('url'), 'https://code.factoryze.tech/download/');
});
