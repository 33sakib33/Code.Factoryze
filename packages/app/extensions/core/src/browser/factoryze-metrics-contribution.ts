import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { FactoryzeMetricsWidget } from './factoryze-metrics-widget';
import { WorkbenchMetrics } from './workbench-metrics';
import { createWorkbenchPanes } from './workbench-panes';

export class FactoryzeMetricsContribution implements FrontendApplicationContribution {
  private widget?: FactoryzeMetricsWidget;
  constructor(
    private readonly shell: ApplicationShell,
    private readonly workspace: WorkspaceService,
    private readonly metrics: WorkbenchMetrics,
    private readonly commands: CommandRegistry,
    private readonly terminals: TerminalService,
  ) {}

  async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
    if (!this.widget) {
      const panes = createWorkbenchPanes(this.shell, command => this.commands.executeCommand(command), async () => {
        if (!this.terminals.all.length) await this.commands.executeCommand('terminal:new');
        const terminal = this.terminals.lastUsedTerminal ?? this.terminals.all[0];
        if (terminal) {
          await this.terminals.open(terminal, { mode: 'activate', widgetOptions: { area: 'bottom' } });
          await this.shell.activateWidget(terminal.id);
        }
      });
      this.widget = new FactoryzeMetricsWidget(this.metrics, panes, {
        home: () => { void this.commands.executeCommand('factoryze.home'); },
        settings: () => { void this.commands.executeCommand('factoryze.settings'); },
        runTests: () => { void this.commands.executeCommand('factoryze.tests.run'); },
        submit: () => { void this.commands.executeCommand('factoryze.attempt.submit'); },
      });
      await this.shell.addWidget(this.widget, { area: 'top' });
      // Pane changes still settling from the restore don't always touch the observed nodes.
      void this.shell.pendingUpdates.then(() => this.widget?.refreshPanes());
      const observer = new MutationObserver(records => {
        // Native-menu initialization can finish after layout/reloads and hide this shared panel.
        // It also contains Factoryze's essential navigation, budget and Settings controls.
        if (this.widget?.isAttached && this.shell.topPanel.isHidden) this.shell.topPanel.show();
        // Native controls are raw DOM children added after layout. Refit the shell so
        // its cached title-row height includes the separate Factoryze toolbar row.
        if (records.some(record => record.type === 'childList' && record.target === this.shell.topPanel.node)) this.shell.fit();
        void this.shell.pendingUpdates.then(() => this.widget?.refreshPanes());
      });
      for (const node of [this.shell.topPanel.node, this.shell.leftPanelHandler.container.node, this.shell.bottomPanel.node, this.shell.rightPanelHandler.container.node]) {
        observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'], childList: node === this.shell.topPanel.node });
      }
      this.widget.disposed.connect(() => observer.disconnect());
    }
    // Show it immediately as well as restoring it if the native menu hides it later.
    this.shell.topPanel.show();
    this.shell.fit();
  }
}
