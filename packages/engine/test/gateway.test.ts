import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGateway } from '../src/gateway.ts';
import { ReplayProvider, type ReplayFixture } from '../src/replay.ts';
import { request as httpRequest } from 'node:http';

test('the gateway streams a replayed provider response over HTTP', async () => {
  const path = new URL('../../../test/fixtures/chat-stream.json', import.meta.url);
  const fixture = JSON.parse(await readFile(path, 'utf8')) as ReplayFixture;
  fixture.response.chunks.splice(-1, 0, 'data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\n');
  let reported: unknown;
  const server = createGateway(new ReplayProvider([fixture]), { onUsage: usage => { reported = usage; } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}${fixture.request.path}`, {
      method: 'POST', body: fixture.request.body, headers: { 'content-type': 'application/json' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(await response.text(), fixture.response.chunks.join(''));
    assert.deepEqual(reported, { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 });

    const missing = await fetch(`http://127.0.0.1:${address.port}/unknown`, { method: 'POST' });
    assert.equal(missing.status, 404);
    const oversized = await fetch(`http://127.0.0.1:${address.port}${fixture.request.path}`, {
      method: 'POST', body: 'x'.repeat(1_048_577)
    });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('gateway preserves a Unicode prompt split across incoming UTF-8 chunks', async () => {
  let captured = '';
  const server = createGateway({ async send(request) {
    captured = request.body;
    return { status: 200, headers: { 'content-type': 'application/json' }, body: (async function* () { yield '{}'; })() };
  } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const body = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'হ্যালো' }] });
  const bytes = Buffer.from(body);
  const split = bytes.indexOf(Buffer.from('হ')) + 1;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${address.port}/v1/chat/completions`, { method: 'POST' }, response => {
        response.resume(); response.on('end', resolve);
      });
      request.on('error', reject);
      request.write(bytes.subarray(0, split));
      setTimeout(() => request.end(bytes.subarray(split)), 10);
    });
    assert.equal(captured, body);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('the gateway rewrites an edit before returning the tool call', async () => {
  const args = { filePath: '/tmp/answer.txt', oldString: 'answer = 1', newString: 'answer = 2' };
  const tool = { id: 'chatcmpl-replay', object: 'chat.completion.chunk', created: 1, model: 'replay',
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_edit_1', type: 'function', function: { name: 'edit', arguments: JSON.stringify(args) } }] }, finish_reason: null }] };
  const fixture: ReplayFixture = {
    request: { method: 'POST', path: '/v1/chat/completions', body: '{}' },
    response: { status: 200, headers: { 'content-type': 'text/event-stream' }, chunks: [`data: ${JSON.stringify(tool)}\n\n`, 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n', 'data: [DONE]\n\n'] }
  };
  const server = createGateway(new ReplayProvider([fixture]), { rewriteEdit: original => ({ ...original, newString: 'answer = 3' }) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, { method: 'POST', body: '{}' });
    const body = await response.text();
    assert.equal(body.includes('answer = 2'), false);
    assert.equal(body.includes('answer = 3'), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
