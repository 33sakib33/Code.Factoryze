import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostedTask } from '@factoryze/engine/trial-client';
import { listPracticeTasks } from '@factoryze/engine/tasks';
import { getSoloEngine } from '@factoryze/engine/solo';
import type { HostedBrowseInput, TaskService } from '../common/task-service';
import { practiceTasks } from './hosted-tasks';
import { ModelSettingsStore } from './model-settings';
import type { Reconciliation } from '@factoryze/protocol';
import { isModelConfigured, type LabDesktopJoin } from '@factoryze/protocol';
import { desktopResultShareInput } from './report-publication';
import { gradeAndSync, retryHostedResult } from './hosted-result-sync';

function taskRoot(): string {
  const candidates = [
    process.env.FACTORYZE_PRACTICE_TASKS_DIR,
    process.resourcesPath ? join(process.resourcesPath, 'practice-tasks') : undefined,
    join(process.cwd(), 'tasks', 'practice'),
    join(process.cwd(), '..', '..', 'tasks', 'practice'),
  ];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error('Practice tasks are missing from this installation');
  return found;
}

export class TaskBackendService implements TaskService {
  /** The last hosted catalog shown on Home, so Start downloads exactly the version that was listed. */
  private hosted = new Map<string, HostedTask>();
  constructor(private readonly modelSettings: ModelSettingsStore) {}
  setClient(_client: object | undefined): void { /* No backend callbacks. */ }
  dispose(): void { /* No persistent resources. */ }

  async list() {
    const result = await practiceTasks(await listPracticeTasks(taskRoot()), this.modelSettings.trial);
    this.hosted = result.hosted;
    return result.tasks;
  }
  localTasks() { return listPracticeTasks(taskRoot()); }
  async browseHosted(input: HostedBrowseInput) {
    const page = await this.modelSettings.trial.hostedTaskPage(input);
    const localIDs = new Set((await this.localTasks()).map(task => task.id));
    const hosted = page.tasks.filter(task => !localIDs.has(task.id));
    this.hosted = new Map(hosted.map(task => [task.id, task]));
    return { tasks: hosted.map(({ sha256: _sha256, archiveBytes: _archiveBytes, ...task }) => ({ ...task, hosted: true as const })), nextCursor: page.nextCursor };
  }
  hostedTopics() { return this.modelSettings.trial.hostedTaskTopics(); }
  async taskByID(id: string) {
    const local = (await this.localTasks()).find(task => task.id === id);
    if (local) return local;
    const hosted = await this.modelSettings.trial.hostedTask(id).catch(() => null);
    if (!hosted) return null;
    const { sha256: _sha256, archiveBytes: _archiveBytes, ...task } = hosted;
    return { ...task, hosted: true as const };
  }
  joinLab(input:LabDesktopJoin){return this.modelSettings.lab.join(input);}
  async labStatus(workspace:string){return this.modelSettings.lab.has(workspace)?this.modelSettings.lab.view(workspace):null;}
  labSubmit(workspace:string){return this.modelSettings.lab.submit(workspace);}
  refreshLabs(){return this.modelSettings.lab.refreshAll();}
  async labEvent(workspace:string,kind:'paste'|'focus_lost',count:number){if(this.modelSettings.lab.has(workspace))this.modelSettings.lab.queueEvent(workspace,kind,count);}
  async agentReady(workspace:string){return this.modelSettings.lab.has(workspace)?this.modelSettings.lab.ready(workspace):isModelConfigured(await this.modelSettings.load());}
  async attempts() { return [...await getSoloEngine().listAttempts(taskRoot(), await this.defaultBudget()),...this.modelSettings.lab.attempts()]; }
  async reports() { return [...await getSoloEngine().listReports(taskRoot()),...this.modelSettings.lab.reportSummaries()].sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)); }
  report(workspace: string, submission: number) { return this.modelSettings.lab.has(workspace)?Promise.resolve(this.modelSettings.lab.report(workspace,submission)):getSoloEngine().report(workspace, submission); }
  private async localShareInput(workspace:string,submission:number){
    if(this.modelSettings.lab.has(workspace))throw new Error('Lab reports cannot be shared from the editor.');
    const report=await getSoloEngine().report(workspace,submission);
    const attempt=(await getSoloEngine().listAttempts(taskRoot(),await this.defaultBudget())).find(item=>item.workspace===workspace);
    if(!attempt)throw new Error('Saved attempt is unavailable.');
    return desktopResultShareInput(report,attempt.title,attempt.budgetLimit);
  }
  async resultShareStatus(workspace:string,submission:number){return this.modelSettings.trial.resultShareStatus((await this.localShareInput(workspace,submission)).reportKey);}
  async publishResultShare(workspace:string,submission:number){return this.modelSettings.trial.publishResultShare(await this.localShareInput(workspace,submission));}
  async revokeResultShare(workspace:string,submission:number){
    const state=await this.resultShareStatus(workspace,submission);
    if(!state.published)return;
    const url=new URL(state.url);
    if(url.origin!==this.modelSettings.trial.client.origin||!/^\/api\/desktop-shares\/[A-Za-z0-9_-]{43}$/.test(url.pathname))throw new Error('Invalid public result link.');
    await this.modelSettings.trial.revokeResultShare(url.pathname.split('/').pop()!);
  }
  promptUsage(workspace: string) { return this.modelSettings.lab.has(workspace)?this.modelSettings.lab.prompts(workspace):getSoloEngine().promptUsage(workspace); }
  async checkPython(taskId: string) {
    const task = await this.taskByID(taskId);
    if (!task) throw new Error('That practice task is not installed');
    return getSoloEngine().checkPython(task.minimumPython);
  }

  async start(id: string) {
    const sessionsRoot = process.env.FACTORYZE_PRACTICE_SESSIONS_DIR ?? join(homedir(), 'Factoryze Practice');
    if ((await listPracticeTasks(taskRoot())).some(task => task.id === id)) return getSoloEngine().startTask(taskRoot(), id, sessionsRoot);
    const task = this.hosted.get(id) ?? await this.modelSettings.trial.hostedTask(id).catch(() => undefined);
    if (!task) throw new Error('This task is no longer published. Return to Home to see the current list.');
    // Verified download, then the ordinary ZIP import: the pack is validated, stored by content and graded locally.
    const folder = await mkdtemp(join(tmpdir(), 'factoryze-hosted-'));
    try {
      const archive = join(folder, `${task.id}.zip`);
      await this.modelSettings.trial.downloadHostedTask(task, archive);
      return await getSoloEngine().startHostedTask(archive, sessionsRoot, task);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }

  importTask(source: string) {
    return getSoloEngine().importTask(source, process.env.FACTORYZE_PRACTICE_SESSIONS_DIR ?? join(homedir(), 'Factoryze Practice'));
  }
  async setTaskBudget(workspace: string, limit: number | null) { if(this.modelSettings.lab.has(workspace))throw Error('The instructor controls lab budgets.');return getSoloEngine().setTaskBudget(workspace, limit, await this.defaultBudget()); }
  private async defaultBudget(): Promise<number> { return (await this.modelSettings.load().catch(() => null))?.budgetTokens ?? 100_000; }

  async submit(workspace: string, options: { includeSolution?: boolean } = {}) {
    if(this.modelSettings.lab.has(workspace))throw Error('Use lab submission; hidden checks run on the lab server.');
    const scoring = process.env.FACTORYZE_PROVIDER_URL ? process.env.FACTORYZE_SCORING_ENABLED === '1' : (await this.modelSettings.load())?.modules?.scoring ?? false;
    return gradeAndSync(getSoloEngine(), this.modelSettings.trial, workspace, () => getSoloEngine().submitTask(taskRoot(), workspace, scoring),
      { includeSolution: options.includeSolution === true });
  }
  async hostedSubmitInfo(workspace: string) {
    if (this.modelSettings.lab.has(workspace)) return null;
    const attempt = await getSoloEngine().hostedAttempt(workspace).catch(() => undefined);
    if (!attempt) return null;
    return { signedIn: await this.modelSettings.trial.signedIn(), ...(attempt.sent ? { sentSubmission: attempt.sent.submission } : {}) };
  }
  async hostedResult(workspace: string, submission: number) {
    if (this.modelSettings.lab.has(workspace)) return null;
    return (await getSoloEngine().hostedResult(workspace, submission).catch(() => undefined))?.view ?? null;
  }
  retryHostedResult(workspace: string, submission: number) {
    if (this.modelSettings.lab.has(workspace)) return Promise.resolve(null);
    return retryHostedResult(getSoloEngine(), this.modelSettings.trial, workspace, submission);
  }
  async restoreHostedTests(workspace: string) {
    const engine = getSoloEngine();
    const attempt = await engine.hostedAttempt(workspace);
    const info = await engine.workspaceInfo(taskRoot(), workspace, await this.defaultBudget());
    if (!attempt || !info) throw new Error('This attempt did not start from a hosted task.');
    // The same verified download as Start: size and SHA-256 must match the version this attempt began with.
    const folder = await mkdtemp(join(tmpdir(), 'factoryze-hosted-'));
    try {
      const archive = join(folder, `${attempt.taskId}.zip`);
      await this.modelSettings.trial.downloadHostedTask({ ...info.task, sha256: attempt.packSha256, archiveBytes: attempt.archiveBytes }, archive);
      await engine.restoreHostedTests(workspace, archive);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async latestReport(workspace: string) { if(this.modelSettings.lab.has(workspace)){const reports=this.modelSettings.lab.reportSummaries().filter(report=>report.workspace===workspace);return reports.length?this.modelSettings.lab.report(workspace,reports.length):null;}return getSoloEngine().latestReport(workspace); }
  async workspaceInfo(workspace: string) { return this.modelSettings.lab.has(workspace)?this.modelSettings.lab.workspaceInfo(workspace):getSoloEngine().workspaceInfo(taskRoot(), workspace, await this.defaultBudget()); }
  runTests(workspace: string) { return this.modelSettings.lab.has(workspace)?this.modelSettings.lab.runTests(workspace):getSoloEngine().runTests(workspace); }

  private mutableConnection() {
    if(process.env.FACTORYZE_PROVIDER_URL)throw new Error('Restart without backend provider environment settings to change this connection.');
    getSoloEngine().assertConnectionIdle();
  }
  trialAccount() { return this.modelSettings.trial.view(); }
  trialRequestCode(email:string) { return this.modelSettings.trial.request(email); }
  trialVerifyCode(code:string) { return this.modelSettings.trial.verify(code); }
  trialClaim(code:string) { return this.modelSettings.trial.claim(code); }
  trialSelect(model:string) { this.mutableConnection(); return this.modelSettings.trial.select(model); }
  trialSignOut() { this.mutableConnection(); return this.modelSettings.trial.logout(); }
  byokSettings() { return this.modelSettings.loadByok(); }
  settings() { return this.modelSettings.load(); }
  saveSettings(input: Parameters<ModelSettingsStore['save']>[0]) {
    if (process.env.FACTORYZE_PROVIDER_URL) throw new Error('Restart without backend provider environment settings to edit the desktop keychain');
    this.mutableConnection();
    return this.modelSettings.save(input);
  }
  clearSettings() {
    if (process.env.FACTORYZE_PROVIDER_URL) throw new Error('Restart without backend provider environment settings to edit the desktop keychain');
    this.mutableConnection();
    return this.modelSettings.clear();
  }
  usageIssues(workspace: string) { if(this.modelSettings.lab.has(workspace))return Promise.resolve([]);return getSoloEngine().usageIssues(workspace); }
  reconcileUsage(workspace: string, input: Reconciliation) { if(this.modelSettings.lab.has(workspace))return Promise.reject(Error('Ask the instructor to reconcile lab usage.'));return getSoloEngine().reconcileUsage(workspace, input); }
}
