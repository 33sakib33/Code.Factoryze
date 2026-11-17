import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FactoryzeAgentWidget } from './factoryze-agent-widget';

@injectable()
export class FactoryzeAgentContribution extends AbstractViewContribution<FactoryzeAgentWidget> {
  constructor() {
    super({
      widgetId: FactoryzeAgentWidget.ID,
      widgetName: 'Agent',
      defaultWidgetOptions: { area: 'right', rank: 100 },
      toggleCommandId: 'factoryze.agent.toggle',
    });
  }

}
