import type { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';
import type { AttemptSummary, ModelSettingsInput, ModelSettingsView, PracticeReport, PromptUsage, PythonCheck, ReportSummary, TaskPack, UsageIssue,
  Reconciliation, TrialAccountView, PracticeWorkspace, PublicTestResult,LabDesktopJoin,LabDesktopStatus,LabSubmission,DesktopResultShareState,HostedResultView } from '@factoryze/protocol';

/** A task in Practice tasks. `hosted` marks one published by the connected Factoryze service rather than bundled. */
export type PracticeTask = TaskPack & { hosted?: true };
export type HostedBrowseInput = { query: string; topic: string; after: string; limit: number };
export type HostedBrowsePage = { tasks: PracticeTask[]; nextCursor: string };
export type TaskTopicCount = { id: string; count: number };

export const taskServicePath = '/services/factoryze-tasks';
export const TaskService = Symbol('TaskService');

export interface TaskService extends RpcServer<object> {
  joinLab(input:LabDesktopJoin):Promise<PracticeWorkspace>;
  labStatus(workspace:string):Promise<LabDesktopStatus|null>;
  labSubmit(workspace:string):Promise<LabSubmission>;
  refreshLabs():Promise<void>;
  labEvent(workspace:string,kind:'paste'|'focus_lost',count:number):Promise<void>;
  agentReady(workspace:string):Promise<boolean>;
  list(): Promise<PracticeTask[]>;
  localTasks(): Promise<PracticeTask[]>;
  browseHosted(input: HostedBrowseInput): Promise<HostedBrowsePage>;
  hostedTopics(): Promise<TaskTopicCount[]>;
  taskByID(id: string): Promise<PracticeTask | null>;
  /** Every practice attempt on this computer, with usage and submission counts. */
  attempts(): Promise<AttemptSummary[]>;
  /** Every saved submission, newest first. */
  reports(): Promise<ReportSummary[]>;
  /** One submission of an attempt, numbered from 1. */
  report(workspace: string, submission: number): Promise<PracticeReport>;
  resultShareStatus(workspace:string, submission:number):Promise<DesktopResultShareState>;
  publishResultShare(workspace:string, submission:number):Promise<DesktopResultShareState>;
  revokeResultShare(workspace:string, submission:number):Promise<void>;
  checkPython(taskId: string): Promise<PythonCheck>;
  start(id: string): Promise<PracticeWorkspace>;
  importTask(source: string): Promise<PracticeWorkspace>;
  setTaskBudget(workspace: string, limit: number | null): Promise<void>;
  workspaceInfo(workspace: string): Promise<PracticeWorkspace | null>;
  promptUsage(workspace: string): Promise<PromptUsage[]>;
  runTests(workspace: string): Promise<PublicTestResult>;
  /** Grades locally. For a hosted attempt while signed in, also sends one result; `includeSolution` is opt-in. */
  submit(workspace: string, options?: { includeSolution?: boolean }): Promise<PracticeReport>;
  /** Null unless the attempt started from the hosted catalog. */
  hostedSubmitInfo(workspace: string): Promise<{ signedIn: boolean; sentSubmission?: number } | null>;
  hostedResult(workspace: string, submission: number): Promise<HostedResultView | null>;
  retryHostedResult(workspace: string, submission: number): Promise<HostedResultView | null>;
  /** Re-downloads the attempt's task version, verifies it and rewrites its hidden and public test files. */
  restoreHostedTests(workspace: string): Promise<void>;
  latestReport(workspace: string): Promise<PracticeReport | null>;
  trialAccount(): Promise<TrialAccountView>;
  trialRequestCode(email:string): Promise<void>;
  trialVerifyCode(code:string): Promise<TrialAccountView>;
  /** Asks for trial credit. Returns the account as it stands afterwards: funded, or waiting for approval. */
  trialRequestCredit(note?:string): Promise<TrialAccountView>;
  trialSelect(model:string): Promise<ModelSettingsView>;
  trialSignOut(): Promise<void>;
  byokSettings(): Promise<ModelSettingsView|null>;
  settings(): Promise<ModelSettingsView | null>;
  saveSettings(input: ModelSettingsInput): Promise<ModelSettingsView>;
  clearSettings(): Promise<void>;
  usageIssues(workspace: string): Promise<UsageIssue[]>;
  reconcileUsage(workspace: string, input: Reconciliation): Promise<void>;
}
