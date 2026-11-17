import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-500.css';
import '@fontsource/atkinson-hyperlegible-next/latin-600.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@fontsource/atkinson-hyperlegible-mono/latin-400.css';
import '@fontsource/atkinson-hyperlegible-mono/latin-500.css';
import '@fontsource/atkinson-hyperlegible-mono/latin-600.css';
import '../../src/browser/style/factoryze.css';
import { ContainerModule } from '@theia/core/shared/inversify';
import { isModelConfigured } from '@factoryze/protocol';
import { FrontendApplicationContribution, bindViewContribution } from '@theia/core/lib/browser';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WidgetFactory, WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { OpenerService } from '@theia/core/lib/browser/opener-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FactoryzeAgentWidget } from './factoryze-agent-widget';
import { FactoryzeAgentContribution } from './factoryze-agent-contribution';
import { FactoryzeMetricsContribution } from './factoryze-metrics-contribution';
import { FactoryzeHomeWidget } from './factoryze-home-widget';
import { FactoryzeSettingsWidget } from './factoryze-settings-widget';
import { WorkbenchMetrics } from './workbench-metrics';
import { AgentService, agentServicePath } from '../common/agent-service';
import { TaskService, taskServicePath } from '../common/task-service';
import { FactoryzeSoloContribution } from './factoryze-solo-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { AppearanceController } from './appearance-controller';

export default new ContainerModule(bind => {
  bind(WorkbenchMetrics).toSelf().inSingletonScope();
  bind(AppearanceController).toDynamicValue(ctx => new AppearanceController(ctx.container.get(ThemeService), ctx.container.get(PreferenceService))).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(ctx => ({ onStart: () => ctx.container.get(AppearanceController).apply() })).inSingletonScope();
  bind(TaskService).toDynamicValue(ctx => WebSocketConnectionProvider.createProxy<TaskService>(ctx.container, taskServicePath)).inSingletonScope();
  bind(FactoryzeSoloContribution).toDynamicValue(ctx => new FactoryzeSoloContribution(
    ctx.container.get(ApplicationShell), ctx.container.get(WidgetManager), ctx.container.get(WorkspaceService),
    ctx.container.get(TaskService), ctx.container.get(OpenerService), ctx.container.get(MessageService), ctx.container.get(WorkbenchMetrics),
    ctx.container.get(FileDialogService), ctx.container.get(CommandRegistry)
  )).inSingletonScope();
  bind(CommandContribution).toService(FactoryzeSoloContribution);
  bind(MenuContribution).toService(FactoryzeSoloContribution);
  bind(FrontendApplicationContribution).toService(FactoryzeSoloContribution);
  bind(FactoryzeMetricsContribution).toDynamicValue(ctx => new FactoryzeMetricsContribution(
    ctx.container.get(ApplicationShell), ctx.container.get(WorkspaceService), ctx.container.get(WorkbenchMetrics), ctx.container.get(CommandRegistry), ctx.container.get(TerminalService)
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toService(FactoryzeMetricsContribution);

  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: FactoryzeAgentWidget.ID,
    createWidget: () => {
      const solo = ctx.container.get(FactoryzeSoloContribution), tasks = ctx.container.get<TaskService>(TaskService);
      const root = () => ctx.container.get(WorkspaceService).tryGetRoots()[0]?.resource.path.fsPath() ?? '';
      const widget = new FactoryzeAgentWidget(ctx.container.get(WorkspaceService), ctx.container.get(WorkbenchMetrics), {
        settings: () => { void solo.openSettings(); },
        openFile: path => { void solo.openFile(path); },
        setBudget: limit => solo.setBudget(limit),
        usageIssues: () => tasks.usageIssues(root()),
        reconcile: input => tasks.reconcileUsage(root(), input),
        isLab:()=>solo.isLabAttempt(),
        labStatus:()=>root()?tasks.labStatus(root()):Promise.resolve(null),
      }, async () => tasks.agentReady(root()));
      widget.connect(WebSocketConnectionProvider.createProxy<AgentService>(ctx.container, agentServicePath, widget));
      return widget;
    },
  })).inSingletonScope();
  bindViewContribution(bind, FactoryzeAgentContribution);
  bind(WidgetFactory).toDynamicValue(ctx => ({ id: FactoryzeHomeWidget.ID, createWidget: () =>
    new FactoryzeHomeWidget(ctx.container.get(TaskService), ctx.container.get(FactoryzeSoloContribution).homeActions()) })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({ id: FactoryzeSettingsWidget.ID, createWidget: () =>
    new FactoryzeSettingsWidget(ctx.container.get(TaskService), () => ctx.container.get(FactoryzeSoloContribution).settingsBack(), ctx.container.get(AppearanceController)) })).inSingletonScope();
});
