import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeReport } from '@factoryze/protocol';
import { baselineLines, baselineNote, workspaceUsageLine } from '../src/browser/practice-report-copy.ts';

const report: PracticeReport = {
  schema: 1, kind: 'practice', taskId: 'dedupe-ids', submittedAt: '2026-10-21T00:00:00.000Z',
  correctness: { passed: 1, total: 1 }, usage: [],
  workspaceUsage: [{ scope: { userId: 'student', taskId: 'dedupe-ids', profile: 'opencode@1.18.29', model: 'synthetic' },
    raw: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 }, weighted: 14,
    requests: 1, incompleteRequests: 0, promptTurns: 1, promptTurnsComplete: true }],
  baselineComparisons: [{ profile: 'opencode@1.18.29', model: 'synthetic', baselinePromptsHash: 'a'.repeat(64),
    weightedTokensRatio: 2, promptTurnsRatio: 0.5 }]
};

test('report copy shows measured turns and separate expert token and turn ratios', () => {
  assert.match(workspaceUsageLine(report.workspaceUsage![0]), /1 completed prompt turn/);
  assert.deepEqual(baselineLines(report), ['synthetic · opencode@1.18.29: 2.00× expert weighted tokens · 0.50× expert prompt turns']);
  assert.match(baselineNote(report), /descriptive/i);
  assert.match(workspaceUsageLine({ ...report.workspaceUsage![0], promptTurns: undefined }), /turn count unavailable/);
  assert.match(baselineNote({ ...report, workspaceUsage: [{ ...report.workspaceUsage![0], promptTurnsComplete: false }],
    baselineComparisons: [] }), /historical model calls/i);
});

test('report copy explains missing and invalid comparisons without inventing a score', () => {
  assert.match(baselineNote({ ...report, baselineComparisons: [] }), /no matching measured expert baseline/i);
  assert.match(baselineNote({ ...report, baselineComparisons: [], baselineWarning: 'invalid-or-stale' }), /invalid or stale/i);
  assert.match(baselineNote({ ...report, correctness: { passed: 0, total: 1 }, baselineComparisons: [] }), /hidden checks/i);
  assert.match(baselineNote({ ...report, workspaceUsage: undefined, baselineComparisons: undefined }), /earlier report/i);
});
