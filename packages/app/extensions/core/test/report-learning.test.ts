import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeReport, ReportInsights } from '@factoryze/protocol';
import { reportLearning, reportPromptRows, reportFacts } from '../src/browser/report-learning.ts';

const report: PracticeReport = { schema: 1, kind: 'practice', taskId: 'library-fines', submittedAt: '2026-10-24T00:00:00.000Z',
  correctness: { passed: 9, total: 9 }, usage: [],
  workspaceUsage: [{ scope: { userId: 'synthetic', taskId: 'library-fines', profile: 'factoryze@0.1.0', model: 'synthetic' },
    raw: { input: 100, output: 10, cacheRead: 60, cacheWrite: 5 }, weighted: 56,
    requests: 5, incompleteRequests: 0, promptTurns: 1, promptTurnsComplete: true }],
  promptAssessments: [{ promptId: 'p1', model: 'synthetic', status: 'off', acceptedEdit: false }] };
const insights: ReportInsights = { schema: 1, coverage: 'recorded', prompts: [{ promptId: 'p1', index: 1, weighted: 56, state: 'complete' }],
  tools: { exploration: 3, editing: 1, commands: 1, failed: 0, unfinished: 0 }, approvals: { approved: 2, declined: 0, cancelled: 0 },
  incompleteRequests: 0, attribution: [
    { kind: 'prompt', requests: 1, weighted: 5 }, { kind: 'exploration', requests: 3, weighted: 45 },
    { kind: 'editing', requests: 1, weighted: 6 }, { kind: 'commands', requests: 0, weighted: 0 },
    { kind: 'mixed', requests: 0, weighted: 0 }, { kind: 'unattributed', requests: 0, weighted: 0 }] };

test('report analysis separates measured tokens without generating suggestions or prompt scores', () => {
  const learning = reportLearning({ ...report, insights });
  assert.deepEqual(learning.tokens.map(item => [item.label, item.value]), [['Fresh input', 35], ['Cache reads', 60], ['Cache writes', 5], ['Output', 10]]);
  assert.equal(learning.measured, 56);
  assert.equal('advice' in learning, false);
  assert.equal('scoring' in learning, false);
  assert.equal(learning.buckets.find(item => item.kind === 'exploration')!.percent, 80.4);
  assert.equal(learning.buckets.some(item => /context/.test(item.label)), false);
});

test('legacy prompt costs stay unknown while snapshotted zero and positive costs remain explicit', () => {
  assert.equal(reportPromptRows(report)[0]!.weighted, null);
  assert.equal(reportPromptRows(report)[0]!.state, undefined);
  assert.match(reportLearning(report).coverageNote, /earlier submission/i);
  const saved = { ...report, insights: { ...insights, prompts: [...insights.prompts, { promptId: 'p2', index: 2, weighted: 0, state: 'failed' as const }] } };
  assert.deepEqual(reportPromptRows(saved).map(prompt => [prompt.promptId, prompt.weighted]), [['p1', 56], ['p2', 0]]);
  assert.equal(reportPromptRows(saved)[1]!.assessment, undefined);
});

test('partial accounting and unavailable history remain visible without suggestions', () => {
  assert.match(reportLearning({ ...report, insights: { ...insights, incompleteRequests: 1, coverage: 'partial' } }).coverageNote, /incomplete/i);
  assert.match(reportLearning({ ...report, insights: { ...insights, coverage: 'unavailable' } }).coverageNote, /unavailable/i);
  assert.equal(reportLearning({ ...report, workspaceUsage: undefined }).measured, null);
});

test('manual attempts show no model usage and never claim commands prove tests ran', () => {
  const learning = reportLearning({ ...report, workspaceUsage: [], promptAssessments: [], insights: { ...insights, prompts: [],
    tools: { exploration: 0, editing: 0, commands: 0, failed: 0, unfinished: 0 },
    attribution: insights.attribution.map(bucket => ({ ...bucket, weighted: 0, requests: 0 })) } });
  assert.equal(learning.measured, 0);
  assert.equal(learning.requests, 0);
  assert.equal(reportPromptRows({ ...report, promptAssessments: [], insights: { ...insights, prompts: [] } }).length, 0);
});

test('summary facts retain saved usage, multiple models and missing legacy data without invented zeroes', () => {
  const facts = reportFacts({ ...report, insights }, 1000, '2026-10-23T23:48:00.000Z');
  assert.equal(facts.weighted, 56); assert.equal(facts.prompts, 1); assert.equal(facts.minutes, 12);
  assert.deepEqual(facts.models, ['synthetic']);
  assert.equal(reportFacts({ ...report, workspaceUsage: undefined, promptAssessments: [] }, 1000).prompts, null);
  assert.equal(reportFacts({ ...report, workspaceUsage: undefined }, 1000).weighted, null);
  assert.equal(reportFacts(report, 1000, 'invalid').minutes, null);
  assert.equal(reportFacts(report, 1000, '2026-10-25T00:00:00.000Z').minutes, null);
  const multiple = reportFacts({ ...report, workspaceUsage: [report.workspaceUsage![0]!,
    { ...report.workspaceUsage![0]!, scope: { ...report.workspaceUsage![0]!.scope, model: 'second' } }] }, 1000);
  assert.deepEqual(multiple.models, ['synthetic', 'second']); assert.equal(multiple.weighted, 112);
});
