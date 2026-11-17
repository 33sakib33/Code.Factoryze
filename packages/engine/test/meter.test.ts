import assert from 'node:assert/strict';
import test from 'node:test';
import { meterOpenAIChatStream, observeUsage, weightedTokens } from '../src/meter.ts';

test('weighted tokens discount cached input without hiding raw counts', () => {
  const usage = { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 };
  assert.equal(weightedTokens(usage, { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 }), 84);
});

test('accounts for JSON and Anthropic cache counts without double counting cached input', async () => {
  for (const [api, contentType, chunks, expected] of [
    ['openai-chat', 'application/json', ['{"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40}}}'],
      { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 }],
    ['anthropic-messages', 'text/event-stream', [
      'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":60,"output_tokens":1,"cache_read_input_tokens":30,"cache_creation_input_tokens":10}}}\r\n\r\n',
      'data: {"type":"message_delta","usage":{"output_tokens":20}}\n\n',
      'data: {"type":"message_stop"}\n\n'],
      { input: 100, output: 20, cacheRead: 30, cacheWrite: 10 }]
  ] as const) {
    let result: unknown;
    const out = [];
    for await (const chunk of observeUsage((async function* () { yield* chunks; })(), api, contentType,
      { finish: (usage, complete) => { result = { usage, complete }; } })) out.push(chunk);
    assert.deepEqual(out, chunks);
    assert.deepEqual(result, { usage: expected, complete: true });
  }
});

test('interruption preserves observed usage; absent, invalid and truncated usage stays incomplete', async () => {
  for (const payload of [undefined, { prompt_tokens: -1, completion_tokens: 4 }, { prompt_tokens: 10, completion_tokens: 4 }]) {
    let result: unknown;
    const stream = (async function* () {
      yield `data: ${JSON.stringify({ usage: payload })}\n\n`;
      throw new Error('interrupted');
    })();
    await assert.rejects(async () => {
      for await (const chunk of observeUsage(stream, 'openai-chat', 'text/event-stream', {
        finish: (usage, complete) => { result = { usage, complete }; }
      })) { /* Consume response. */ }
    }, /interrupted/);
    assert.deepEqual(result, { usage: payload?.prompt_tokens === 10 ? { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 } : undefined, complete: false });
  }
});

test('a malformed final usage event cannot turn an earlier checkpoint into a complete charge', async () => {
  for (const invalid of ['data: {"usage":{"prompt_tokens":-1,"completion_tokens":4}}\n\n', 'data: {broken-json}\n\n']) {
    let result: unknown;
    const chunks = ['data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n', invalid, 'data: [DONE]\n\n'];
    for await (const chunk of observeUsage((async function* () { yield* chunks; })(), 'openai-chat', 'text/event-stream', {
      finish: (usage, complete) => { result = { usage, complete }; }
    })) { /* Consume response. */ }
    assert.deepEqual(result, { usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0 }, complete: false });
  }
});

test('metering reads a usage event split across chunks and preserves the stream', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40}},',
    '"choices":[]}\n\n',
    'data: [DONE]\n\n'
  ];
  let reported: unknown;
  const output: string[] = [];
  for await (const chunk of meterOpenAIChatStream((async function* () { yield* chunks; })(), usage => { reported = usage; })) {
    output.push(chunk);
  }
  assert.deepEqual(output, chunks);
  assert.deepEqual(reported, { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 });
});
