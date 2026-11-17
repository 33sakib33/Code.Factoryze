import test from 'node:test';
import assert from 'node:assert/strict';
import type { PracticeReport } from '@factoryze/protocol';
import { desktopResultShareInput } from '../src/node/report-publication.ts';

const report: PracticeReport = { schema: 1, kind: 'practice', taskId: 'delivery-rule', submittedAt: '2026-11-17T00:00:00.000Z',
  correctness: { passed: 2, total: 3 }, usage: [], workspaceUsage: [{ scope: { userId: 'local', taskId: 'delivery-rule', profile: 'factoryze@1.0.0', model: 'private-model' },
    raw: { input: 240, output: 60, cacheRead: 0, cacheWrite: 0 }, weighted: 300, requests: 2, incompleteRequests: 0 }] };

test('desktop publication projects saved counts and eligible token usage without private activity', () => {
  const input = desktopResultShareInput(report, 'Delivery rule', 900);
  assert.equal(input.passed, 2);
  assert.equal(input.weightedTokens, 300);
  assert.equal(input.budgetTokens, 900);
  assert.match(input.reportKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(input), /private-model|userId|prompt|workspace/);
  assert.equal(desktopResultShareInput(report, 'Delivery rule', 900).reportKey, input.reportKey);
});

test('incomplete usage and lab reports cannot publish misleading token or grade claims', () => {
  const incomplete: PracticeReport = { ...report, workspaceUsage: report.workspaceUsage!.map(row => ({ ...row, incompleteRequests: 1 })) };
  assert.equal(desktopResultShareInput(incomplete, 'Delivery rule', 900).weightedTokens, undefined);
  assert.throws(() => desktopResultShareInput({ ...report, lab: { id: 'classroom', studentId: 'private', submissionId: 'private', snapshotHash: 'a'.repeat(64), revision: 1, releasedAt: report.submittedAt } }, 'Delivery rule', 900));
});
