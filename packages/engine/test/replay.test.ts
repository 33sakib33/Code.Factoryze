import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { recordExchange, ReplayProvider, type ReplayFixture } from '../src/replay.ts';

async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const chunk of chunks) result.push(chunk);
  return result;
}

test('recording and replay preserve streamed chunk boundaries', async () => {
  const request = { method: 'POST', path: '/v1/chat/completions', body: '{"messages":[]}', headers: { authorization: 'Bearer secret' } };
  const recorded = await recordExchange(request, async () => ({
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'set-cookie': 'secret' },
    body: (async function* () { yield 'data: first\n\n'; yield 'data: second\n\n'; })()
  }));
  assert.deepEqual(recorded.fixture.request, { method: 'POST', path: '/v1/chat/completions', body: '{"messages":[]}' });
  assert.deepEqual(recorded.fixture.response.headers, { 'content-type': 'text/event-stream' });
  assert.deepEqual(await collect(recorded.response.body), ['data: first\n\n', 'data: second\n\n']);

  const replay = new ReplayProvider([recorded.fixture]);
  const response = await replay.send(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await collect(response.body), ['data: first\n\n', 'data: second\n\n']);
  assert.equal(replay.remaining, 0);
});

test('a mismatched request does not consume the next fixture', async () => {
  const fixture = { request: { method: 'POST', path: '/v1/messages', body: '{}' }, response: { status: 200, headers: {}, chunks: ['ok'] } };
  const replay = new ReplayProvider([fixture]);
  await assert.rejects(replay.send({ method: 'POST', path: '/wrong', body: '{}' }), /does not match/);
  assert.equal(replay.remaining, 1);
  assert.deepEqual(await collect((await replay.send({ method: 'POST', path: '/v1/messages', body: '{}' })).body), ['ok']);
  await assert.rejects(replay.send({ method: 'POST', path: '/v1/messages', body: '{}' }), /exhausted/);
});

test('a committed fixture replays without a network provider', async () => {
  const path = new URL('../../../test/fixtures/chat-stream.json', import.meta.url);
  const fixture = JSON.parse(await readFile(path, 'utf8')) as ReplayFixture;
  const replay = new ReplayProvider([fixture]);
  const response = await replay.send(fixture.request);
  assert.equal(response.status, 200);
  assert.equal((await collect(response.body)).join(''), fixture.response.chunks.join(''));
});
