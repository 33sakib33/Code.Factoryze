import { injectable } from '@theia/core/shared/inversify';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';
import { startupWorkspace } from './startup-policy';

@injectable()
export class FactoryzeWorkspaceServer extends DefaultWorkspaceServer {
  protected override async getRoot(): Promise<string | undefined> {
    return startupWorkspace(await this.getWorkspaceURIFromCli());
  }
}
