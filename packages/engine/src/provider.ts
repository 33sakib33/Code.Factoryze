import { isOpenCodePublicEndpoint, providerApi, providerBaseURL, type GatewayErrorCode, type GatewayConnection, type ModelSettings } from '@factoryze/protocol';
import type { Provider } from './gateway.ts';
import type { ModelRequest, ModelResponse } from './replay.ts';

export type ProviderConfig = { baseURL: string; apiKey: string; api: GatewayConnection['api']; authentication?: ModelSettings['authentication']; trial?: import('./trial-provider.ts').TrialTransport; trialLimits?: import('@factoryze/protocol').TrialRequestLimits };

/** Native public-provider context only; credentials and arbitrary client headers never cross this boundary. */
export function openCodePublicHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ['x-opencode-session', 'x-opencode-request', 'x-opencode-project', 'x-opencode-client', 'user-agent']) {
    const value = headers[name];
    if (typeof value === 'string' && value.length <= 512 && /^[\x20-\x7e]+$/.test(value)) result[name] = value;
  }
  return result;
}

/** Read a bounded error body to classify known failures. No diagnostic text leaves the engine. */
async function providerFailure(response: Response, openRouter: boolean): Promise<GatewayErrorCode | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timeout = setTimeout(cancel, 2000);
  try {
    let text = '', bytes = 0; const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 16384) return;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const error = JSON.parse(text)?.error;
    const message = error?.message;
    if (typeof message !== 'string') return;
    if ([400, 422].includes(response.status) && (error.param === 'temperature' || /\btemperature\b/i.test(message)) &&
      /unsupported|not supported|does not support|only|invalid|range|must be|not allowed/i.test(message)) return 'provider_temperature_unsupported';
    if (!openRouter || response.status !== 404) return;
    if (/user not found|invalid (?:api )?key/i.test(message)) return 'provider_authentication';
    if (/data policy|data settings/i.test(message)) return 'provider_data_policy';
    if (/no endpoints|no available provider|no eligible provider/i.test(message)) return 'provider_no_route';
  } catch { /* Unknown, malformed and truncated errors use the generic HTTP category. */ }
  finally { clearTimeout(timeout); cancel(); reader.releaseLock(); }
}

/** The engine holds upstream credentials; only allowlisted public-provider context headers can be forwarded. */
export class HttpProvider implements Provider {
  private readonly config: ProviderConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: ProviderConfig, fetcher: typeof fetch = fetch) {
    const url = new URL(providerBaseURL(config.baseURL));
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))))
      throw new Error('Provider URL must use HTTPS (HTTP is allowed only on loopback)');
    if (config.authentication === 'opencode-public' && (!isOpenCodePublicEndpoint(config.baseURL) || config.api !== 'openai-chat'))
      throw new Error('Public authentication requires the native OpenCode Chat endpoint');
    this.fetcher = fetcher;
    this.config = { ...config, api: providerApi(config.baseURL, config.api), baseURL: url.href.replace(/\/$/, '') };
  }
  async send(request: ModelRequest): Promise<ModelResponse> {
    const suffix = this.config.api === 'openai-chat' ? '/chat/completions' : '/messages';
    const publicModel = this.config.authentication === 'opencode-public';
    const response = await this.fetcher(`${this.config.baseURL}${suffix}`, {
      method: 'POST', body: request.body, redirect: 'error',
      signal: AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(300_000)]),
      headers: { ...(publicModel ? openCodePublicHeaders(request.headers) : {}), 'content-type': 'application/json', ...(this.config.api === 'openai-chat'
        ? { authorization: `Bearer ${publicModel ? 'public' : this.config.apiKey}` }
        : { 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' }) }
    });
    if (!response.ok) {
      const openRouter = new URL(this.config.baseURL).origin === 'https://openrouter.ai';
      const failureCode = [400, 422].includes(response.status) || (response.status === 404 && openRouter)
        ? await providerFailure(response, openRouter) : undefined;
      if (!response.body?.locked) await response.body?.cancel().catch(() => {});
      return { status: response.status, ...(failureCode ? { failureCode } : {}), headers: {}, body: (async function* () {})() };
    }
    const body = response.body;
    return { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
      body: (async function* () {
        if (!body) throw new Error('Provider returned an empty body');
        const reader = body.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
          }
          const tail = decoder.decode(); if (tail) yield tail;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      })() };
  }
}
