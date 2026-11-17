import { gatewayErrorMessages, gatewayErrorSchema } from '@factoryze/protocol';

export function agentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf('{');
  if (start >= 0 && message.length <= 64000) {
    try {
      const parsed = gatewayErrorSchema.safeParse(JSON.parse(message.slice(start)));
      if (parsed.success) {
        if (parsed.data.error.code) return gatewayErrorMessages[parsed.data.error.code];
        if (parsed.data.error.message.includes('Token budget exhausted')) return gatewayErrorMessages.budget_exhausted;
        if (message.includes('Not Found:')) return gatewayErrorMessages.provider_model_not_found;
        return gatewayErrorMessages.provider_rejected;
      }
    } catch { /* ACP errors without a gateway payload retain their ordinary message. */ }
  }
  if (message.includes('Token budget exhausted for this user and task')) return gatewayErrorMessages.budget_exhausted;
  return message;
}
