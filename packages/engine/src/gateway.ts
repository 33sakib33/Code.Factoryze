import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { timingSafeEqual } from 'node:crypto';
import { gatewayErrorMessages, type GatewayErrorCode, type GatewayConnection, type UsageTotals } from '@factoryze/protocol';
import { meterOpenAIChatStream, observeUsage, type TokenUsage } from '#meter';
import { AccountingError, type UsageStore } from '#usage-store';
import { rewriteOpenAIChatEdit, type EditArguments } from '#rewrite';
import type { ModelRequest, ModelResponse } from './replay.ts';
import { openCodePublicHeaders } from '#provider';

export interface Provider {
  send(request: ModelRequest): Promise<ModelResponse>;
}

interface GatewayOptions {
  onUsage?: (usage: TokenUsage) => void;
  rewriteEdit?: (args: EditArguments) => EditArguments;
  accounting?: {
    store: UsageStore; accountId: string; token: string; model: string; api: GatewayConnection['api']; workspace?: string; sessionId?: string;
    onUsage?(totals: UsageTotals): void; opencodePublic?: boolean;
  };
}

/** Always bind to loopback. The app supplies accounting; unauthenticated mode is for replay spikes only. */
export function createGateway(provider: Provider, options: GatewayOptions = {}): Server {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/messages'].includes(request.url ?? '')) {
      response.writeHead(404).end();
      return;
    }

    const account = options.accounting;
    const fail = (status: number, message: string, code?: GatewayErrorCode): void => {
      if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message, type: 'factoryze_gateway_error', ...(code ? { code } : {}) } }));
      else response.destroy();
    };
    if (account) {
      const presented = request.headers.authorization?.replace(/^Bearer /, '') ?? request.headers['x-api-key'];
      if (typeof presented !== 'string' || Buffer.byteLength(presented) !== Buffer.byteLength(account.token)
        || !timingSafeEqual(Buffer.from(presented), Buffer.from(account.token))) {
        fail(401, 'Invalid gateway session token'); return;
      }
      const allowedPath = account.api === 'openai-chat' ? '/v1/chat/completions' : '/v1/messages';
      if (request.url !== allowedPath) { fail(400, 'Unsupported model API for this session'); return; }
    }
    const abort = new AbortController();
    response.on('close', () => { if (!response.writableFinished) abort.abort(); });
    try {
      let body = '';
      let bodyBytes = 0;
      request.setEncoding('utf8');
      for await (const chunk of request) {
        body += chunk;
        bodyBytes += Buffer.byteLength(chunk);
        if (bodyBytes > 1_048_576) {
          response.writeHead(413).end();
          return;
        }
      }
      if (account) {
        let payload;
        try { payload = JSON.parse(body); } catch { fail(400, 'Invalid model request'); return; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.model !== account.model) {
          fail(400, 'Model is not permitted for this session'); return;
        }
        if (payload.stream === true && account.api === 'openai-chat')
          payload.stream_options = { ...payload.stream_options, include_usage: true };
        body = JSON.stringify(payload);
      }
      const dispatch = async (): Promise<void> => {
        if (abort.signal.aborted || response.destroyed) return;
        const requestId = account?.store.begin(account.accountId, account.workspace);
        const log = (type: string, data: Record<string, unknown>): void => {
          if (account?.workspace) account.store.appendEvent(account.workspace, account.accountId, account.sessionId ?? 'gateway', type, { requestId, ...data });
        };
        let outcome = 'incomplete';
        let observed: TokenUsage | undefined;
        try {
          log('model_request_started@1', { api: account?.api });
          const result = await provider.send({ method: 'POST', path: request.url!, body, signal: abort.signal,
            ...(account?.opencodePublic ? { headers: openCodePublicHeaders(request.headers) } : {}) });
          if (account && result.headers['x-factoryze-request-id']) log('sponsored_request@1', { gatewayRequestId: result.headers['x-factoryze-request-id'] });
          if (account && result.status >= 400) {
            account.store.rejected(requestId!);
            outcome = 'rejected';
            abort.abort();
            // Never expose upstream diagnostics or credentials to the agent.
            const code: GatewayErrorCode = result.failureCode ?? (result.status === 404 ? 'provider_model_not_found' : result.status === 402 ? 'provider_payment_required' :
              result.status === 401 ? 'provider_authentication' : result.status === 403 ? 'provider_forbidden' :
              result.status === 429 ? 'provider_rate_limited' : result.status >= 500 ? 'provider_unavailable' : 'provider_rejected');
            fail(result.status, gatewayErrorMessages[code], code);
            return;
          }
          response.writeHead(result.status, result.headers);
          let bodyStream = result.body;
          if (account) {
            bodyStream = observeUsage(bodyStream, account.api, result.headers['content-type'] ?? '', {
              checkpoint: usage => account.store.checkpoint(requestId!, usage),
              finish: (usage, complete) => {
                account.store.finish(requestId!, usage, complete); observed = usage; outcome = complete ? 'complete' : 'incomplete';
              }
            });
          } else if (request.url === '/v1/chat/completions' && options.onUsage) {
            bodyStream = meterOpenAIChatStream(bodyStream, options.onUsage);
          }
          // Observe the provider's usage before applying any response rewrite.
          if (request.url === '/v1/chat/completions' && options.rewriteEdit)
            bodyStream = rewriteOpenAIChatEdit(bodyStream, options.rewriteEdit);
          await pipeline(Readable.from(bodyStream), response, { signal: abort.signal });
        } catch (error) {
          if (account && requestId) account.store.finish(requestId, undefined, false);
          throw error;
        } finally {
          if (account) {
            log('model_request_ended@1', { outcome, usage: observed ?? null });
            try { account.onUsage?.(account.store.totals(account.accountId, account.workspace)); } catch { /* UI disconnect cannot affect accounting. */ }
          }
        }
      };
      if (account) await account.store.exclusive(account.accountId, dispatch);
      else await dispatch();
    } catch (error) {
      const code = error instanceof AccountingError ? error.status === 402 ? 'budget_exhausted' : 'accounting_incomplete' : undefined;
      fail(error instanceof AccountingError ? error.status : 502,
        code ? gatewayErrorMessages[code] : 'Provider request failed', code);
    }
  });
}
