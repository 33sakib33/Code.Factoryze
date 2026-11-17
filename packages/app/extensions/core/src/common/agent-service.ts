import type { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';
import type { UsageTotals, PromptAssessment } from '@factoryze/protocol';

export const agentServicePath = '/services/factoryze-agent';
export const AgentService = Symbol('AgentService');

export interface AgentClient {
  onUpdate(update: unknown): void;
  requestPermission(params: unknown): Promise<string | null>;
  onUsage(totals: UsageTotals): void;
  onAssessment?(assessment: PromptAssessment): void;
}

export interface AgentService extends RpcServer<AgentClient> {
  start(cwd: string): Promise<UsageTotals>;
  prompt(text: string): Promise<string>;
  stop(): Promise<void>;
}
