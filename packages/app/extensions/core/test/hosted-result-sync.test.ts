import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopResultInput, HostedResultView, PracticeReport } from '@factoryze/protocol';
import type { HostedAttempt } from '@factoryze/engine/solo';
import { TrialClient, type ResultSubmission } from '@factoryze/engine/trial-client';
import { TrialConnectionStore } from '../src/node/trial-connection.ts';
import { gradeAndSync, retryHostedResult, type HostedEngine, type ResultService } from '../src/node/hosted-result-sync.ts';
import { hostedResultCopy, ordinal } from '../src/browser/hosted-result-copy.ts';

const payload: DesktopResultInput = { attemptId: '8a6e0804-2bd0-4672-b79e-d4cb1a7d1abf', taskId: 'retry-storm', packSha256: 'a'.repeat(64), funding: 'hosted',
  model: 'trial-coder', budgetTokens: 20000, weightedTokens: 13900, usage: { inputTokens: 10000, cachedInputTokens: 500, outputTokens: 3900 },
  passed: 6, total: 6, submittedAt: '2026-11-20T10:00:00.000Z' };
const recorded = { recorded: true, counted: true, solved: true, tokenCheck: 'checked', standing: { board: 'hosted', rank: 38, solved: 6 } } as const;
const report = { schema: 1, kind: 'practice', taskId: 'retry-storm', submittedAt: payload.submittedAt, correctness: { passed: 6, total: 6 }, usage: [] } as PracticeReport;

function fakes(options: { hosted?: boolean; testFiles?: 'unchanged' | 'edited'; signedIn?: boolean; sent?: number; ineligible?: string; result?: ResultSubmission } = {}) {
  const calls = { grade: 0, sent: [] as DesktopResultInput[], plans: [] as boolean[], order: [] as string[] };
  const saved = new Map<number, { view: HostedResultView; payload?: DesktopResultInput }>();
  let sentSubmission = options.sent;
  const attempt = (): HostedAttempt => ({ attemptId: payload.attemptId, workspace: '/w', taskId: 'retry-storm', packSha256: payload.packSha256, archiveBytes: 1,
    budgetTokens: 20000, tests: { digest: 'b'.repeat(64), publicFiles: [] }, results: {}, ...(sentSubmission ? { sent: { submission: sentSubmission } } : {}) });
  const engine: HostedEngine = {
    hostedAttempt: async () => options.hosted === false ? undefined : attempt(),
    hostedTestFiles: async () => { calls.order.push('digest'); return options.testFiles ?? 'unchanged'; },
    submissionCount: async () => 1,
    hostedResultPlan: async (_workspace, _report, includeSolution) => {
      calls.plans.push(includeSolution);
      const facts = { taskId: 'retry-storm', budgetTokens: 20000, passed: 6, total: 6, weightedTokens: 13900, model: 'trial-coder', funding: 'hosted' as const };
      if (options.ineligible) return { attempt: attempt(), facts, ineligible: options.ineligible };
      return { attempt: attempt(), facts, payload: includeSolution ? { ...payload, solution: { files: [{ path: 'app.py', content: 'x' }] } } : payload };
    },
    saveHostedResult: async (_workspace, submission, view, extra = {}) => { saved.set(submission, { view, ...(extra.payload ? { payload: extra.payload } : {}) }); if (extra.sent) sentSubmission = submission; },
    hostedResult: async (_workspace, submission) => saved.get(submission),
  };
  let result = options.result ?? { kind: 'recorded', response: recorded };
  const service: ResultService = { signedIn: async () => options.signedIn ?? true, leaderboardURL: () => 'https://code.factoryze.tech/leaderboard/',
    submitResult: async input => { calls.sent.push(input); return result; } };
  const grade = async () => { calls.order.push('grade'); calls.grade++; return report; };
  return { engine, service, grade, calls, saved, setResult: (next: ResultSubmission) => { result = next; } };
}

test('a hosted attempt checks its test files before grading and sends one result while signed in', async () => {
  const { engine, service, grade, calls, saved } = fakes();
  assert.equal(await gradeAndSync(engine, service, '/w', grade), report);
  assert.deepEqual(calls.order, ['digest', 'grade']);
  assert.deepEqual(calls.sent, [payload]); assert.equal('solution' in calls.sent[0]!, false, 'No consent, no solution field');
  const view = saved.get(1)!.view;
  assert.equal(view.sync.status, 'sent'); assert.equal(saved.get(1)!.payload, undefined);
  const copy = hostedResultCopy(view);
  assert.equal(copy.headline, 'Solved.'); assert.match(copy.message, /38th/); assert.equal(copy.action, 'leaderboard');
  assert.equal(copy.testFiles, 'Unchanged'); assert.doesNotMatch(JSON.stringify(copy), /verified/i);
  await gradeAndSync(engine, service, '/w', grade);
  assert.equal(calls.sent.length, 1, 'Later submissions of the same attempt are not sent');
});

test('the solution is read and sent only with consent', async () => {
  const { engine, service, grade, calls } = fakes();
  await gradeAndSync(engine, service, '/w', grade, { includeSolution: true });
  assert.deepEqual(calls.plans, [true]); assert.deepEqual(calls.sent[0]!.solution, { files: [{ path: 'app.py', content: 'x' }] });
  const edited = fakes({ testFiles: 'edited' });
  await gradeAndSync(edited.engine, edited.service, '/w', edited.grade, { includeSolution: true });
  assert.deepEqual(edited.calls.plans, [false], 'Files are not read for a result that will not be sent');
});

test('never-send cases grade locally without calling the results route', async () => {
  for (const [options, status] of [[{ hosted: false }, undefined], [{ testFiles: 'edited' }, 'not_counted_edited'], [{ signedIn: false }, 'signed_out'],
    [{ sent: 1 }, 'already_sent'], [{ ineligible: 'No model requests were recorded in this attempt.' }, 'not_eligible']] as const) {
    const { engine, service, grade, calls, saved } = fakes(options);
    assert.equal(await gradeAndSync(engine, service, '/w', grade), report);
    assert.equal(calls.grade, 1); assert.deepEqual(calls.sent, []);
    assert.equal(saved.get(1)?.view.sync.status, status);
  }
  const edited = fakes({ testFiles: 'edited' });
  await gradeAndSync(edited.engine, edited.service, '/w', edited.grade);
  const copy = hostedResultCopy(edited.saved.get(1)!.view);
  assert.equal(copy.headline, 'Not counted.'); assert.match(copy.message, /test files were edited, so this result was not sent/); assert.equal(copy.action, 'restore');
});

test('quiet failures keep the exact body for an idempotent retry; rejections show a short message', async () => {
  const { engine, service, grade, calls, saved, setResult } = fakes({ result: { kind: 'unavailable' } });
  await gradeAndSync(engine, service, '/w', grade);
  assert.deepEqual(saved.get(1)!.view.sync, { status: 'unavailable', retry: true }); assert.deepEqual(saved.get(1)!.payload, payload);
  assert.match(hostedResultCopy(saved.get(1)!.view).message, /not available/);
  setResult({ kind: 'recorded', response: recorded });
  const view = await retryHostedResult(engine, service, '/w', 1);
  assert.equal(view?.sync.status, 'sent'); assert.deepEqual(calls.sent, [payload, payload]);
  assert.equal(saved.get(1)!.payload, undefined);

  const rejected = fakes({ result: { kind: 'rejected', code: 'token_mismatch', message: 'The service could not match this attempt\'s token count.' } });
  await gradeAndSync(rejected.engine, rejected.service, '/w', rejected.grade);
  assert.equal(rejected.saved.get(1)!.view.sync.status, 'rejected');
  assert.equal(await retryHostedResult(rejected.engine, rejected.service, '/w', 1).then(v => v?.sync.status), 'rejected');
  assert.equal(rejected.calls.sent.length, 1, 'A rejected result is not resent');
});

test('the client maps the results route responses, including a missing route, without throwing', async () => {
  const responses: (() => Response | Promise<Response>)[] = [];
  const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetcher: typeof fetch = async (url, init) => { seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) }); return responses.shift()!(); };
  const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const client = new TrialClient('https://trial.example', fetcher), token = 't'.repeat(43);
  responses.push(json(recorded));
  assert.deepEqual(await client.submitResult(token, payload), { kind: 'recorded', response: recorded });
  assert.equal(seen[0]!.url, 'https://trial.example/api/desktop/results');
  assert.equal(seen[0]!.headers['X-Factoryze-Desktop'], '1'); assert.equal(seen[0]!.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(seen[0]!.body, payload);
  responses.push(() => new Response('404 page not found', { status: 404 }), json({ error: { code: 'task_not_found' } }, 404),
    json({ error: { code: 'service_unavailable' } }, 503), () => { throw new TypeError('synthetic network failure'); }, json({ recorded: true }));
  for (let i = 0; i < 5; i++) assert.deepEqual(await client.submitResult(token, payload), { kind: 'unavailable' });
  for (const code of ['task_version_mismatch', 'token_mismatch', 'result_exists']) {
    responses.push(json({ error: { code } }, 409));
    const result = await client.submitResult(token, payload);
    assert.equal(result.kind, 'rejected'); assert.equal(result.kind === 'rejected' && result.code, code);
    assert.ok(result.kind === 'rejected' && result.message.length < 200);
  }
  responses.push(json({ error: { code: 'result_limit_reached' } }, 429));
  assert.equal((await client.submitResult(token, payload)).kind, 'rejected');
  responses.push(json({ error: { code: 'authentication_required' } }, 401));
  assert.deepEqual(await client.submitResult(token, payload), { kind: 'sign_in' });
  await assert.rejects(client.submitResult(token, { ...payload, rank: 1 } as DesktopResultInput), /unrecognized|rank/i);
  assert.equal(responses.length, 0);
});

test('a signed-out store never sends, and the leaderboard follows the configured service origin', async () => {
  let requests = 0;
  const store = new TrialConnectionStore({ read: async () => null, write: async () => {} }, 'http://127.0.0.1:8091', async () => { requests++; return new Response('{}'); });
  assert.equal(await store.signedIn(), false);
  assert.deepEqual(await store.submitResult(payload), { kind: 'sign_in' }); assert.equal(requests, 0);
  assert.equal(store.leaderboardURL(), 'http://127.0.0.1:8091/leaderboard/');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 38, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '38th', '101st']);
});
