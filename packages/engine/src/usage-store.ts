import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tokenUsageSchema, usageScopeSchema, usageTotalsSchema, workspaceUsageSchema, labConfigSchema, practiceReportSchema, eventSchema, reconciliationSchema, usageIssueSchema, promptUsageSchema,
  type PromptUsage,
  type FactoryzeEvent, type Reconciliation, type UsageIssue,
  type LabConfig, type PracticeReport, type TokenUsage, type UsageScope, type UsageTotals, type WorkspaceUsage } from '@factoryze/protocol';
import { weightedTokens } from '#meter';
import { summarizeReportActivity } from '#report-insights';

const zero = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
type AccountRow = { id: string; scope: string; budget: string };
type RequestRow = { id: string; status: string; usage: string | null };

export class AccountingError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Local ledger stores usage and reports, never prompts, provider keys, or bearer tokens. */
export class UsageStore {
  private readonly db: DatabaseSync;
  private readonly queues = new Map<string, Promise<void>>();
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
    if (typeof version !== 'number' || version < 0 || version > 8) {
      this.db.close(); throw new Error('Unsupported usage database version');
    }
    if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE usage_accounts (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, budget TEXT NOT NULL);
      CREATE TABLE model_requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES usage_accounts(id),
        status TEXT NOT NULL, usage TEXT, at TEXT NOT NULL);
      CREATE INDEX model_requests_account ON model_requests(account_id);
      CREATE TABLE practice_workspaces (workspace TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    if (version < 2) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE practice_reports (id INTEGER PRIMARY KEY, workspace TEXT NOT NULL REFERENCES practice_workspaces(workspace),
        user_id TEXT NOT NULL, report TEXT NOT NULL);
      CREATE INDEX practice_reports_workspace ON practice_reports(workspace, id);
      PRAGMA user_version=2; COMMIT;`);
    if (version < 3) this.db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE model_requests ADD COLUMN workspace TEXT REFERENCES practice_workspaces(workspace);
      CREATE INDEX model_requests_workspace ON model_requests(workspace, account_id);
      PRAGMA user_version=3; COMMIT;`);
    if (version < 4) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE practice_prompt_turns (workspace TEXT NOT NULL REFERENCES practice_workspaces(workspace),
        account_id TEXT NOT NULL REFERENCES usage_accounts(id), turns INTEGER NOT NULL CHECK (turns >= 0),
        PRIMARY KEY (workspace, account_id));
      PRAGMA user_version=4; COMMIT;`);
    if (version < 5) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE legacy_prompt_usage (workspace TEXT NOT NULL REFERENCES practice_workspaces(workspace),
        account_id TEXT NOT NULL REFERENCES usage_accounts(id), PRIMARY KEY (workspace, account_id));
      INSERT INTO legacy_prompt_usage (workspace, account_id)
        SELECT DISTINCT workspace, account_id FROM model_requests WHERE workspace IS NOT NULL;
      PRAGMA user_version=5; COMMIT;`);
    if (version < 6) this.db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE model_requests ADD COLUMN owner_pid INTEGER;
      CREATE TABLE practice_events (sequence INTEGER PRIMARY KEY, workspace TEXT NOT NULL REFERENCES practice_workspaces(workspace),
        account_id TEXT NOT NULL REFERENCES usage_accounts(id), event TEXT NOT NULL);
      CREATE INDEX practice_events_workspace ON practice_events(workspace, sequence);
      CREATE TRIGGER events_no_update BEFORE UPDATE ON practice_events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON practice_events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
      PRAGMA user_version=6; COMMIT;`);
    if (version < 7) this.db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE practice_workspaces ADD COLUMN pack_root TEXT;
      ALTER TABLE practice_workspaces ADD COLUMN task_json TEXT;
      CREATE TABLE task_budget_overrides (user_id TEXT NOT NULL, task_id TEXT NOT NULL, token_limit INTEGER NOT NULL CHECK(token_limit > 0), PRIMARY KEY(user_id, task_id));
      PRAGMA user_version=7; COMMIT;`);
    if (version < 8) {
      this.db.exec('BEGIN IMMEDIATE; ALTER TABLE practice_workspaces ADD COLUMN attempt_id TEXT;');
      try {
        const rows = this.db.prepare('SELECT workspace FROM practice_workspaces').all() as { workspace: string }[];
        const update = this.db.prepare('UPDATE practice_workspaces SET attempt_id=? WHERE workspace=?');
        for (const row of rows) update.run(randomUUID(), row.workspace);
        this.db.exec('CREATE UNIQUE INDEX practice_workspaces_attempt ON practice_workspaces(attempt_id); PRAGMA user_version=8; COMMIT;');
      } catch (error) { this.db.exec('ROLLBACK;'); throw error; }
    }
  }

  account(scope: UsageScope, budget: LabConfig['budget']): string {
    const key = JSON.stringify(usageScopeSchema.parse(scope));
    const validated = labConfigSchema.shape.budget.parse(budget);
    this.db.prepare('INSERT OR IGNORE INTO usage_accounts VALUES (?, ?, ?)').run(randomUUID(), key, JSON.stringify(validated));
    return (this.db.prepare('SELECT id FROM usage_accounts WHERE scope=?').get(key) as { id: string }).id;
  }
  registerWorkspace(workspace: string, userId: string, taskId: string, packRoot?: string, task?: import('@factoryze/protocol').TaskPack): void {
    this.db.prepare('INSERT INTO practice_workspaces (workspace,user_id,task_id,pack_root,task_json,attempt_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(workspace, userId, taskId, packRoot ?? null, task ? JSON.stringify(task) : null, randomUUID());
  }
  attemptId(workspace: string, userId: string): string {
    const row = this.db.prepare('SELECT attempt_id FROM practice_workspaces WHERE workspace=? AND user_id=?').get(workspace, userId);
    if (!row || typeof row.attempt_id !== 'string') throw new Error('Practice attempt is unavailable');
    return row.attempt_id;
  }
  workspace(workspace: string, userId: string): { taskId: string; packRoot?: string; task?: import('@factoryze/protocol').TaskPack } {
    const row = this.db.prepare('SELECT task_id,pack_root,task_json FROM practice_workspaces WHERE workspace=? AND user_id=?').get(workspace, userId);
    if (!row) throw new Error('Start a practice task in the Task view before starting the agent');
    return { taskId: row.task_id as string, ...(row.pack_root ? { packRoot: row.pack_root as string } : {}), ...(row.task_json ? { task: JSON.parse(row.task_json as string) } : {}) };
  }
  assertTaskSource(userId: string, taskId: string, packRoot: string): void {
    const conflict = this.db.prepare('SELECT 1 FROM practice_workspaces WHERE user_id=? AND task_id=? AND (pack_root IS NULL OR pack_root != ?) LIMIT 1').get(userId, taskId, packRoot);
    if (conflict) throw new Error('A different task source already uses this task ID. Give the assessment a unique id in task.yaml.');
  }
  budgetOverride(userId: string, taskId: string): number | null {
    const row = this.db.prepare('SELECT token_limit FROM task_budget_overrides WHERE user_id=? AND task_id=?').get(userId, taskId);
    return row ? Number(row.token_limit) : null;
  }
  setBudgetOverride(workspace: string, userId: string, limit: number | null, defaultLimit: number): void {
    const { taskId } = this.workspace(workspace, userId);
    if (limit !== null) labConfigSchema.shape.budget.shape.limit.parse(limit);
    const accounts = (this.db.prepare('SELECT id,scope,budget FROM usage_accounts').all() as AccountRow[])
      .filter(row => { const scope = usageScopeSchema.parse(JSON.parse(row.scope)); return scope.userId === userId && scope.taskId === taskId; });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (accounts.some(row => this.db.prepare("SELECT 1 FROM model_requests WHERE account_id=? AND status='pending' LIMIT 1").get(row.id)))
        throw new Error('Stop active requests before changing the task budget');
      if (limit === null) this.db.prepare('DELETE FROM task_budget_overrides WHERE user_id=? AND task_id=?').run(userId, taskId);
      else this.db.prepare('INSERT INTO task_budget_overrides VALUES (?,?,?) ON CONFLICT(user_id,task_id) DO UPDATE SET token_limit=excluded.token_limit').run(userId, taskId, limit);
      for (const row of accounts) {
        const previous = JSON.parse(row.budget) as LabConfig['budget'];
        this.db.prepare('UPDATE usage_accounts SET budget=? WHERE id=?').run(JSON.stringify({ ...previous, limit: limit ?? defaultLimit }), row.id);
        this.appendEvent(workspace, row.id, 'configuration', 'budget_changed@1', { previousLimit: previous.limit, limit: limit ?? defaultLimit, override: limit });
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  usageForTask(userId: string, taskId: string): UsageTotals[] {
    const accounts = this.db.prepare('SELECT id, scope FROM usage_accounts').all() as { id: string; scope: string }[];
    return accounts.filter(account => {
      const scope = usageScopeSchema.parse(JSON.parse(account.scope));
      return scope.userId === userId && scope.taskId === taskId;
    }).map(account => this.totals(account.id))
      .sort((a, b) => `${a.scope.profile}/${a.scope.model}`.localeCompare(`${b.scope.profile}/${b.scope.model}`));
  }
  /** Live task-run meters and limits, separate from cumulative task reporting. */
  usageForWorkspace(workspace: string, userId: string): UsageTotals[] {
    const { taskId } = this.workspace(workspace, userId);
    const accounts = this.db.prepare('SELECT id, scope FROM usage_accounts').all() as { id: string; scope: string }[];
    return accounts.filter(account => {
      const scope = usageScopeSchema.parse(JSON.parse(account.scope));
      return scope.userId === userId && scope.taskId === taskId;
    }).map(account => this.totals(account.id, workspace))
      .sort((a, b) => `${a.scope.profile}/${a.scope.model}`.localeCompare(`${b.scope.profile}/${b.scope.model}`));
  }
  workspaceUsage(workspace: string, userId: string): WorkspaceUsage[] {
    const { taskId } = this.workspace(workspace, userId);
    const accounts = this.db.prepare('SELECT id, scope, budget FROM usage_accounts').all() as AccountRow[];
    return accounts.flatMap(account => {
      const scope = usageScopeSchema.parse(JSON.parse(account.scope));
      if (scope.userId !== userId || scope.taskId !== taskId) return [];
      const rows = this.db.prepare('SELECT id, status, usage FROM model_requests WHERE workspace=? AND account_id=?')
        .all(workspace, account.id) as RequestRow[];
      const turnRow = this.db.prepare('SELECT turns FROM practice_prompt_turns WHERE workspace=? AND account_id=?')
        .get(workspace, account.id) as { turns: number } | undefined;
      const legacy = this.db.prepare('SELECT 1 FROM legacy_prompt_usage WHERE workspace=? AND account_id=?')
        .get(workspace, account.id);
      if (!rows.length && !turnRow) return [];
      const raw = zero();
      for (const row of rows) if (row.usage) {
        const usage = tokenUsageSchema.parse(JSON.parse(row.usage));
        for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) raw[field] += usage[field];
      }
      const budget: LabConfig['budget'] = JSON.parse(account.budget);
      return [workspaceUsageSchema.parse({ scope, raw,
        weighted: Math.round(weightedTokens(raw, budget.weights) * 1e6) / 1e6,
        requests: rows.length,
        incompleteRequests: rows.filter(row => row.status === 'pending' || row.status === 'incomplete').length,
        ...(turnRow ? { promptTurns: turnRow.turns } : {}),
        promptTurnsComplete: !!turnRow && !legacy })];
    }).sort((a, b) => `${a.scope.profile}/${a.scope.model}`.localeCompare(`${b.scope.profile}/${b.scope.model}`));
  }
  recordTurn(accountId: string, workspace: string): void {
    const scope = this.totals(accountId).scope;
    if (this.workspace(workspace, scope.userId).taskId !== scope.taskId)
      throw new Error('Usage account does not match the practice workspace');
    this.db.prepare(`INSERT INTO practice_prompt_turns (workspace, account_id, turns) VALUES (?, ?, 1)
      ON CONFLICT (workspace, account_id) DO UPDATE SET turns=turns+1`).run(workspace, accountId);
  }
  appendEvent(workspace: string, accountId: string, sessionId: string, type: string, data: Record<string, unknown>): void {
    const scope = this.totals(accountId).scope;
    if (this.workspace(workspace, scope.userId).taskId !== scope.taskId) throw new Error('Event task does not match account');
    const event = eventSchema.parse({ id: randomUUID(), sessionId, type, at: new Date().toISOString(), data: { ...data, profile: scope.profile, model: scope.model } });
    this.db.prepare('INSERT INTO practice_events (workspace,account_id,event) VALUES (?,?,?)').run(workspace, accountId, JSON.stringify(event));
  }
  events(workspace: string, userId: string): FactoryzeEvent[] {
    this.workspace(workspace, userId);
    return (this.db.prepare('SELECT event FROM practice_events WHERE workspace=? ORDER BY sequence').all(workspace) as { event: string }[])
      .map(row => eventSchema.parse(JSON.parse(row.event)));
  }
  unresolved(workspace: string, userId: string): UsageIssue[] {
    const { taskId } = this.workspace(workspace, userId);
    return this.db.prepare("SELECT r.id,r.workspace,r.status,r.usage,a.scope FROM model_requests r JOIN usage_accounts a ON a.id=r.account_id WHERE r.status IN ('pending','incomplete')")
      .all().flatMap(row => {
        const scope = usageScopeSchema.parse(JSON.parse(row.scope as string));
        return scope.userId === userId && scope.taskId === taskId && (row.workspace === workspace || row.workspace === null) ? [usageIssueSchema.parse({ requestId: row.id, scope,
          workspace: row.workspace, status: row.status, observed: row.usage ? JSON.parse(row.usage as string) : null })] : [];
      });
  }
  reconcile(workspace: string, userId: string, input: Reconciliation): void {
    const valid = reconciliationSchema.parse(input);
    const issue = this.unresolved(workspace, userId).find(row => row.requestId === valid.requestId);
    if (!issue) throw new Error('Request is unavailable or already reconciled');
    const row = this.db.prepare('SELECT account_id,owner_pid FROM model_requests WHERE id=?').get(valid.requestId)!;
    if (issue.status === 'pending') {
      if (row.owner_pid) {
        let alive = true;
        try { process.kill(Number(row.owner_pid), 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) throw new Error('Stop the active session before reconciling its usage');
      } else if (!valid.confirmAbandoned) throw new Error('Confirm that the abandoned request has stopped');
    }
    if (issue.observed && (Object.keys(issue.observed) as (keyof TokenUsage)[]).some(key => valid.usage[key] < issue.observed![key]))
      throw new Error('Confirmed usage cannot be below observed counts');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.db.prepare("UPDATE model_requests SET usage=?,status='complete' WHERE id=? AND status IN ('pending','incomplete')")
        .run(JSON.stringify(valid.usage), valid.requestId);
      if (updated.changes !== 1) throw new Error('Request is unavailable or already reconciled');
      this.appendEvent(workspace, row.account_id as string, 'reconciliation', 'usage_reconciled@1', {
        requestId: valid.requestId, before: issue.observed, confirmed: valid.usage, reference: valid.reference });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveReport(workspace: string, userId: string, report: PracticeReport): void {
    const { taskId } = this.workspace(workspace, userId);
    const valid = practiceReportSchema.parse(report);
    if (valid.taskId !== taskId) throw new Error('Report task does not match the practice workspace');
    this.db.prepare('INSERT INTO practice_reports (workspace, user_id, report) VALUES (?, ?, ?)')
      .run(workspace, userId, JSON.stringify(valid));
  }
  /** Registered practice workspaces in creation order. Each one is a student attempt. */
  workspaces(userId: string): { workspace: string; taskId: string; packRoot?: string; task?: import('@factoryze/protocol').TaskPack }[] {
    return (this.db.prepare('SELECT workspace,task_id,pack_root,task_json FROM practice_workspaces WHERE user_id=? ORDER BY rowid').all(userId) as Record<string, string | null>[])
      .map(row => ({ workspace: row.workspace!, taskId: row.task_id!, ...(row.pack_root ? { packRoot: row.pack_root } : {}),
        ...(row.task_json ? { task: JSON.parse(row.task_json) } : {}) }));
  }
  reports(workspace: string, userId: string): PracticeReport[] {
    this.workspace(workspace, userId);
    return (this.db.prepare('SELECT report FROM practice_reports WHERE workspace=? AND user_id=? ORDER BY id').all(workspace, userId) as { report: string }[])
      .map(row => practiceReportSchema.parse(JSON.parse(row.report)));
  }
  /** Latest recorded model request or event time, if any. */
  lastActivity(workspace: string): string | undefined {
    const request = this.db.prepare('SELECT MAX(at) AS at FROM model_requests WHERE workspace=?').get(workspace) as { at: string | null };
    const event = this.db.prepare('SELECT event FROM practice_events WHERE workspace=? ORDER BY sequence DESC LIMIT 1').get(workspace) as { event: string } | undefined;
    const times = [request.at, event ? eventSchema.parse(JSON.parse(event.event)).at : null].filter((at): at is string => !!at);
    return times.sort().at(-1);
  }
  /**
   * Weighted cost of each prompt in a workspace, in send order. Requests are matched to prompts by the order of the
   * append-only event log (prompt_started, model_request_started, prompt_ended), never by wall-clock comparison.
   */
  promptUsage(workspace: string, userId: string): PromptUsage[] {
    const prompts: (PromptUsage & { requestIds: string[] })[] = [];
    let current: (typeof prompts)[number] | undefined;
    for (const event of this.events(workspace, userId)) {
      if (event.type === 'prompt_started@1' && typeof event.data.promptId === 'string') {
        current = { promptId: event.data.promptId, index: prompts.length + 1, weighted: 0, state: 'running', requestIds: [] };
        prompts.push(current);
      } else if (event.type === 'prompt_ended@1' && current && event.data.promptId === current.promptId) {
        current.state = event.data.reason === 'end_turn' || event.data.reason === 'max_tokens' ? 'complete' : event.data.reason === 'cancelled' ? 'stopped' : 'failed';
        current = undefined;
      } else if (event.type === 'model_request_started@1' && current && typeof event.data.requestId === 'string') current.requestIds.push(event.data.requestId);
    }
    const request = this.db.prepare('SELECT r.status,r.usage,a.budget FROM model_requests r JOIN usage_accounts a ON a.id=r.account_id WHERE r.id=?');
    return prompts.map(({ requestIds, ...prompt }) => {
      let weighted = 0, incomplete = false;
      for (const id of requestIds) {
        const row = request.get(id) as { status: string; usage: string | null; budget: string } | undefined;
        if (!row) continue;
        if (row.status === 'pending' || row.status === 'incomplete') incomplete = true;
        if (row.usage) weighted += weightedTokens(tokenUsageSchema.parse(JSON.parse(row.usage)), (JSON.parse(row.budget) as LabConfig['budget']).weights);
      }
      return promptUsageSchema.parse({ ...prompt, weighted: Math.round(weighted * 1e6) / 1e6, ...(incomplete ? { incomplete } : {}) });
    });
  }
  /** Freeze the ledger's current counts, including reconciled usage; event usage can be older than the ledger. */
  reportInsights(workspace: string, userId: string, events = this.events(workspace, userId)) {
    this.workspace(workspace, userId);
    const rows = this.db.prepare('SELECT r.id,r.status,r.usage,a.budget FROM model_requests r JOIN usage_accounts a ON a.id=r.account_id WHERE r.workspace=?')
      .all(workspace) as { id: string; status: string; usage: string | null; budget: string }[];
    return summarizeReportActivity(events, rows.map(row => ({ id: row.id,
      weighted: row.usage ? weightedTokens(tokenUsageSchema.parse(JSON.parse(row.usage)), (JSON.parse(row.budget) as LabConfig['budget']).weights) : 0,
      incomplete: row.status === 'pending' || row.status === 'incomplete' })), this.promptUsage(workspace, userId));
  }
  latestReport(workspace: string, userId: string): PracticeReport | null {
    this.workspace(workspace, userId);
    const row = this.db.prepare('SELECT report FROM practice_reports WHERE workspace=? AND user_id=? ORDER BY id DESC LIMIT 1')
      .get(workspace, userId) as { report: string } | undefined;
    return row ? practiceReportSchema.parse(JSON.parse(row.report)) : null;
  }
  totals(accountId: string, workspace?: string): UsageTotals {
    const account = this.db.prepare('SELECT * FROM usage_accounts WHERE id=?').get(accountId) as AccountRow | undefined;
    if (!account) throw new Error('Unknown usage account');
    const scope = usageScopeSchema.parse(JSON.parse(account.scope));
    if (workspace && this.workspace(workspace, scope.userId).taskId !== scope.taskId)
      throw new Error('Usage account does not match the practice workspace');
    const budget: LabConfig['budget'] = JSON.parse(account.budget);
    const rows = (workspace ? this.db.prepare('SELECT id, status, usage FROM model_requests WHERE account_id=? AND workspace=?').all(accountId, workspace)
      : this.db.prepare('SELECT id, status, usage FROM model_requests WHERE account_id=?').all(accountId)) as RequestRow[];
    const raw = zero();
    for (const row of rows) if (row.usage) {
      const usage: TokenUsage = JSON.parse(row.usage);
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) raw[field] += usage[field];
    }
    const weighted = Math.round(weightedTokens(raw, budget.weights) * 1e6) / 1e6;
    const incompleteRequests = rows.filter(row => row.status === 'pending' || row.status === 'incomplete').length;
    return usageTotalsSchema.parse({ scope, ...(workspace ? { workspace } : {}), raw, weighted, budgetLimit: budget.limit,
      remaining: Math.max(0, budget.limit - weighted), requests: rows.length, incompleteRequests,
      status: incompleteRequests ? 'incomplete' : weighted >= budget.limit ? 'exhausted' : 'ready' });
  }
  begin(accountId: string, workspace?: string): string {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const totals = this.totals(accountId, workspace);
      if (workspace && this.workspace(workspace, totals.scope.userId).taskId !== totals.scope.taskId)
        throw new Error('Usage account does not match the practice workspace');
      if (totals.status === 'incomplete') throw new AccountingError('Token accounting is incomplete; further model calls are blocked pending reconciliation', 409);
      if (totals.status === 'exhausted') throw new AccountingError('Token budget exhausted for this user and task', 402);
      const id = randomUUID();
      this.db.prepare('INSERT INTO model_requests (id, account_id, status, usage, at, workspace, owner_pid) VALUES (?, ?, ?, NULL, ?, ?, ?)')
        .run(id, accountId, 'pending', new Date().toISOString(), workspace ?? null, process.pid);
      this.db.exec('COMMIT');
      return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  checkpoint(requestId: string, usage: TokenUsage): void {
    this.db.prepare("UPDATE model_requests SET usage=? WHERE id=? AND status='pending'")
      .run(JSON.stringify(tokenUsageSchema.parse(usage)), requestId);
  }
  finish(requestId: string, usage: TokenUsage | undefined, complete: boolean): void {
    if (usage) this.checkpoint(requestId, usage);
    this.db.prepare("UPDATE model_requests SET status=? WHERE id=? AND status='pending'")
      .run(complete && usage ? 'complete' : 'incomplete', requestId);
  }
  rejected(requestId: string): void {
    this.db.prepare("UPDATE model_requests SET status='rejected' WHERE id=? AND status='pending'").run(requestId);
  }
  async exclusive<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(accountId, next);
    await previous;
    try { return await work(); }
    finally { release(); if (this.queues.get(accountId) === next) this.queues.delete(accountId); }
  }
  close(): void { this.db.close(); }
}
