import { realpath, stat } from 'node:fs/promises';
import type { AgentClient, AgentService } from '../common/agent-service';
import { getSoloEngine, type MeteredSession, type SoloEngine, type SoloSettings } from '@factoryze/engine/solo';
import type { UsageTotals } from '@factoryze/protocol';
import { HarnessSession } from '@factoryze/engine/harness';
import { HarnessTools } from '#harness-tools';
import type { LabConnectionStore } from '#lab-connection';
import { RemoteLabSession } from '#lab-session';

export class AgentBackendService implements AgentService {
  private client?: AgentClient;
  private session?: Pick<HarnessSession, 'start' | 'stop' | 'prompt'>;
  private gateway?: MeteredSession;
  private generation = 0;
  private remote?:RemoteLabSession;
  private readonly options: {
    engine?: Pick<SoloEngine, 'openGateway'>;
    settings?: () => Promise<SoloSettings | undefined>;
    createSession?(options: ConstructorParameters<typeof HarnessSession>[0]): Pick<HarnessSession, 'start' | 'stop' | 'prompt'>;
    lab?:LabConnectionStore;
  };

  constructor(options: AgentBackendService['options'] = {}) { this.options = options; }

  setClient(client: AgentClient | undefined): void { this.client = client; }

  async start(cwd: string): Promise<UsageTotals> {
    const generation = ++this.generation;
    await this.closeSession();
    const check = (): void => { if (generation !== this.generation) throw new Error('Session stopped'); };
    const path = await realpath(cwd);
    if (!(await stat(path)).isDirectory()) throw new Error('Open a folder to start an agent session');
    if(this.options.lab?.has(path)){
      if(!this.client)throw new Error('Connect the lab agent pane first');
      const remote=await RemoteLabSession.connect(this.options.lab,path,this.client);
      if(generation!==this.generation){await remote.stop();throw Error('Session stopped');}this.remote=remote;return remote.totals();
    }
    const selected = await this.options.settings?.();
    check();
    const gateway = await (this.options.engine ?? getSoloEngine()).openGateway(path, totals => {
      if (generation === this.generation) this.client?.onUsage(totals);
    }, selected);
    if (generation !== this.generation) { await gateway.close(); throw new Error('Session stopped'); }
    this.gateway = gateway;
    const createSession = this.options.createSession ?? (options => new HarnessSession(options));
    const callbacks = {
      onUpdate: (update: unknown) => {
        const value = update as Record<string, unknown> | null;
        if (value && (value.sessionUpdate === 'tool_call' || value.sessionUpdate === 'tool_call_update')) {
          const summary = Object.fromEntries(['sessionUpdate', 'toolCallId', 'kind', 'status'].filter(key => typeof value[key] === 'string').map(key => [key, value[key]]));
          gateway.recordAgentEvent('acp_update@1', summary);
        }
        this.client?.onUpdate(update);
      },
      onPermission: async (params: unknown) => {
        const id = await (this.client?.requestPermission(params) ?? Promise.resolve(null));
        const value = params as { toolCall?: { toolCallId?: string; kind?: string }; options?: { optionId: string; kind: string }[] };
        const option = value.options?.find(item => item.optionId === id);
        gateway.recordAgentEvent('permission_decision@1', { toolCallId: value.toolCall?.toolCallId ?? '',
          kind: value.toolCall?.kind ?? '', approved: option?.kind === 'allow_once', outcome: option?.kind ?? 'cancelled' });
        return id;
      },
    };
    let session: AgentBackendService['session'];
    try {
      const hands = new HarnessTools({ cwd: path, gateway: gateway.connection, onPermission: callbacks.onPermission });
      session = createSession({ gateway: gateway.connection, onUpdate: callbacks.onUpdate,
        checkBudget: gateway.checkBudget, execute: (call, signal) => hands.execute(call, signal) });
      this.session = session;
      await session.start(); check(); return gateway.totals();
    }
    catch (error) {
      session?.stop(); await gateway.close();
      if (this.session === session) { this.session = undefined; this.gateway = undefined; }
      throw error;
    }
  }

  async prompt(text: string): Promise<string> {
    if(this.remote){const remote=this.remote;try{return await remote.prompt(text);}catch(error){if(this.remote===remote)await this.closeSession();throw error;}}
    const session = this.session;
    const gateway = this.gateway;
    if (!session || !gateway) return Promise.reject(new Error('Start an agent session first'));
    try { gateway.checkBudget(); } catch (error) { return Promise.reject(error); }
    const assessment = await gateway.assessPrompt(text);
    if (this.session !== session) throw new Error('Session stopped');
    this.client?.onAssessment?.(assessment);
    try {
      const reason = await session.prompt(text);
      gateway.completePrompt(assessment.promptId, reason);
      return reason;
    } catch (error) {
      gateway.completePrompt(assessment.promptId, 'failed');
      if (this.session === session) await this.closeSession();
      throw error;
    }
  }

  async stop(): Promise<void> {
    ++this.generation;
    await this.closeSession();
  }

  private async closeSession(): Promise<void> {
    const remote=this.remote;this.remote=undefined;await remote?.stop();
    this.session?.stop();
    this.session = undefined;
    const gateway = this.gateway;
    this.gateway = undefined;
    await gateway?.close();
  }

  dispose(): void { void this.stop(); }
}
