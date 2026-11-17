import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/gateway.ts';
import { UsageStore } from '../src/usage-store.ts';

const chunks = ['data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\n', 'data: [DONE]\n\n'];

test('public OpenCode requests retain native context, meter tokens and distinguish provider failures from a task budget', async () => {
  const store = new UsageStore(':memory:');
  const accountId = store.account({ userId: 'public-user', taskId: 'task', profile: 'opencode@1.18.29', model: 'free' },
    { limit: 10, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  let status = 404, calls = 0, policy = false;
  const server = createGateway({ async send(request) {
    calls++;
    assert.deepEqual(request.headers, { 'x-opencode-session': 'ses_synthetic', 'user-agent': 'opencode/1.18.29' });
    return { status, ...(policy ? { failureCode: 'provider_data_policy' as const } : {}), headers: { 'content-type': 'text/event-stream' }, body: (async function* () { yield* chunks; })() };
  } }, { accounting: { store, accountId, token: 'test-session', model: 'free', api: 'openai-chat', opencodePublic: true } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = () => fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, { method: 'POST', headers: {
    authorization: 'Bearer test-session', 'x-opencode-session': 'ses_synthetic', 'user-agent': 'opencode/1.18.29', 'x-api-key': 'synthetic-private'
  }, body: '{"model":"free","stream":true}' });
  try {
    let response = await send(); assert.equal((await response.json()).error.code, 'provider_model_not_found');
    policy = true; response = await send(); assert.equal((await response.json()).error.code, 'provider_data_policy'); policy = false;
    status = 402; response = await send(); assert.equal((await response.json()).error.code, 'provider_payment_required');
    assert.equal(store.totals(accountId).weighted, 0);
    status = 200; await (await send()).text(); assert.equal(store.totals(accountId).weighted, 14);
    response = await send(); assert.equal((await response.json()).error.code, 'budget_exhausted'); assert.equal(calls, 4);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('authenticated gateway counts every request, serializes spending, and refuses requests after the budget', async () => {
  const store = new UsageStore(':memory:');
  const accountId = store.account({ userId: 'a', taskId: 'task', profile: 'opencode@1.18.29', model: 'test' },
    { limit: 20, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const server = createGateway({ async send(request) {
    calls++; active++; maxActive = Math.max(maxActive, active);
    assert.equal(JSON.parse(request.body).stream_options.include_usage, true);
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: (async function* () {
      try { await new Promise(resolve => setTimeout(resolve, 10)); yield* chunks; }
      finally { active--; }
    })() };
  } }, { accounting: { store, accountId, token: 'test-session', model: 'test', api: 'openai-chat' } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const send = (token = 'test-session', model = 'test') => fetch(url, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model, stream: true, messages: [] })
  }).then(async response => ({ status: response.status, body: await response.text() }));
  try {
    assert.equal((await send('wrong')).status, 401);
    assert.equal((await send('test-session', 'other-model')).status, 400);
    assert.equal(calls, 0);
    const results = await Promise.all([send(), send(), send()]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 402]);
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    assert.deepEqual(store.totals(accountId).raw, { input: 20, output: 8, cacheRead: 0, cacheWrite: 0 });
    assert.equal(store.totals(accountId).weighted, 28);
    assert.equal((await send()).status, 402);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('client cancellation persists observed usage and blocks subsequent requests', async () => {
  const store = new UsageStore(':memory:');
  const accountId = store.account({ userId: 'a', taskId: 'task', profile: 'opencode@1.18.29', model: 'test' },
    { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  let recorded!: () => void;
  const finished = new Promise<void>(resolve => { recorded = resolve; });
  const server = createGateway({ async send(request) {
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: (async function* () {
      yield chunks[0];
      if (!request.signal?.aborted) await new Promise(resolve => request.signal?.addEventListener('abort', resolve, { once: true }));
      throw new Error('Canceled upstream');
    })() };
  } }, { accounting: { store, accountId, token: 'test-session', model: 'test', api: 'openai-chat', onUsage: () => recorded() } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer test-session' }, body: '{"model":"test","stream":true}'
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await finished;
    assert.equal(store.totals(accountId).weighted, 14);
    assert.equal(store.totals(accountId).status, 'incomplete');
    assert.throws(() => store.begin(accountId), /incomplete/i);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('provider rejections do not expose diagnostics and do not consume the token budget', async () => {
  const store = new UsageStore(':memory:');
  const accountId = store.account({ userId: 'a', taskId: 'task', profile: 'opencode@1.18.29', model: 'test' },
    { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  const server = createGateway({ async send() {
    return { status: 429, headers: {}, body: (async function* () { yield 'fake-secret-upstream-diagnostics'; })() };
  } }, { accounting: { store, accountId, token: 'test-session', model: 'test', api: 'openai-chat' } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer test-session' }, body: '{"model":"test","stream":true}'
    });
    assert.equal(response.status, 429);
    assert.equal((await response.text()).includes('fake-secret'), false);
    assert.equal(store.totals(accountId).status, 'ready');
    assert.equal(store.totals(accountId).weighted, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('missing usage blocks the next call rather than recording free tokens', async () => {
  const store = new UsageStore(':memory:');
  const accountId = store.account({ userId: 'a', taskId: 'task', profile: 'opencode@1.18.29', model: 'test' },
    { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } });
  const server = createGateway({ async send() {
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: (async function* () { yield 'data: [DONE]\n\n'; })() };
  } }, { accounting: { store, accountId, token: 'test-session', model: 'test', api: 'openai-chat' } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const send = () => fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer test-session' }, body: '{"model":"test","stream":true}'
    });
    await (await send()).text();
    assert.equal(store.totals(accountId).status, 'incomplete');
    const next = await send();
    assert.equal(next.status, 409);
    assert.match(await next.text(), /incomplete/i);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
