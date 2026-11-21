import { FrontendApplicationContribution, open, OpenerService } from '@theia/core/lib/browser';
import { ApplicationShell, MAXIMIZED_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import type { ViewContainer } from '@theia/core/lib/browser/view-container';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import type { AttemptSummary, PracticeReport, PracticeWorkspace, ReportSummary } from '@factoryze/protocol';
import { isModelConfigured } from '@factoryze/protocol';
import type { PracticeTask, TaskService } from '../common/task-service';
import { consumePracticeLaunch, practiceLaunchKey } from './solo-launch';
import { WorkbenchMetrics, taskStartKey } from './workbench-metrics';
import { FactoryzeHomeWidget } from './factoryze-home-widget';
import { FactoryzeReportWidget } from './factoryze-report-widget';
import { FactoryzeSettingsWidget } from './factoryze-settings-widget';
import { FactoryzeBriefWidget } from './factoryze-brief-widget';
import { FactoryzeTestsWidget } from './factoryze-tests-widget';
import { FactoryzeAgentWidget } from './factoryze-agent-widget';
import { startAttemptDialog, submitDialog } from './dialogs';
import { practiceAttempts } from './flow-model';
import { el, errorText, modal, button } from './dom';
import { joinLabDialog, labStatusDialog } from './lab-dialog';

const EXPLORER = 'explorer-view-container';

/**
 * Two modes. Home has no workspace: only the Home page is visible. An attempt is a workspace: the IDE appears.
 * Moving between them reloads the window through Theia's workspace service, so each mode starts clean.
 */
export class FactoryzeSoloContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
  private importing = false;
  private attempt?: AttemptSummary;
  private context?: PracticeWorkspace | null;
  private readonly brief = new FactoryzeBriefWidget();
  private readonly tests = new FactoryzeTestsWidget();
  private report?: FactoryzeReportWidget;
  private reportSelection?: { workspace: string; submissions: number };
  private reportFrom: 'home' | 'attempt' = 'home';
  /** In Home mode, pages render in a full-window layer below the title bar instead of the IDE's main area. */
  private overlay?: HTMLDivElement;

  constructor(private readonly shell: ApplicationShell, private readonly manager: WidgetManager,
    private readonly workspace: WorkspaceService, private readonly tasks: TaskService,
    private readonly opener: OpenerService, private readonly messages: MessageService, private readonly metrics: WorkbenchMetrics,
    private readonly dialogs: FileDialogService, private readonly commands: CommandRegistry) {}

  private get root(): string | undefined { return this.workspace.tryGetRoots()[0]?.resource.path.fsPath(); }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand({ id: 'factoryze.home', label: 'Factoryze: Home' }, { execute: () => this.goHome() });
    commands.registerCommand({ id: 'factoryze.settings', label: 'Factoryze: Settings' }, { execute: () => this.openSettings() });
    commands.registerCommand({ id: 'factoryze.task.open-folder', label: 'Factoryze: Open Task Folder…' }, { execute: () => this.importTask(false) });
    commands.registerCommand({ id: 'factoryze.task.open-zip', label: 'Factoryze: Open Task ZIP…' }, { execute: () => this.importTask(true) });
    commands.registerCommand({ id: 'factoryze.tests.run', label: 'Factoryze: Run Tests' }, { execute: () => this.runTests(), isEnabled: () => !!this.root });
    commands.registerCommand({ id: 'factoryze.attempt.submit', label: 'Factoryze: Submit Attempt' }, { execute: () => this.submit(), isEnabled: () => !!this.root });
  }
  registerMenus(menus: MenuModelRegistry): void {
    for (const [commandId, label] of [['factoryze.home', 'Home'], ['factoryze.task.open-folder', 'Open Task Folder…'], ['factoryze.task.open-zip', 'Open Task ZIP…'], ['factoryze.settings', 'Settings…']])
      menus.registerMenuAction(CommonMenus.FILE_OPEN, { commandId, label });
  }

  onStart(): void {
    this.shell.onDidChangeCurrentWidget(({ newValue }) => {
      if (newValue && newValue !== this.report) this.restoreReportArea();
    });
    this.shell.onDidRemoveWidget(widget => { if (widget === this.report) this.restoreReportArea(); });
    // The brief is pinned above the file tree inside the Explorer.
    this.manager.onDidCreateWidget(({ factoryId, widget }) => { if (factoryId === EXPLORER) this.pinBrief(widget as ViewContainer); });
    const existing = this.manager.tryGetWidget(EXPLORER);
    if (existing) this.pinBrief(existing as ViewContainer);
    window.addEventListener('factoryze-settings-changed', () => void this.loadModel());
    document.addEventListener('paste',event=>{if(this.root&&this.isLabAttempt())void this.tasks.labEvent(this.root,'paste',event.clipboardData?.getData('text/plain').length??0).catch(()=>{});});
    window.addEventListener('blur',()=>{if(this.root&&this.isLabAttempt())void this.tasks.labEvent(this.root,'focus_lost',1).catch(()=>{});});
    void this.loadModel();
  }
  private pinBrief(container: ViewContainer): void {
    if (!this.brief.isAttached && container.addWidget) container.addWidget(this.brief, { order: -1, initiallyCollapsed: false, canHide: false });
  }
  private async loadModel(): Promise<void> {
    if(this.isLabAttempt()){this.metrics.setModel(`${this.context!.lab!.model} · ${this.context!.lab!.id}`);return;}
    const settings = await this.tasks.settings().catch(() => null);
    this.metrics.setModel(isModelConfigured(settings) ? settings!.model+(settings!.authentication==='trial'?' · Trial credits':'') : null);
  }

  async onDidInitializeLayout(): Promise<void> {
    await this.workspace.ready;
    const root = this.root;
    const context = root ? await this.tasks.workspaceInfo(root).catch(() => null) : null;
    if (!root || !context) { await this.enterHome(); if (root) void this.messages.warn('That folder isn\'t a Factoryze attempt. Open a task from Home.'); return; }
    await this.enterAttempt(root, context);
  }

  /* ---------- Home ---------- */
  private async enterHome(): Promise<void> {
    document.body.classList.add('fz-home-mode');
    this.metrics.setHome(true);
    this.overlay = el('div', { class: 'fz-overlay', role: 'main' });
    document.body.append(this.overlay);
    await this.showHome();
  }
  /** Shows one page: in the Home layer when no attempt is open, otherwise as a tab in the main area. */
  private async present(widget: Widget): Promise<void> {
    if (widget !== this.report) { this.report?.closeCheckDetails(); this.restoreReportArea(); }
    if (this.overlay) {
      for (const child of Array.from(this.overlay.children)) (child as HTMLElement).hidden = child !== widget.node;
      if (!widget.isAttached) Widget.attach(widget, this.overlay);
      widget.node.hidden = false;
      widget.activate();
      return;
    }
    if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'main' });
    await this.shell.activateWidget(widget.id);
  }
  private async showHome(): Promise<void> {
    const home = await this.manager.getOrCreateWidget<FactoryzeHomeWidget>(FactoryzeHomeWidget.ID);
    await this.present(home);
    void home.refresh();
  }
  private async goHome(): Promise<void> {
    if (this.root) { await this.workspace.close(); return; }
    await this.showHome();
  }

  homeActions(): ConstructorParameters<typeof FactoryzeHomeWidget>[1] {
    return {
      continueAttempt: attempt => void this.openAttempt(attempt.workspace),
      start: (task, attempts) => void this.startTask(task, attempts),
      importTask: zip => void this.importTask(zip),
      connect: () => void this.openSettings(true),
      report: summary => void this.showSavedReport(summary),
      joinLab:()=>joinLabDialog(this.tasks,workspace=>this.openAttempt(workspace,true)),
    };
  }

  private async startTask(task: PracticeTask, attempts: AttemptSummary[]): Promise<void> {
    const settings = await this.tasks.settings().catch(() => null);
    const mine = practiceAttempts(task.id, attempts);
    const inProgress = mine.filter(item => item.submissions === 0).sort((a, b) => b.attempt - a.attempt)[0];
    const current = mine.at(-1);
    startAttemptDialog(task, { service: this.tasks, inProgress, budget: current?.budgetLimit ?? task.budgetTokens ?? settings?.budgetTokens ?? 100_000,
      judge: settings?.modules?.judge ?? false, connection: settings, openSettings: () => void this.openSettings(true, !!task.hosted),
      open: attempt => this.openAttempt(attempt.workspace, true) });
  }

  async importTask(zip: boolean): Promise<void> {
    if (this.importing) return;
    this.importing = true;
    try {
      const source = await this.dialogs.showOpenDialog({ title: zip ? 'Open task ZIP' : 'Open task folder', openLabel: 'Open task', canSelectMany: false,
        canSelectFolders: !zip, canSelectFiles: zip, ...(zip ? { filters: { 'Task ZIP': ['zip'] } } : {}) });
      if (!source) return;
      void this.messages.info('Preparing the task and its Python environment…', { timeout: 2500 });
      const result = await this.tasks.importTask(source.path.fsPath());
      await this.openAttempt(result.workspace, true);
    } catch (error) { void this.messages.error(errorText(error)); }
    finally { this.importing = false; }
  }

  private async openAttempt(workspace: string, fresh = false): Promise<void> {
    if (fresh) { const now = String(Date.now()); window.localStorage.setItem(taskStartKey(workspace), now); window.localStorage.setItem(practiceLaunchKey(workspace), now); }
    await this.workspace.open(URI.fromFilePath(workspace), { preserveWindow: true });
  }

  /* ---------- Attempt ---------- */
  private async enterAttempt(root: string, context: PracticeWorkspace): Promise<void> {
    document.body.classList.remove('fz-home-mode');
    this.context = context;
    if(context.lab)this.metrics.setModel(`${context.lab.model} · ${context.lab.id}`);
    const attempts = await this.tasks.attempts().catch(() => []);
    this.attempt = attempts.find(item => item.workspace === root);
    const started = this.attempt ? Date.parse(this.attempt.startedAt) : Number(window.localStorage.getItem(taskStartKey(root))) || undefined;
    this.metrics.setHome(false);
    this.metrics.startTask(root, started, context.task.title, context.budgetTokens);
    this.metrics.setAttempt(this.attempt?.attempt);
    this.brief.display(context);

    const explorer = await this.manager.getOrCreateWidget(EXPLORER);
    if (!explorer.isAttached) await this.shell.addWidget(explorer, { area: 'left', rank: 100 });
    await this.shell.revealWidget(explorer.id);
    const agent = await this.manager.getOrCreateWidget<FactoryzeAgentWidget>(FactoryzeAgentWidget.ID);
    if (!agent.isAttached) await this.shell.addWidget(agent, { area: 'right', rank: 100 });
    await this.shell.revealWidget(agent.id);
    if (!this.tests.isAttached) await this.shell.addWidget(this.tests, { area: 'bottom', rank: 200 });
    this.shell.expandPanel('left'); this.shell.expandPanel('right');

    const settings = await this.tasks.settings().catch(() => null);
    const usage = context.lab?context.usage?.[0]:context.usage?.find(item => item.scope.model === settings?.model);
    if (usage) agent.onUsage(usage);
    void this.tasks.promptUsage(root).then(prompts => this.metrics.seedPrompts(root, prompts)).catch(() => undefined);

    if (consumePracticeLaunch(window.localStorage, root) && context.task.entryFile) {
      await open(this.opener, URI.fromFilePath(root).resolve(context.task.entryFile), { mode: 'activate' });
    }
  }

  async openFile(path: string): Promise<void> {
    const root = this.root;
    if (root) await open(this.opener, URI.fromFilePath(root).resolve(path), { mode: 'activate' });
  }

  async setBudget(limit: number): Promise<void> {
    const root = this.root;
    if (!root) return;
    await this.tasks.setTaskBudget(root, limit);
    this.metrics.setTaskBudget(limit);
    const context = await this.tasks.workspaceInfo(root).catch(() => null);
    if (context) { this.context = context; this.brief.display(context); }
  }
  isLabAttempt():boolean{return!!this.root&&!!this.context?.lab;}

  private async runTests(): Promise<void> {
    const root = this.root;
    if (!root) return;
    if (!this.tests.isAttached) await this.shell.addWidget(this.tests, { area: 'bottom' });
    this.shell.expandPanel('bottom');
    await this.shell.activateWidget(this.tests.id);
    this.tests.running();
    try { this.tests.display(await this.tasks.runTests(root),this.isLabAttempt()); } catch (error) { this.tests.failed(error); }
  }

  private async submit(): Promise<void> {
    const root = this.root;
    if (!root) return;
    if(this.isLabAttempt()){
      submitDialog(async()=>{const receipt=await this.tasks.labSubmit(root),dialog=modal('Lab submission saved');
        dialog.body.append(el('p',{class:'fz-lead',text:`Submission ${receipt.number} is saved on the lab server.`}),el('p',{class:'fz-help',text:'Your instructor will release the report after server grading. You can keep working while the lab is open; closing the lab saves the final synchronized files.'}));
        dialog.foot.append(button('Back to attempt',()=>dialog.close(),{kind:'primary'}));},true);return;
    }
    const hosted = await this.tasks.hostedSubmitInfo(root).catch(() => null);
    submitDialog(async ({ includeSolution }) => {
      const report = await this.tasks.submit(root, { includeSolution });
      const attempts = await this.tasks.attempts().catch(() => []);
      this.attempt = attempts.find(item => item.workspace === root) ?? this.attempt;
      const submissions = this.attempt?.submissions ?? 1;
      await this.showReport(report, root, submissions, submissions, 'attempt');
    }, false, hosted);
  }

  /* ---------- Reports ---------- */
  private async showSavedReport(summary: ReportSummary): Promise<void> {
    try {
      const report = await this.tasks.report(summary.workspace, summary.submission);
      await this.showReport(report, summary.workspace, summary.submission, summary.submissions, this.root ? 'attempt' : 'home');
    } catch (error) { void this.messages.error(errorText(error)); }
  }

  private async showReport(report: PracticeReport, workspace: string, submission: number, submissions: number, from: 'home' | 'attempt'): Promise<void> {
    const attempts = await this.tasks.attempts().catch(() => []);
    const attempt = attempts.find(item => item.workspace === workspace);
    this.reportFrom = from;
    this.reportSelection = { workspace, submissions };
    if (this.report?.isDisposed) this.report = undefined;
    this.report ??= new FactoryzeReportWidget({
      back: () => void (this.reportFrom === 'home' ? this.showHome() : this.closeReport()),
      keepWorking: () => this.closeReport(),
      newAttempt: async taskId => {
        const task = await this.tasks.taskByID(taskId);
        if (task) await this.startTask(task, await this.tasks.attempts().catch(() => []));
      },
      home: () => void this.goHome(),
      submission: async n => {
        const selection = this.reportSelection;
        if (!selection) return;
        try { await this.showReport(await this.tasks.report(selection.workspace, n), selection.workspace, n, selection.submissions, this.reportFrom); }
        catch (error) { void this.messages.error(errorText(error)); }
      },
      shareStatus: (workspace,n) => this.tasks.resultShareStatus(workspace,n),
      publishShare: (workspace,n) => this.tasks.publishResultShare(workspace,n),
      revokeShare: (workspace,n) => this.tasks.revokeResultShare(workspace,n),
      signInForSharing: () => void this.openSettings(true,true),
      hostedResult: (workspace,n) => this.tasks.hostedResult(workspace,n),
      retryHostedResult: (workspace,n) => this.tasks.retryHostedResult(workspace,n),
      restoreTests: async workspace => {
        await this.tasks.restoreHostedTests(workspace);
        // "Run again": the restored files are graded through the normal Submit confirmation.
        if (workspace === this.root) void this.submit();
      },
    });
    this.report.display({ report, workspace, title: attempt?.title ?? report.taskId, attempt: attempt?.attempt ?? 1, submission, submissions,
      budgetLimit: attempt?.budgetLimit ?? report.budget?.limit ?? 100_000, startedAt: attempt?.startedAt,
      current: from === 'attempt' && workspace === this.root, from });
    await this.present(this.report);
    if (!this.overlay && !this.shell.mainPanel.hasClass(MAXIMIZED_CLASS)) {
      this.shell.toggleMaximized(this.report);
      this.reportMaximized = true;
    }
  }
  private reportMaximized = false;
  private restoreReportArea(): void {
    if (!this.reportMaximized) return;
    this.reportMaximized = false;
    if (this.shell.mainPanel.hasClass(MAXIMIZED_CLASS)) this.shell.doToggleMaximized(this.shell.mainPanel);
  }
  private closeReport(): void {
    this.restoreReportArea();
    if (this.overlay) { void this.showHome(); return; }
    const report = this.report; this.report = undefined; this.reportSelection = undefined;
    report?.close();
  }

  /* ---------- Settings ---------- */
  async openSettings(connect = false, trial = false): Promise<void> {
    if(this.root&&this.isLabAttempt()){await labStatusDialog(this.tasks,this.root);return;}
    const settings = await this.manager.getOrCreateWidget<FactoryzeSettingsWidget>(FactoryzeSettingsWidget.ID);
    await this.present(settings);
    await settings.refresh();
    if (connect) { if (trial) settings.connectTrial(); else settings.connect(); }
  }
  settingsBack(): void {
    const settings = this.manager.tryGetWidget(FactoryzeSettingsWidget.ID);
    if (this.overlay) void this.showHome(); else settings?.close();
  }
}
