import { tokenUsageSchema, type LabConfig, type TokenUsage, type GatewayConnection } from '@factoryze/protocol';
export type { TokenUsage } from '@factoryze/protocol';

export function weightedTokens(usage: TokenUsage, weights: LabConfig['budget']['weights']): number {
  const freshInput = usage.input - usage.cacheRead - usage.cacheWrite;
  return freshInput * weights.input + usage.output * weights.output
    + usage.cacheRead * weights.cacheRead + usage.cacheWrite * weights.cacheWrite;
}

type Json = Record<string, any>;
function chatUsage(event: Json): TokenUsage | undefined {
  if (!event.usage) return;
  const result = tokenUsageSchema.safeParse({ input: event.usage.prompt_tokens, output: event.usage.completion_tokens,
    cacheRead: event.usage.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 });
  return result.success ? result.data : undefined;
}
function anthropicUsage(usage: Json, previous?: TokenUsage): TokenUsage | undefined {
  const cacheRead = usage.cache_read_input_tokens ?? previous?.cacheRead ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? previous?.cacheWrite ?? 0;
  const input = usage.input_tokens === undefined ? previous?.input : usage.input_tokens + cacheRead + cacheWrite;
  const result = tokenUsageSchema.safeParse({ input, output: usage.output_tokens ?? previous?.output, cacheRead, cacheWrite });
  return result.success ? result.data : undefined;
}

/** Observe provider usage without modifying SSE bytes. Checkpoints survive cancellation and crashes. */
export async function* observeUsage(
  body: AsyncIterable<string>, api: GatewayConnection['api'], contentType: string,
  callbacks: { checkpoint?(usage: TokenUsage): void; finish(usage: TokenUsage | undefined, complete: boolean): void }
): AsyncIterable<string> {
  const streaming = contentType.includes('text/event-stream');
  let pending = '';
  let last: TokenUsage | undefined;
  let terminal = false;
  let ended = false;
  let malformed = false;
  let data: string[] = [];
  const consume = (value: string): void => {
    if (value === '[DONE]') { terminal = true; return; }
    try {
      const event: Json = JSON.parse(value);
      const usage = api === 'openai-chat' ? chatUsage(event)
        : anthropicUsage(event.message?.usage ?? event.usage ?? {}, last);
      if (event.error || ((event.usage || event.message?.usage) && !usage)) malformed = true;
      if (usage) { last = usage; callbacks.checkpoint?.(usage); }
      if (api === 'anthropic-messages' && event.type === 'message_stop') terminal = true;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      malformed = true;
    }
  };
  const line = (value: string): void => {
    if (!value) { if (data.length) consume(data.join('\n')); data = []; }
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    for await (const chunk of body) {
      pending += chunk;
      if (streaming) {
        let newline = pending.indexOf('\n');
        while (newline !== -1) {
          line(pending.slice(0, newline).replace(/\r$/, ''));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
      }
      if (pending.length > 4_194_304) throw new Error('Provider response event exceeds limit');
      yield chunk;
    }
    if (streaming) { if (pending) line(pending); line(''); }
    else { consume(pending); terminal = true; }
    ended = true;
  } finally { callbacks.finish(last, ended && terminal && !malformed && last !== undefined); }
}

/** Compatibility adapter for the Phase 0 replay/edit spikes. */
export async function* meterOpenAIChatStream(body: AsyncIterable<string>, onUsage: (usage: TokenUsage) => void): AsyncIterable<string> {
  yield* observeUsage(body, 'openai-chat', 'text/event-stream', { finish: usage => { if (usage) onUsage(usage); } });
}
