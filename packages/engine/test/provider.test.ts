import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { HttpProvider } from '../src/provider.ts';

test('temperature refusals have a safe specific category without misclassifying unrelated bad requests', async () => {
  for (const [status, message, expected] of [
    [400, "Unsupported parameter: 'temperature' synthetic-secret", 'provider_temperature_unsupported'],
    [422, 'temperature: only the default (1) value is supported', 'provider_temperature_unsupported'],
    [400, 'max_tokens is not supported', undefined],
    [500, 'temperature service error', undefined],
  ] as const) {
    const provider = new HttpProvider({ baseURL: 'https://provider.invalid/v1', api: 'openai-chat', apiKey: 'synthetic-key' }, async () =>
      new Response(JSON.stringify({ error: { message } }), { status }));
    const result = await provider.send({ method: 'POST', path: '/v1/chat/completions', body: '{"temperature":0}' });
    assert.equal(result.failureCode, expected);
    assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  }
});

test('Anthropic transport keeps the upstream key in engine headers and preserves split UTF-8 bytes', async () => {
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/messages');
    assert.equal(request.headers['x-api-key'], 'synthetic-engine-key');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.headers.authorization, undefined);
    for await (const chunk of request) { /* Drain request. */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    const bytes = Buffer.from('{"text":"€","usage":{"input_tokens":10,"output_tokens":4}}');
    const split = bytes.indexOf(Buffer.from('€')) + 1;
    response.write(bytes.subarray(0, split));
    setImmediate(() => response.end(bytes.subarray(split)));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  try {
    const provider = new HttpProvider({ baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-engine-key', api: 'anthropic-messages' });
    const response = await provider.send({ method: 'POST', path: '/v1/messages', body: '{}', headers: { authorization: 'Bearer agent-session' } });
    let text = ''; for await (const chunk of response.body) text += chunk;
    assert.equal(JSON.parse(text).text, '€');
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())); }
});

test('provider URL validation rejects plaintext remote endpoints and credentials embedded in URLs', () => {
  for (const baseURL of ['http://provider.invalid/v1', 'https://user:secret@provider.invalid/v1', 'file:///tmp/provider', 'https://provider.invalid/v1?api_key=secret']) {
    assert.throws(() => new HttpProvider({ baseURL, apiKey: 'synthetic-only', api: 'openai-chat' }), /Provider URL/);
  }
});

test('a pasted OpenRouter request endpoint is appended exactly once', async () => {
  let target = '';
  const provider = new HttpProvider({ baseURL: 'https://openrouter.ai/api/v1/chat/completions/', apiKey: 'synthetic-router-key', api: 'openai-chat' }, async (url) => {
    target = String(url); return new Response('{}');
  });
  const response = await provider.send({ method: 'POST', path: '/v1/chat/completions', body: '{}' });
  for await (const chunk of response.body) { /* drain */ }
  assert.equal(target, 'https://openrouter.ai/api/v1/chat/completions');
});

test('OpenRouter routing and account errors expose only a safe category, not upstream diagnostics', async () => {
  for (const [message, expected] of [
    ['No endpoints found matching your data policy. synthetic-private-diagnostic', 'provider_data_policy'],
    ['No endpoints found for the requested model', 'provider_no_route'],
    ['User not found', 'provider_authentication'],
  ] as const) {
    const provider = new HttpProvider({ baseURL: 'https://openrouter.ai/api/v1', api: 'openai-chat', apiKey: 'synthetic-key' }, async () =>
      new Response(JSON.stringify({ error: { message } }), { status: 404, headers: { 'content-type': 'application/json' } }));
    const result = await provider.send({ method: 'POST', path: '/v1/chat/completions', body: '{}' });
    assert.equal(result.failureCode, expected);
    assert.equal(JSON.stringify(result).includes('synthetic-private-diagnostic'), false);
  }
});

test('OpenCode public transport preserves native OpenCode headers and never forwards a private credential or session token', async () => {
  let received: { url: string; init: RequestInit } | undefined;
  const provider = new HttpProvider({ api: 'openai-chat', baseURL: 'https://opencode.ai/inference/openai/v1', authentication: 'opencode-public', apiKey: 'synthetic-private-key' }, async (url, init) => {
    received = { url: String(url), init: init! };
    return new Response('data: {"usage":{"prompt_tokens":10,"completion_tokens":2},"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = await provider.send({ method: 'POST', path: '/v1/chat/completions', body: '{"model":"deepseek-v4.1-flash-free","stream":true}', headers: {
    authorization: 'Bearer synthetic-session-token', 'x-opencode-session': 'ses_test', 'x-opencode-request': 'msg_test', 'x-opencode-client': 'cli',
    'user-agent': 'opencode/1.18.29', 'x-private': 'synthetic-private-header'
  } });
  for await (const chunk of result.body) { /* consume */ }
  assert.equal(received?.url, 'https://opencode.ai/inference/openai/v1/chat/completions');
  const headers = new Headers(received!.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer public'); assert.equal(headers.get('x-opencode-session'), 'ses_test');
  assert.equal(headers.get('x-private'), null); assert.equal(JSON.stringify(received).includes('synthetic-private'), false);
  assert.throws(() => new HttpProvider({ api: 'openai-chat', baseURL: 'https://other.invalid/v1', authentication: 'opencode-public', apiKey: '' }), /OpenCode/i);
});
