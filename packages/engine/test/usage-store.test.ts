import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { UsageStore } from '../src/usage-store.ts';

const scope = { userId: 'user-a', taskId: 'task-a', profile: 'opencode@1.18.29', model: 'test-model' };
const budget = { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } };
const usage = { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 };

test('usage persists per user/task/profile/model; reopening conversations cannot reset the budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-ledger-'));
  const file = join(root, 'usage.sqlite');
  let store = new UsageStore(file);
  try {
    const account = store.account(scope, budget);
    store.registerWorkspace('/workspace/a', scope.userId, scope.taskId);
    const first = store.begin(account);
    store.checkpoint(first, usage);
    store.finish(first, usage, true);
    store.finish(first, usage, true); // Completion must be idempotent.
    assert.equal(store.totals(account).weighted, 84);
    store.close();
    store = new UsageStore(file);
    const reopened = store.account(scope, { ...budget, limit: 9999 });
    assert.equal(reopened, account);
    assert.equal(store.totals(reopened).budgetLimit, 100);
    assert.deepEqual(store.usageForTask(scope.userId, scope.taskId).map(total => total.scope.model), ['test-model']);
    assert.deepEqual(store.usageForTask('user-b', scope.taskId), []);
    assert.deepEqual(store.workspace('/workspace/a', scope.userId), { taskId: 'task-a' });
    assert.throws(() => store.workspace('/workspace/a', 'user-b'), /practice task/i);
    assert.equal(store.totals(store.account({ ...scope, userId: 'user-b' }, budget)).weighted, 0);
    assert.equal(store.totals(store.account({ ...scope, taskId: 'task-b' }, budget)).weighted, 0);
    assert.equal(store.totals(store.account({ ...scope, model: 'other' }, budget)).weighted, 0);
    assert.equal(store.totals(store.account({ ...scope, profile: 'opencode@1.18.30' }, budget)).weighted, 0);
    const second = store.begin(reopened);
    store.finish(second, { input: 20, output: 0, cacheRead: 0, cacheWrite: 0 }, true);
    assert.equal(store.totals(reopened).weighted, 104);
    assert.equal(store.totals(reopened).status, 'exhausted');
    assert.throws(() => store.begin(reopened), /budget exhausted/i);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('practice attempt IDs persist and differ between workspaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factoryze-attempt-id-'));
  const file = join(dir, 'usage.sqlite');
  let store = new UsageStore(file);
  try {
    store.registerWorkspace('/run/one', 'student', 'delivery-fee');
    store.registerWorkspace('/run/two', 'student', 'delivery-fee');
    const first = store.attemptId('/run/one', 'student');
    assert.match(first, /^[a-f0-9-]{36}$/);
    assert.notEqual(first, store.attemptId('/run/two', 'student'));
    store.close(); store = new UsageStore(file);
    assert.equal(store.attemptId('/run/one', 'student'), first);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('schema 1 usage database migrates to append-only practice reports without losing usage', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-reports-'));
  const file = join(root, 'usage.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE usage_accounts (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, budget TEXT NOT NULL);
    CREATE TABLE model_requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, usage TEXT, at TEXT NOT NULL);
    CREATE TABLE practice_workspaces (workspace TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL);
    PRAGMA user_version=1;`);
  old.prepare('INSERT INTO usage_accounts VALUES (?, ?, ?)').run('old-account', JSON.stringify(scope), JSON.stringify(budget));
  old.prepare('INSERT INTO model_requests VALUES (?, ?, ?, ?, ?)').run('old-request', 'old-account', 'complete', JSON.stringify(usage), new Date().toISOString());
  old.prepare('INSERT INTO practice_workspaces VALUES (?, ?, ?)').run('/workspace/a', scope.userId, scope.taskId);
  old.close();
  const store = new UsageStore(file);
  try {
    assert.equal(store.totals('old-account').weighted, 84);
    const report = { schema: 1 as const, kind: 'practice' as const, taskId: scope.taskId,
      submittedAt: '2026-10-20T00:00:00.000Z', correctness: { passed: 1, total: 2 },
      usage: store.usageForTask(scope.userId, scope.taskId) };
    store.saveReport('/workspace/a', scope.userId, report);
    assert.deepEqual(store.latestReport('/workspace/a', scope.userId), report);
    assert.throws(() => store.latestReport('/workspace/a', 'another-user'), /practice task/i);
    store.saveReport('/workspace/a', scope.userId, { ...report, correctness: { passed: 2, total: 2 } });
    assert.equal(store.latestReport('/workspace/a', scope.userId)?.correctness.passed, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('unknown and crashed requests retain partial counts and block further spending after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-interrupted-'));
  const file = join(root, 'usage.sqlite');
  let store = new UsageStore(file);
  try {
    const account = store.account(scope, budget);
    const request = store.begin(account);
    store.checkpoint(request, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 });
    assert.throws(() => store.begin(account), /incomplete/i);
    store.close();
    store = new UsageStore(file);
    assert.equal(store.totals(account).weighted, 12);
    assert.equal(store.totals(account).status, 'incomplete');
    assert.throws(() => store.begin(account), /incomplete/i);
    store.finish(request, undefined, false);
    assert.equal(store.totals(account).raw.input, 10);
    assert.equal(store.totals(account).incompleteRequests, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('workspace usage isolates requests while the task budget remains cumulative', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-workspace-'));
  const store = new UsageStore(join(root, 'usage.sqlite'));
  try {
    const account = store.account(scope, { ...budget, limit: 200 });
    store.registerWorkspace('/workspace/a', scope.userId, scope.taskId);
    store.registerWorkspace('/workspace/b', scope.userId, scope.taskId);
    for (const [workspace, input] of [['/workspace/a', 10], ['/workspace/b', 20]] as const) {
      const request = store.begin(account, workspace);
      store.finish(request, { input, output: 2, cacheRead: 0, cacheWrite: 0 }, true);
    }
    assert.equal(store.totals(account).weighted, 34);
    assert.deepEqual(store.workspaceUsage('/workspace/a', scope.userId).map(item => [item.weighted, item.requests]), [[12, 1]]);
    assert.deepEqual(store.workspaceUsage('/workspace/b', scope.userId).map(item => [item.weighted, item.requests]), [[22, 1]]);
    assert.throws(() => store.workspaceUsage('/workspace/a', 'another-user'), /practice task/i);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('schema 2 migration preserves old reports and leaves old requests unattributed', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-schema2-'));
  const file = join(root, 'usage.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE usage_accounts (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, budget TEXT NOT NULL);
    CREATE TABLE model_requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, usage TEXT, at TEXT NOT NULL);
    CREATE TABLE practice_workspaces (workspace TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL);
    CREATE TABLE practice_reports (id INTEGER PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL, report TEXT NOT NULL);
    PRAGMA user_version=2;`);
  const report = { schema: 1 as const, kind: 'practice' as const, taskId: scope.taskId,
    submittedAt: '2026-10-20T00:00:00.000Z', correctness: { passed: 1, total: 2 }, usage: [] };
  old.prepare('INSERT INTO usage_accounts VALUES (?, ?, ?)').run('old-account', JSON.stringify(scope), JSON.stringify(budget));
  old.prepare('INSERT INTO model_requests VALUES (?, ?, ?, ?, ?)').run('old-request', 'old-account', 'complete', JSON.stringify(usage), new Date().toISOString());
  old.prepare('INSERT INTO practice_workspaces VALUES (?, ?, ?)').run('/workspace/a', scope.userId, scope.taskId);
  old.prepare('INSERT INTO practice_reports (workspace, user_id, report) VALUES (?, ?, ?)').run('/workspace/a', scope.userId, JSON.stringify(report));
  old.close();
  const store = new UsageStore(file);
  try {
    assert.equal(store.totals('old-account').weighted, 84);
    assert.deepEqual(store.workspaceUsage('/workspace/a', scope.userId), []);
    assert.deepEqual(store.latestReport('/workspace/a', scope.userId), report);
    const request = store.begin('old-account', '/workspace/a');
    store.finish(request, { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 }, true);
    assert.equal(store.workspaceUsage('/workspace/a', scope.userId)[0]?.weighted, 2);
    assert.equal(store.totals('old-account').weighted, 86);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('completed prompt turns persist by workspace and model after a schema 3 migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-turns-'));
  const file = join(root, 'usage.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE usage_accounts (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, budget TEXT NOT NULL);
    CREATE TABLE practice_workspaces (workspace TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL);
    CREATE TABLE model_requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, usage TEXT, at TEXT NOT NULL, workspace TEXT);
    CREATE TABLE practice_reports (id INTEGER PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL, report TEXT NOT NULL);
    PRAGMA user_version=3;`);
  old.prepare('INSERT INTO usage_accounts VALUES (?, ?, ?)').run('old-account', JSON.stringify(scope), JSON.stringify(budget));
  old.prepare('INSERT INTO practice_workspaces VALUES (?, ?, ?)').run('/workspace/a', scope.userId, scope.taskId);
  old.prepare('INSERT INTO practice_workspaces VALUES (?, ?, ?)').run('/workspace/b', scope.userId, scope.taskId);
  old.close();
  let store = new UsageStore(file);
  try {
    store.recordTurn('old-account', '/workspace/a');
    store.recordTurn('old-account', '/workspace/a');
    assert.equal(store.workspaceUsage('/workspace/a', scope.userId)[0]?.promptTurns, 2);
    assert.deepEqual(store.workspaceUsage('/workspace/b', scope.userId), []);
    assert.throws(() => store.recordTurn('old-account', '/workspace/bad'), /practice task/i);
    store.close();
    store = new UsageStore(file);
    assert.equal(store.workspaceUsage('/workspace/a', scope.userId)[0]?.promptTurns, 2);
    assert.equal(store.workspaceUsage('/workspace/a', scope.userId)[0]?.requests, 0);
    const other = store.account({ ...scope, model: 'other-model' }, budget);
    store.recordTurn(other, '/workspace/a');
    assert.deepEqual(store.workspaceUsage('/workspace/a', scope.userId).map(item => [item.scope.model, item.promptTurns]),
      [['other-model', 1], ['test-model', 2]]);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('schema 4 migration marks existing model history as incomplete for prompt-turn comparisons', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-legacy-turns-'));
  const file = join(root, 'usage.sqlite');
  let store: UsageStore | undefined = new UsageStore(file);
  try {
    const account = store.account(scope, budget);
    store.registerWorkspace('/workspace/old', scope.userId, scope.taskId);
    const request = store.begin(account, '/workspace/old');
    store.finish(request, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }, true);
    store.recordTurn(account, '/workspace/old');
    store.close();
    store = undefined;
    const old = new DatabaseSync(file);
    old.exec('DROP INDEX practice_workspaces_attempt; ALTER TABLE practice_workspaces DROP COLUMN attempt_id; DROP TABLE task_budget_overrides; ALTER TABLE practice_workspaces DROP COLUMN pack_root; ALTER TABLE practice_workspaces DROP COLUMN task_json; DROP TABLE legacy_prompt_usage; DROP TABLE practice_events; ALTER TABLE model_requests DROP COLUMN owner_pid; PRAGMA user_version=4;');
    old.close();
    store = new UsageStore(file);
    assert.equal(store.workspaceUsage('/workspace/old', scope.userId)[0]?.promptTurns, 1);
    assert.equal(store.workspaceUsage('/workspace/old', scope.userId)[0]?.promptTurnsComplete, false);
    store.registerWorkspace('/workspace/new', scope.userId, scope.taskId);
    const next = store.begin(account, '/workspace/new');
    store.finish(next, { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 }, true);
    store.recordTurn(account, '/workspace/new');
    assert.equal(store.workspaceUsage('/workspace/new', scope.userId)[0]?.promptTurnsComplete, true);
  } finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('schema 6 migrates task sources and budget overrides while retaining reports, events and usage', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-schema6-')), file = join(root, 'usage.sqlite');
  let store = new UsageStore(file);
  try {
    const account = store.account(scope, budget); store.registerWorkspace('/workspace', scope.userId, scope.taskId);
    const request = store.begin(account, '/workspace'); store.finish(request, { input: 4, output: 2, cacheRead: 0, cacheWrite: 0 }, true);
    store.appendEvent('/workspace', account, 'session', 'session_started@1', {});
    store.close();
    const previous = new DatabaseSync(file); previous.exec('DROP INDEX practice_workspaces_attempt; ALTER TABLE practice_workspaces DROP COLUMN attempt_id; DROP TABLE task_budget_overrides; ALTER TABLE practice_workspaces DROP COLUMN pack_root; ALTER TABLE practice_workspaces DROP COLUMN task_json; PRAGMA user_version=6;'); previous.close();
    store = new UsageStore(file); assert.deepEqual(store.workspace('/workspace', scope.userId), { taskId: scope.taskId });
    assert.equal(store.events('/workspace', scope.userId).length, 1); assert.equal(store.totals(account).weighted, 6);
    store.setBudgetOverride('/workspace', scope.userId, 5, 100); assert.equal(store.totals(account).status, 'exhausted'); assert.equal(store.totals(account).weighted, 6);
    store.close(); store = new UsageStore(file); assert.equal(store.budgetOverride(scope.userId, scope.taskId), 5);
    assert.equal(store.events('/workspace', scope.userId)[1].type, 'budget_changed@1');
    store.setBudgetOverride('/workspace', scope.userId, null, 100); assert.equal(store.totals(account).budgetLimit, 100); assert.equal(store.totals(account).weighted, 6);
    assert.throws(() => store.setBudgetOverride('/workspace', 'another-user', 500, 100), /practice task/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('fresh task workspaces have independent meters and budgets while cumulative history stays intact', () => {
  const store = new UsageStore(':memory:');
  try {
    store.registerWorkspace('/run/a', scope.userId, scope.taskId);
    store.registerWorkspace('/run/b', scope.userId, scope.taskId);
    const account = store.account(scope, { ...budget, limit: 10 });
    const first = store.begin(account, '/run/a');
    store.finish(first, { input: 8, output: 4, cacheRead: 0, cacheWrite: 0 }, true);
    assert.equal(store.totals(account, '/run/a').status, 'exhausted');
    assert.equal(store.totals(account, '/run/b').weighted, 0);
    assert.equal(store.totals(account, '/run/b').remaining, 10);
    const second = store.begin(account, '/run/b');
    store.finish(second, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 }, true);
    assert.deepEqual(store.totals(account, '/run/b').raw, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 });
    assert.equal(store.totals(account, '/run/b').weighted, 5);
    assert.equal(store.totals(account, '/run/b').status, 'ready');
    assert.throws(() => store.begin(account, '/run/a'), /budget exhausted/i);
    assert.equal(store.usageForTask(scope.userId, scope.taskId)[0]!.weighted, 17);
  } finally { store.close(); }
});

test('incomplete accounting blocks its own run without contaminating another task workspace', () => {
  const store = new UsageStore(':memory:');
  try {
    store.registerWorkspace('/run/a', scope.userId, scope.taskId);
    store.registerWorkspace('/run/b', scope.userId, scope.taskId);
    const account = store.account(scope, budget);
    store.finish(store.begin(account, '/run/a'), { input: 5, output: 1, cacheRead: 0, cacheWrite: 0 }, false);
    assert.equal(store.totals(account, '/run/a').status, 'incomplete');
    assert.throws(() => store.begin(account, '/run/a'), /incomplete/);
    assert.equal(store.totals(account, '/run/b').status, 'ready');
    assert.deepEqual(store.unresolved('/run/b', scope.userId), []);
    const next = store.begin(account, '/run/b'); store.rejected(next);
    assert.equal(store.unresolved('/run/a', scope.userId).length, 1);
  } finally { store.close(); }
});

test('prompt usage follows the event log order and flags prompts with unconfirmed counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factoryze-prompts-'));
  const store = new UsageStore(join(dir, 'usage.sqlite'));
  try {
    store.registerWorkspace('/w/a', scope.userId, scope.taskId);
    const account = store.account(scope, { ...budget, limit: 10_000 });
    const request = (used?: typeof usage, complete = true) => {
      const id = store.begin(account, '/w/a');
      store.appendEvent('/w/a', account, 's', 'model_request_started@1', { requestId: id });
      store.finish(id, used, complete);
    };
    request({ input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }); // Outside any prompt: not attributed.
    store.appendEvent('/w/a', account, 's', 'prompt_started@1', { promptId: 'p1' });
    request(usage); request({ input: 10, output: 0, cacheRead: 0, cacheWrite: 0 });
    store.appendEvent('/w/a', account, 's', 'prompt_ended@1', { promptId: 'p1', reason: 'end_turn' });
    store.appendEvent('/w/a', account, 's', 'prompt_started@1', { promptId: 'p2' });
    request(usage, false);
    store.appendEvent('/w/a', account, 's', 'prompt_ended@1', { promptId: 'p2', reason: 'cancelled' });
    store.appendEvent('/w/a', account, 's', 'prompt_started@1', { promptId: 'p3' });
    const prompts = store.promptUsage('/w/a', scope.userId);
    // 100 input including 40 cached reads: 60 + 4 + 20 output = 84 weighted.
    assert.deepEqual(prompts, [
      { promptId: 'p1', index: 1, weighted: 94, state: 'complete' },
      { promptId: 'p2', index: 2, weighted: 84, state: 'stopped', incomplete: true },
      { promptId: 'p3', index: 3, weighted: 0, state: 'running' },
    ]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
