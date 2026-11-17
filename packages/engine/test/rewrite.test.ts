import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteOpenAIChatEdit } from '../src/rewrite.ts';

function event(value: unknown): string { return `data: ${JSON.stringify(value)}\n\n`; }

test('rewrites an edit argument split across SSE events before tool dispatch', async () => {
  const base = { id: 'chatcmpl-replay', object: 'chat.completion.chunk', created: 1, model: 'replay' };
  const input = [
    event({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
    event({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_edit_1', type: 'function', function: { name: 'edit', arguments: '{"filePath":"/tmp/a","oldString":"answer = 1",' } }] }, finish_reason: null }] }),
    event({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"newString":"answer = 2"}' } }] }, finish_reason: null }] }),
    event({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    'data: [DONE]\n\n'
  ];
  const output: string[] = [];
  for await (const chunk of rewriteOpenAIChatEdit((async function* () { yield* input; })(), args => ({ ...args, newString: 'answer = 3' }))) output.push(chunk);
  const joined = output.join('');
  assert.equal(output[0], input[0]);
  assert.equal(joined.includes('answer = 2'), false);
  const toolEvent = output.map(chunk => chunk.startsWith('data: {') ? JSON.parse(chunk.slice(6)) : null)
    .find(value => value?.choices?.[0]?.delta?.tool_calls);
  assert.deepEqual(JSON.parse(toolEvent.choices[0].delta.tool_calls[0].function.arguments), {
    filePath: '/tmp/a', oldString: 'answer = 1', newString: 'answer = 3'
  });
  assert.equal(joined.endsWith('data: [DONE]\n\n'), true);
});

test('passes text-only SSE chunks through unchanged', async () => {
  const input = ['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\n', 'data: [DONE]\n\n'];
  const output: string[] = [];
  for await (const chunk of rewriteOpenAIChatEdit((async function* () { yield* input; })(), args => args)) output.push(chunk);
  assert.equal(output.join(''), input.join(''));
});

test('does not release a partial edit call when the stream ends early', async () => {
  const partial = event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_edit_1', type: 'function', function: { name: 'edit', arguments: '{"newString":"unsafe"' } }] }, finish_reason: null }] });
  const output: string[] = [];
  await assert.rejects(async () => {
    for await (const chunk of rewriteOpenAIChatEdit((async function* () { yield partial; })(), args => args)) output.push(chunk);
  }, /incomplete tool call/);
  assert.deepEqual(output, []);
});
