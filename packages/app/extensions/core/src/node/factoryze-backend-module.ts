import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common';
import { AgentClient, agentServicePath } from '../common/agent-service';
import { AgentBackendService } from './agent-backend-service';
import { taskServicePath } from '../common/task-service';
import { TaskBackendService } from './task-backend-service';
import { ModelSettingsStore } from './model-settings';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { getSoloEngine } from '@factoryze/engine/solo';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';
import { FactoryzeWorkspaceServer } from './startup-workspace';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  rebind(DefaultWorkspaceServer).to(FactoryzeWorkspaceServer).inSingletonScope();
  bind(BackendApplicationContribution).toDynamicValue(ctx => ({
    initialize: async () => { Object.assign(process.env, await getSoloEngine().environment()); },
    onStop: () => { ctx.container.get(ModelSettingsStore).lab.dispose();void getSoloEngine().close(); }
  })).inSingletonScope();
  bind(ModelSettingsStore).toDynamicValue(() => new ModelSettingsStore(undefined, process.env.FACTORYZE_CREDENTIAL_ACCOUNT ?? 'default')).inSingletonScope();
  bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler<AgentClient>(agentServicePath, client => {
    const settings = ctx.container.get(ModelSettingsStore);
    const service = new AgentBackendService({ settings: () => settings.forEngine(),lab:settings.lab });
    service.setClient(client);
    client.onDidCloseConnection(() => service.dispose());
    return service;
  })).inSingletonScope();
  bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler<object>(taskServicePath, client => {
    const service = new TaskBackendService(ctx.container.get(ModelSettingsStore));
    service.setClient(client);
    return service;
  })).inSingletonScope();
});
