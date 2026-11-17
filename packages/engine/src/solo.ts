import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { labConfigSchema, gatewayConnectionSchema, providerApi, providerBaseURL, practiceReportSchema, practiceWorkspaceSchema, factoryzePublicModelMessage, executionPinSchema, temperatureSchema,
  promptAssessmentSchema, attemptSummarySchema, reportSummarySchema, type AttemptSummary, type ReportSummary, type PromptAssessment, type JudgeVerdict, type Reconciliation,
  type BaselineComparison, type GatewayConnection, type LabConfig, type UsageTotals, type FactoryzeEvent, type WorkspaceUsage } from '@factoryze/protocol';
import { createGateway } from '#gateway';
import { HttpProvider, type ProviderConfig } from '#provider';
import { TrialProvider } from '#trial-provider';
import { UsageStore, AccountingError } from '#usage-store';
import { startPracticeTask, listPracticeTasks } from '#tasks';
import { importTaskPack } from '#task-import';
import { preparePythonEnvironment, findPython } from '#python';
import { gradePracticeTask, runPracticeTests } from '#grader';
import { compareWithExpertBaseline, loadBenchmarkBaseline } from '#baseline';
import { judgePrompt } from '#judge';
import { scorePractice } from '#scoring';
import { startPackageIndex, pinPythonIndex } from '#package-index';
import { FACTORYZE_PROFILE } from '#harness';
import { migrateFactoryzeDataDir } from './data-dir.ts';

type JudgeRunner = (provider: ProviderConfig, model: string, prompt: string, signal?: AbortSignal, recent?: string[]) => Promise<{
  verdict: JudgeVerdict; usage: { inputTokens?: number; outputTokens?: number } }>;

export type SoloSettings = {
  agent?: 'opencode' | 'factoryze';
  provider: ProviderConfig; model: string; contextWindow: number; maxOutputTokens: number; budget: LabConfig['budget'];
  modules?: { judge: boolean; scoring: boolean }; judgeModel?: string; temperature?: number;
};
export const SOLO_PROFILE = FACTORYZE_PROFILE;
export type MeteredSession = {
  connection: GatewayConnection; totals(): UsageTotals; checkBudget(): void; recordTurn(): void; close(): Promise<void>;
  assessPrompt(text: string): Promise<PromptAssessment>;
  completePrompt(promptId: string, reason: string): void;
  promptActive?(): boolean;
  recordAgentEvent(type: string, data: Record<string, unknown>): void;
};

/** Backend-only bootstrap until the solo launcher/keychain UI is available. */
export function soloSettings(env: NodeJS.ProcessEnv = process.env): SoloSettings {
  if (!env.FACTORYZE_PROVIDER_URL || !env.FACTORYZE_MODEL || !env.FACTORYZE_PROVIDER_API_KEY)
    throw new Error('Open Configuration and select a provider, model and API key before using chat');
  const api = env.FACTORYZE_MODEL_API ?? 'openai-chat';
  if (api !== 'openai-chat' && api !== 'anthropic-messages') throw new Error('Unsupported FACTORYZE_MODEL_API');
  const budget = labConfigSchema.shape.budget.parse({ limit: Number(env.FACTORYZE_TOKEN_BUDGET ?? 100_000),
    weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  const contextWindow = Number(env.FACTORYZE_CONTEXT_WINDOW ?? 128_000);
  const maxOutputTokens = Number(env.FACTORYZE_MAX_OUTPUT_TOKENS ?? 4096);
  if (!Number.isSafeInteger(contextWindow) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || contextWindow < maxOutputTokens)
    throw new Error('Invalid model context/output token limits');
  const agent = 'factoryze';
  const temperature = env.FACTORYZE_TEMPERATURE?.trim() ? temperatureSchema.parse(Number(env.FACTORYZE_TEMPERATURE)) : undefined;
  return { agent, provider: { baseURL: providerBaseURL(env.FACTORYZE_PROVIDER_URL), apiKey: env.FACTORYZE_PROVIDER_API_KEY, api: providerApi(env.FACTORYZE_PROVIDER_URL, api) },
    model: env.FACTORYZE_MODEL, contextWindow, maxOutputTokens, budget,
    ...(temperature === undefined ? {} : { temperature }),
    modules: { judge: env.FACTORYZE_JUDGE_ENABLED === '1', scoring: env.FACTORYZE_SCORING_ENABLED === '1' },
    ...(env.FACTORYZE_JUDGE_MODEL ? { judgeModel: env.FACTORYZE_JUDGE_MODEL } : {}) };
}

export class SoloEngine {
  private readonly options: { dataDir: string; userId: string; settings?: SoloSettings;
    preparePython?: (workspace: string, minimum: string) => Promise<unknown>; grade?: typeof gradePracticeTask; judge?: JudgeRunner };
  private readonly store: UsageStore;
  private readonly sessions = new Set<MeteredSession>();
  private closed = false;
  private packageIndex?: ReturnType<typeof startPackageIndex>;
  constructor(options: { dataDir: string; userId: string; settings?: SoloSettings;
    preparePython?: (workspace: string, minimum: string) => Promise<unknown>; grade?: typeof gradePracticeTask; judge?: JudgeRunner }) {
    this.options = options;
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const file = join(options.dataDir, 'usage.sqlite');
    this.store = new UsageStore(file);
    chmodSync(file, 0o600);
  }
  async startTask(packRoot: string, taskId: string, workspacesRoot: string) {
    const prepare = this.options.preparePython ?? preparePythonEnvironment;
    const result = await startPracticeTask(packRoot, taskId, workspacesRoot,
      (workspace, task) => prepare(workspace, task.minimumPython));
    const workspace = await realpath(result.workspace);
    this.store.registerWorkspace(workspace, this.options.userId, result.task.id, await realpath(packRoot), result.task);
    await this.environment(workspace);
    return { ...result, workspace };
  }
  async importTask(source: string, workspacesRoot: string) {
    const imported = await importTaskPack(source, join(this.options.dataDir, 'task-packs'));
    const packRoot = await realpath(imported.packRoot);
    this.store.assertTaskSource(this.options.userId, imported.task.id, packRoot);
    return this.startTask(packRoot, imported.task.id, workspacesRoot);
  }
  assertConnectionIdle(): void { if([...this.sessions].some(s=>s.promptActive?.()))throw new Error('Wait for the current prompt to finish or press Stop before changing the model connection.'); }
  async setTaskBudget(workspace: string, limit: number | null, defaultLimit = 100_000) {
    if (this.sessions.size) throw new Error('Stop the agent session before changing the task budget');
    const resolved = realpathSync.native(workspace);
    const source = this.store.workspace(resolved, this.options.userId);
    this.store.setBudgetOverride(resolved, this.options.userId, limit, source.task?.budgetTokens ?? defaultLimit);
  }
  async submitTask(packRoot: string, workspace: string, scoringEnabled?: boolean) {
    if (this.closed) throw new Error('Engine is closed');
    const resolved = await realpath(workspace);
    const { taskId, packRoot: sourceRoot } = this.store.workspace(resolved, this.options.userId);
    packRoot = sourceRoot ?? packRoot;
    const python = join(resolved, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python');
    const { checks, ...correctness } = await (this.options.grade ?? gradePracticeTask)(packRoot, taskId, resolved, python);
    // Snapshot synchronously before baseline I/O so later prompts cannot leak into this submission.
    const events = this.store.events(resolved, this.options.userId);
    const insights = this.store.reportInsights(resolved, this.options.userId, events);
    const usage = this.store.usageForTask(this.options.userId, taskId);
    const budgetChanges = events.filter(event => event.type === 'budget_changed@1');
    const budget = budgetChanges.length ? { limit: Number(budgetChanges.at(-1)!.data.limit), initialLimit: Number(budgetChanges[0]!.data.previousLimit) } : undefined;
    const workspaceUsage = this.store.workspaceUsage(resolved, this.options.userId);
    const executionPins = [...new Map(events
      .filter(event => event.type === 'session_started@1' && event.data.pin !== undefined)
      .map(event => { const pin = executionPinSchema.parse(event.data.pin); return [JSON.stringify(pin), pin] as const; })).values()];
    const baselineComparisons: BaselineComparison[] = [];
    let baselineWarning: 'invalid-or-stale' | undefined;
    if (correctness.total > 0 && correctness.passed === correctness.total) {
      for (const item of workspaceUsage) {
        if (!item.requests || item.incompleteRequests || !item.promptTurns) continue;
        try {
          const baseline = await loadBenchmarkBaseline({ packRoot, taskId,
            profile: item.scope.profile, model: item.scope.model });
          const comparison = baseline && compareWithExpertBaseline(correctness, item, baseline);
          if (comparison) baselineComparisons.push(comparison);
        } catch { baselineWarning = 'invalid-or-stale'; }
      }
    }
    const report = practiceReportSchema.parse({ schema: 1, kind: 'practice', taskId,
      submittedAt: new Date().toISOString(), correctness,
      usage, insights, workspaceUsage, baselineComparisons, ...(baselineWarning ? { baselineWarning } : {}),
      ...(executionPins.length ? { executionPins } : {}),
      ...(checks ? { checks } : {}), ...(budget && budget.limit !== budget.initialLimit ? { budget } : {}),
      ...this.assessmentReport(resolved, correctness, baselineComparisons, scoringEnabled,
        workspaceUsage.length === 1 && workspaceUsage[0]!.promptTurnsComplete, events, workspaceUsage) });
    this.store.saveReport(resolved, this.options.userId, report);
    return report;
  }
  async workspaceInfo(packRoot: string, workspace: string, defaultLimit = 100_000) {
    if (this.closed) throw new Error('Engine is closed');
    const resolved = await realpath(workspace);
    let source: ReturnType<UsageStore['workspace']>;
    try { source = this.store.workspace(resolved, this.options.userId); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Start a practice task')) return null;
      throw error;
    }
    const task = source.task ?? (await listPracticeTasks(source.packRoot ?? packRoot, { includeRetired: true })).find(item => item.id === source.taskId);
    if (!task) throw new Error('This practice task is no longer installed');
    await this.environment(resolved);
    const budgetOverride = this.store.budgetOverride(this.options.userId, source.taskId);
    return practiceWorkspaceSchema.parse({ workspace: resolved, task, budgetTokens: budgetOverride ?? task.budgetTokens ?? defaultLimit, budgetOverride, usage: this.store.usageForWorkspace(resolved, this.options.userId) });
  }
  async runTests(workspace: string) {
    if (this.closed) throw new Error('Engine is closed');
    const resolved = await realpath(workspace);
    this.store.workspace(resolved, this.options.userId);
    const python = join(resolved, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    return runPracticeTests(resolved, python);
  }
  async latestReport(workspace: string) {
    if (this.closed) throw new Error('Engine is closed');
    const resolved = await realpath(workspace);
    const report = this.store.latestReport(resolved, this.options.userId);
    await this.environment(resolved);
    return report;
  }
  /** Every attempt, oldest first per task. Attempt numbers count a task's workspaces in creation order. */
  async listAttempts(packRoot: string, defaultLimit = 100_000): Promise<AttemptSummary[]> {
    if (this.closed) throw new Error('Engine is closed');
    const counts = new Map<string, number>();
    const attempts: AttemptSummary[] = [];
    for (const row of this.store.workspaces(this.options.userId)) {
      const attempt = (counts.get(row.taskId) ?? 0) + 1; counts.set(row.taskId, attempt);
      const info = await stat(row.workspace).catch(() => undefined);
      if (!info?.isDirectory()) continue;
      const task = row.task ?? (await listPracticeTasks(row.packRoot ?? packRoot, { includeRetired: true }).catch(() => [])).find(item => item.id === row.taskId);
      if (!task) continue;
      const usage = this.store.usageForWorkspace(row.workspace, this.options.userId);
      const weighted = Math.round(usage.reduce((sum, item) => sum + item.weighted, 0) * 1e6) / 1e6;
      const budgetLimit = this.store.budgetOverride(this.options.userId, row.taskId) ?? task.budgetTokens ?? defaultLimit;
      const reports = this.store.reports(row.workspace, this.options.userId);
      const latest = reports.at(-1);
      const startedAt = new Date(info.birthtimeMs || info.ctimeMs).toISOString();
      const lastActivityAt = [startedAt, this.store.lastActivity(row.workspace), latest?.submittedAt].filter((at): at is string => !!at).sort().at(-1)!;
      attempts.push(attemptSummarySchema.parse({ workspace: row.workspace, taskId: row.taskId, title: task.title, attempt, startedAt, lastActivityAt,
        weighted, budgetLimit, status: usage.some(item => item.status === 'incomplete') ? 'incomplete' : weighted >= budgetLimit ? 'exhausted' : 'ready',
        submissions: reports.length, ...(latest ? { latest: { ...latest.correctness, submittedAt: latest.submittedAt } } : {}) }));
    }
    return attempts;
  }
  /** Every submission, newest first. */
  async listReports(packRoot: string): Promise<ReportSummary[]> {
    const summaries: ReportSummary[] = [];
    for (const attempt of await this.listAttempts(packRoot)) {
      const reports = this.store.reports(attempt.workspace, this.options.userId);
      reports.forEach((report, index) => summaries.push(reportSummarySchema.parse({ workspace: attempt.workspace, taskId: attempt.taskId, title: attempt.title,
        attempt: attempt.attempt, submission: index + 1, submissions: reports.length, submittedAt: report.submittedAt,
        passed: report.correctness.passed, total: report.correctness.total,
        weighted: Math.round((report.workspaceUsage ?? []).reduce((sum, item) => sum + item.weighted, 0) * 1e6) / 1e6,
        score: report.scoring?.total ?? null })));
    }
    return summaries.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.submission - a.submission);
  }
  /** One saved submission of an attempt, numbered from 1. */
  async report(workspace: string, submission: number) {
    const reports = this.store.reports(await realpath(workspace), this.options.userId);
    const report = Number.isSafeInteger(submission) ? reports[submission - 1] : undefined;
    if (!report) throw new Error('That submission is not available for this attempt');
    return report;
  }
  async promptUsage(workspace: string) { return this.store.promptUsage(await realpath(workspace), this.options.userId); }
  checkPython(minimum: string) { return findPython(minimum); }
  async environment(workspace?: string): Promise<Record<string, string>> {
    if (workspace) this.store.workspace(await realpath(workspace), this.options.userId);
    const index = await (this.packageIndex ??= startPackageIndex(join(this.options.dataDir, 'wheels')));
    if (workspace) return pinPythonIndex(workspace, index.url, join(this.options.dataDir, 'pip.ini'));
    const configFile = join(this.options.dataDir, 'pip.ini');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(configFile, `[global]\nindex-url = ${index.url}\nextra-index-url =\ndisable-pip-version-check = true\n`, { mode: 0o600 });
    return { PIP_INDEX_URL: index.url, PIP_EXTRA_INDEX_URL: '', PIP_CONFIG_FILE: configFile, PIP_NO_INDEX: 'false', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  }
  private assessmentReport(workspace: string, correctness: { passed: number; total: number }, comparisons: BaselineComparison[], scoringEnabled?: boolean, baselineEligible = false,
    events: FactoryzeEvent[] = this.store.events(workspace, this.options.userId), usage: WorkspaceUsage[] = this.store.workspaceUsage(workspace, this.options.userId)) {
    const assessments = events.filter(event => event.type === 'prompt_assessed@1').map(event => {
      const assessment = promptAssessmentSchema.parse(event.data.assessment);
      return { ...assessment, acceptedEdit: events.some(e => e.type === 'edit_accepted@1' && e.data.promptId === assessment.promptId) };
    });
    const session = events.filter(event => event.type === 'session_started@1').at(-1);
    const scoring = scoringEnabled ?? (session ? session.data.scoring === true : this.options.settings?.modules?.scoring === true);
    const completed = events.filter(event => event.type === 'prompt_ended@1' && event.data.reason === 'end_turn').length;
    const historyComplete = usage.every(item => item.promptTurnsComplete) && completed === usage.reduce((sum, item) => sum + (item.promptTurns ?? 0), 0);
    const scoringContext = { baselineEligible, promptHistoryComplete: historyComplete };
    return { promptAssessments: assessments, ...(scoring ? { scoringContext, scoring: scorePractice(correctness, comparisons, assessments, scoringContext) } : {}) };
  }
  async usageIssues(workspace: string) { return this.store.unresolved(await realpath(workspace), this.options.userId); }
  async reconcileUsage(workspace: string, input: Reconciliation) {
    this.store.reconcile(await realpath(workspace), this.options.userId, input);
  }
  async openGateway(workspace: string, onUsage?: (totals: UsageTotals) => void, selectedSettings?: SoloSettings): Promise<MeteredSession> {
    if (this.closed) throw new Error('Engine is closed');
    const resolved = await realpath(workspace);
    const { taskId, task } = this.store.workspace(resolved, this.options.userId);
    const settings = selectedSettings ?? this.options.settings ?? soloSettings();
    if (settings.temperature !== undefined) temperatureSchema.parse(settings.temperature);
    if (settings.provider.authentication === 'opencode-public') throw new Error(factoryzePublicModelMessage);
    const pin = executionPinSchema.parse({ profile: SOLO_PROFILE, model: settings.model, ...(settings.provider.authentication==='trial'?{funding:'trial' as const}:{}),
      providerHost: new URL(providerBaseURL(settings.provider.baseURL)).host, temperature: settings.temperature ?? null, os: process.platform });
    const environment = await this.environment(resolved);
    if(settings.provider.authentication==='trial' && !settings.provider.trial) throw new Error('Sign in to your trial account first.');
    const provider = settings.provider.trial ? new TrialProvider({ ...settings.provider.trial, taskId, attemptId: this.store.attemptId(resolved, this.options.userId) }) : new HttpProvider(settings.provider);
    const budget = { ...settings.budget, limit: this.store.budgetOverride(this.options.userId, taskId) ?? task?.budgetTokens ?? settings.budget.limit };
    const accountId = this.store.account({ userId: this.options.userId, taskId, profile: SOLO_PROFILE, model: settings.model }, budget);
    const token = randomBytes(32).toString('hex');
    const sessionId = randomUUID();
    const server = createGateway(provider, { accounting: { store: this.store, accountId, token, workspace: resolved,
      model: settings.model, api: settings.provider.api, onUsage, sessionId } });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Gateway did not bind to loopback');
    let closing: Promise<void> | undefined;
    const abort = new AbortController();
    let activePrompt: string | undefined;
    let activeAssessment: PromptAssessment | undefined;
    let assessmentLogged = false;
    const allowedEdits = new Set<string>();
    const recent: string[] = [];
    const log = (type: string, data: Record<string, unknown>) => {
      if (!abort.signal.aborted) this.store.appendEvent(resolved, accountId, sessionId, type, data);
    };
    log('session_started@1', { scoring: settings.modules?.scoring === true, judge: settings.modules?.judge === true, pin });
    const session: MeteredSession = {
      connection: gatewayConnectionSchema.parse({ baseURL: `http://127.0.0.1:${address.port}/v1`, sessionToken: token,
        model: settings.model, api: settings.provider.api, contextWindow: settings.contextWindow, maxOutputTokens: settings.maxOutputTokens,
        ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
        ...(settings.provider.trialLimits?{trialLimits:settings.provider.trialLimits}:{}),
        packageIndexURL: environment.PIP_INDEX_URL, pipConfigFile: environment.PIP_CONFIG_FILE }),
      totals: () => this.store.totals(accountId, resolved),
      checkBudget: () => {
        const status = this.store.totals(accountId, resolved).status;
        if (status === 'exhausted') throw new AccountingError('Token budget exhausted for this user and task', 402);
        if (status === 'incomplete') throw new AccountingError('Token accounting is incomplete; further model calls are blocked pending reconciliation', 409);
      },
      recordTurn: () => this.store.recordTurn(accountId, resolved),
      assessPrompt: async text => {
        session.checkBudget();
        if (abort.signal.aborted) throw new Error('Session stopped');
        if (!text.trim() || text.length > 64_000) throw new Error('Prompt must contain 1 to 64000 characters');
        if (activePrompt) throw new Error('Wait for the current prompt to finish');
        const promptId = randomUUID(); activePrompt = promptId; allowedEdits.clear();
        assessmentLogged = false;
        log('prompt_started@1', { promptId, characters: text.length, hash: createHash('sha256').update(text).digest('hex') });
        let assessment: PromptAssessment = { promptId, model: settings.judgeModel ?? settings.model, status: 'off', acceptedEdit: false };
        activeAssessment = assessment;
        if (settings.modules?.judge) {
          try {
            const result = await (this.options.judge ?? judgePrompt)(settings.provider, assessment.model, text, abort.signal, recent);
            assessment = { ...assessment, status: 'scored', verdict: result.verdict };
            log('judge_usage@1', { promptId, judgeModel: assessment.model, inputTokens: result.usage.inputTokens ?? null,
              outputTokens: result.usage.outputTokens ?? null });
          } catch { assessment.status = 'unavailable'; }
        }
        if (abort.signal.aborted) throw new Error('Session stopped');
        log('prompt_assessed@1', { assessment });
        activeAssessment = assessment; assessmentLogged = true;
        recent.push(text); if (recent.length > 3) recent.shift();
        return assessment;
      },
      completePrompt: (promptId, reason) => {
        if (activePrompt !== promptId || abort.signal.aborted) return;
        log('prompt_ended@1', { promptId, reason });
        if (reason === 'end_turn') session.recordTurn();
        activePrompt = undefined;
        activeAssessment = undefined;
      },
      promptActive: () => Boolean(activePrompt),
      recordAgentEvent: (type, data) => {
        if (abort.signal.aborted) return;
        log(type, { ...data, ...(activePrompt ? { promptId: activePrompt } : {}) });
        if (activePrompt && type === 'permission_decision@1' && data.kind === 'edit' && data.approved === true && typeof data.toolCallId === 'string')
          allowedEdits.add(data.toolCallId);
        if (activePrompt && data.status === 'completed' && typeof data.toolCallId === 'string' && allowedEdits.has(data.toolCallId)) {
          log('edit_accepted@1', { promptId: activePrompt, toolCallId: data.toolCallId }); allowedEdits.delete(data.toolCallId);
        }
      },
      close: () => closing ??= (async () => {
        abort.abort();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        // Wait for canceled pipelines and any queued calls to finish accounting before closing storage.
        await this.store.exclusive(accountId, async () => {});
        if (activePrompt) {
          if (!assessmentLogged && activeAssessment) this.store.appendEvent(resolved, accountId, sessionId, 'prompt_assessed@1', {
            assessment: { promptId: activePrompt, model: activeAssessment.model, status: 'unavailable', acceptedEdit: false }
          });
          this.store.appendEvent(resolved, accountId, sessionId, 'prompt_ended@1', { promptId: activePrompt, reason: 'cancelled' });
        }
        activePrompt = undefined;
        this.store.appendEvent(resolved, accountId, sessionId, 'session_stopped@1', {});
        this.sessions.delete(session);
      })()
    };
    this.sessions.add(session);
    return session;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.sessions].map(session => session.close()));
    await (await this.packageIndex)?.close();
    this.store.close();
  }
}

let sharedEngine: SoloEngine | undefined;
export function getSoloEngine(): SoloEngine {
  return sharedEngine ??= new SoloEngine({ dataDir: migrateFactoryzeDataDir(),
    userId: `solo-${createHash('sha256').update(homedir()).digest('hex').slice(0, 24)}` });
}
