import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttemptSummary, ModelSettingsView, ReportSummary } from '@factoryze/protocol';
import type { PracticeTask } from '../src/common/task-service.ts';
import { guideActive, guideSteps, nextTask, nextTaskLabel, parseGuideProgress, starterPicks, startSheetModel } from '../src/browser/first-run.ts';

const task = (id: string, minutes?: number, extra: Partial<PracticeTask> = {}): PracticeTask =>
  ({ schema: 1, id, title: id.replaceAll('-', ' '), brief: 'Investigate the failure.', minimumPython: '3.11', timeHintMinutes: minutes, ...extra });
const attempt = (taskId: string, extra: Partial<AttemptSummary> = {}): AttemptSummary => ({
  workspace: `/attempts/${taskId}-1`, taskId, title: taskId, attempt: 1, startedAt: '2026-11-24T10:00:00.000Z', lastActivityAt: '2026-11-24T10:05:00.000Z',
  weighted: 0, budgetLimit: 20000, status: 'ready', submissions: 0, ...extra });
const report = (taskId: string): ReportSummary => ({ workspace: `/attempts/${taskId}-1`, taskId, title: taskId, attempt: 1, submission: 1, submissions: 1,
  submittedAt: '2026-11-24T10:06:00.000Z', passed: 5, total: 5, weighted: 1840, score: null });

const catalog = [task('library-fines', 40), task('webhook-allowlist', 25), task('latency-report', 7), task('delivery-fee', 5), task('duplicate-customers', 7),
  task('proc-stat-parser', 25), task('login-lockout', 7), task('retry-storm', 30)];

test('a first launch offers three starters with the five-minute task recommended', () => {
  const picks = starterPicks(catalog, []);
  assert.deepEqual(picks.map(pick => [pick.task.id, pick.recommended]),
    [['delivery-fee', true], ['duplicate-customers', false], ['latency-report', false]]);
});

test('starters disappear after the first submitted result and never include hosted or missing tasks', () => {
  assert.deepEqual(starterPicks(catalog, [report('delivery-fee')]), []);
  const withoutStarter = catalog.filter(item => item.id !== 'delivery-fee');
  assert.deepEqual(starterPicks(withoutStarter, []).map(pick => [pick.task.id, pick.recommended]),
    [['duplicate-customers', true], ['latency-report', false]]);
  const hostedTwin = [task('delivery-fee', 5, { hosted: true }), task('retry-storm', 30)];
  assert.deepEqual(starterPicks(hostedTwin, []), []);
});

test('the guide marks finished steps and points at the first one left', () => {
  assert.deepEqual(guideSteps({}).map(step => [step.id, step.state]),
    [['read', 'current'], ['ask', 'todo'], ['approve', 'todo'], ['test', 'todo'], ['submit', 'todo']]);
  assert.deepEqual(guideSteps({ read: true, ask: true }).map(step => step.state), ['done', 'done', 'current', 'todo', 'todo']);
  // Moving on to any later step means the brief was read.
  assert.deepEqual(guideSteps({ test: true }).map(step => step.state), ['done', 'current', 'todo', 'done', 'todo']);
  assert.deepEqual(guideSteps({ read: true, ask: true, approve: true, test: true, submit: true }).map(step => step.state),
    ['done', 'done', 'done', 'done', 'done']);
  assert.ok(guideSteps({}).every(step => step.label.length > 0 && step.hint.length > 0));
  assert.deepEqual(guideSteps({}).map(step => step.label), ['Read', 'Ask', 'Approve', 'Test', 'Submit']);
});

test('saved guide progress is read defensively', () => {
  assert.deepEqual(parseGuideProgress(null), {});
  assert.deepEqual(parseGuideProgress('not json'), {});
  assert.deepEqual(parseGuideProgress('[1,2]'), {});
  assert.deepEqual(parseGuideProgress('{"ask":true,"test":"yes","other":true,"submit":false}'), { ask: true });
});

test('the guide shows only for practice before the first result, until it is hidden', () => {
  assert.equal(guideActive({ reports: 0, dismissed: false, lab: false }), true);
  assert.equal(guideActive({ reports: 1, dismissed: false, lab: false }), false);
  assert.equal(guideActive({ reports: 0, dismissed: true, lab: false }), false);
  assert.equal(guideActive({ reports: 0, dismissed: false, lab: true }), false);
});

test('the next task follows the starter order, then the shortest one not attempted yet', () => {
  const fee = catalog.find(item => item.id === 'delivery-fee');
  // Win, then the trap, then the budget squeeze: the order the starters are meant to be met in.
  const second = nextTask(catalog, [attempt('delivery-fee', { submissions: 1 })], 'delivery-fee');
  assert.equal(second?.id, 'duplicate-customers');
  assert.equal(nextTaskLabel(fee, second!), 'Try a harder one');
  const third = nextTask(catalog, [attempt('delivery-fee'), attempt('duplicate-customers')], 'duplicate-customers');
  assert.equal(third?.id, 'latency-report');
  assert.equal(nextTaskLabel(catalog.find(item => item.id === 'duplicate-customers'), third!), 'Try another task');
  const starters = [attempt('delivery-fee'), attempt('duplicate-customers'), attempt('latency-report')];
  assert.equal(nextTask(catalog, starters, 'latency-report')?.id, 'login-lockout', 'after the starters, the shortest untried task');
  const withLab = nextTask(catalog, [...starters, attempt('login-lockout'), attempt('proc-stat-parser'), attempt('webhook-allowlist', { lab: 'lab-1' })], 'proc-stat-parser');
  assert.equal(withLab?.id, 'webhook-allowlist', 'a lab attempt does not count as practice');
  assert.equal(nextTask(catalog, catalog.map(item => attempt(item.id)), 'retry-storm'), undefined);
  assert.equal(nextTask([task('hosted-only', 10, { hosted: true }), task('delivery-fee', 5)], [], 'delivery-fee'), undefined);
});

test('the start sheet says whether a model is connected and how it is paid for', () => {
  const settings = (extra: Partial<ModelSettingsView>): ModelSettingsView => ({ schema: 1, agent: 'factoryze', api: 'openai-chat', baseURL: 'https://api.example.test/v1',
    model: 'coder-1', contextWindow: 128000, maxOutputTokens: 4096, hasKey: true, ...extra } as ModelSettingsView);
  assert.deepEqual(startSheetModel(null), { connected: false, text: 'Not connected. The agent needs a model.' });
  assert.equal(startSheetModel(settings({ hasKey: false })).connected, false);
  assert.deepEqual(startSheetModel(settings({})), { connected: true, text: 'coder-1 · your API key' });
  assert.deepEqual(startSheetModel(settings({ source: 'environment' })), { connected: true, text: 'coder-1 · set on this computer' });
  assert.deepEqual(startSheetModel(settings({ authentication: 'trial', source: 'trial' })), { connected: true, text: 'Trial credits · coder-1' });
});
