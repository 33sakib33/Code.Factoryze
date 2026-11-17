import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SoloEngine } from '../src/solo.ts';
import { HarnessSession, FACTORYZE_PROFILE } from '../src/harness.ts';

for (const api of ['openai-chat', 'anthropic-messages'] as const) {
  test(`Factoryze ${api}: streams, runs a tool, keeps history, meters every call and retains exhaustion after restart`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'factoryze-harness-'));
    const requests: Record<string, any>[] = [];
    const upstream = createServer(async (req, res) => {
      assert.equal(req.url, api === 'openai-chat' ? '/v1/chat/completions' : '/v1/messages');
      assert.equal(req.headers[api === 'openai-chat' ? 'authorization' : 'x-api-key'], api === 'openai-chat' ? 'Bearer synthetic-key' : 'synthetic-key');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      assert.equal(body.model, 'vendor/model:free');
      assert.equal(body.max_tokens, 256);
      const first = requests.length === 1;
      const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
      let stream = ': keepalive\r\n\r\n';
      if (api === 'openai-chat') {
        assert.equal(body.stream_options.include_usage, true);
        stream += frame({ choices: [{ delta: first ? { tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read', arguments: '{"file' } }] } : { content: 'Hello café' } }] });
        if (first) stream += frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Path":"app/dedupe.py"}' } }] } }] });
        stream += frame({ choices: [{ delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] });
        stream += frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 2 } } }) + 'data: [DONE]\r\n\r\n';
      } else {
        stream += frame({ type: 'message_start', message: { usage: { input_tokens: 8, cache_read_input_tokens: 2, output_tokens: 0 } } });
        stream += frame({ type: 'content_block_start', index: 0, content_block: first ? { type: 'tool_use', id: 'read-1', name: 'read', input: {} } : { type: 'text', text: '' } });
        stream += frame({ type: 'content_block_delta', index: 0, delta: first ? { type: 'input_json_delta', partial_json: '{"filePath":"app/dedupe.py"}' } : { type: 'text_delta', text: 'Hello café' } });
        stream += frame({ type: 'content_block_stop', index: 0 });
        stream += frame({ type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 4 } });
        stream += frame({ type: 'message_stop' });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(stream), split = Math.max(1, bytes.indexOf(Buffer.from('é')) + 1);
      res.write(bytes.subarray(0, split)); res.end(bytes.subarray(split));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address(); assert.ok(address && typeof address !== 'string');
    const options = { dataDir: join(root, 'data'), userId: 'student', preparePython: async () => {},
      settings: { agent: 'factoryze' as const, provider: { baseURL: `http://127.0.0.1:${address.port}/v1`, api, apiKey: 'synthetic-key' },
        model: 'vendor/model:free', contextWindow: 8192, maxOutputTokens: 256, temperature: 0,
        budget: { limit: 20, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } } };
    let engine = new SoloEngine(options);
    let harness: HarnessSession | undefined;
    try {
      const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'workspaces'));
      const meter = await engine.openGateway(workspace);
      const updates: any[] = [], tools: any[] = [];
      harness = new HarnessSession({ gateway: meter.connection, checkBudget: meter.checkBudget,
        onUpdate: update => updates.push(update), execute: async call => { tools.push(call); return 'synthetic file text'; } });
      await harness.start();
      assert.equal(requests.length, 0, 'Starting a session must not make title or other auxiliary requests');
      assert.equal(await harness.prompt('Read the file and say hello'), 'end_turn');
      assert.equal(requests.length, 2);
      assert.ok(requests.every(body => body.temperature === 0), 'Saved sampling settings reach every metered model step');
      assert.equal(tools[0].name, 'read');
      assert.equal(JSON.stringify(requests[1].messages).includes('synthetic file text'), true);
      assert.equal(updates.filter(u => u.sessionUpdate === 'agent_message_chunk').map(u => u.content.text).join(''), 'Hello café');
      assert.ok(updates.some(u => u.status === 'completed'));
      assert.equal(meter.totals().scope.profile, FACTORYZE_PROFILE);
      assert.deepEqual(meter.totals().raw, { input: 20, output: 8, cacheRead: 4, cacheWrite: 0 });
      assert.equal(meter.totals().weighted, 24.4);
      assert.equal(meter.totals().status, 'exhausted');
      assert.ok(JSON.stringify(requests[0]).length < 8000, 'The default request stays small');
      harness.stop(); await engine.close(); engine = new SoloEngine(options);
      const reopened = await engine.openGateway(workspace);
      assert.equal(reopened.totals().weighted, 24.4);
      harness = new HarnessSession({ gateway: reopened.connection, checkBudget: reopened.checkBudget, onUpdate() {}, execute: async () => '' });
      await harness.start();
      await assert.rejects(harness.prompt('Again'), /budget exhausted/i);
      assert.equal(requests.length, 2);
      const otherUser = new SoloEngine({ ...options, userId: 'other-student' });
      try {
        const other = await otherUser.startTask(join(process.cwd(), 'tasks/practice'), 'dedupe-ids', join(root, 'other-workspaces'));
        const fresh = await otherUser.openGateway(other.workspace);
        assert.equal(fresh.totals().weighted, 0);
      } finally { await otherUser.close(); }
    } finally { harness?.stop(); await engine.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
}

test('harness refuses truncated tool calls and exposes only safe gateway errors', async () => {
  let mode = 'truncated', executed = 0;
  const fetcher: typeof fetch = async () => mode === 'rejected'
    ? new Response(JSON.stringify({ error: { type: 'factoryze_gateway_error', code: 'provider_no_route', message: 'private diagnostic' } }), { status: 404 })
    : new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","function":{"name":"shell","arguments":"{}"}}]},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const options = { gateway: { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic', api: 'openai-chat' as const, model: 'test', contextWindow: 8192, maxOutputTokens: 256 },
    onUpdate() {}, execute: async () => { executed++; return ''; }, checkBudget() {}, fetcher };
  const session = new HarnessSession(options); await session.start();
  assert.equal(await session.prompt('hello'), 'max_tokens'); assert.equal(executed, 0);
  mode = 'rejected';
  await assert.rejects(session.prompt('hello'), error => error instanceof Error && /no eligible provider/.test(error.message) && !error.message.includes('private diagnostic'));
  session.stop();
});

test('Stop cancels an active model request and concurrent prompts cannot interleave history', async () => {
  let entered!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; });
  const session = new HarnessSession({ gateway: { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic', api: 'openai-chat', model: 'test', contextWindow: 8192, maxOutputTokens: 256 },
    onUpdate() {}, execute: async () => '', checkBudget() {}, fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      entered(); init!.signal!.addEventListener('abort', () => reject(new Error('Session stopped')), { once: true });
    }) });
  await session.start(); const active = session.prompt('hello'); const rejected = assert.rejects(active, /stopped/);
  await running; await assert.rejects(session.prompt('second'), /current prompt/); session.stop(); await rejected;
});

test('context caps drop complete older turns without auxiliary calls and reject oversized current prompts', async () => {
  const bodies: any[] = [];
  const session = new HarnessSession({ gateway: { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic', api: 'openai-chat', model: 'test', contextWindow: 6000, maxOutputTokens: 256 },
    onUpdate() {}, execute: async () => '', checkBudget() {}, fetcher: async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
  await session.start(); await session.prompt('a'.repeat(3000)); await session.prompt('b'.repeat(3000));
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].messages.map((m: any) => m.role), ['system', 'user']);
  assert.equal(bodies[1].messages[1].content, 'b'.repeat(3000));
  await assert.rejects(session.prompt('c'.repeat(6000)), /Context limit/); assert.equal(bodies.length, 2);
  session.stop();
});

test('temperature is sent only when pinned, for both provider APIs', async () => {
  for (const api of ['openai-chat', 'anthropic-messages'] as const) {
    for (const temperature of [undefined, 0]) {
      const bodies: any[] = [];
      const done = api === 'openai-chat' ? 'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        : ['{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}', '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
          '{"type":"content_block_stop","index":0}', '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}', '{"type":"message_stop"}'].map(event => `data: ${event}\n\n`).join('');
      const session = new HarnessSession({ gateway: { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic', api, model: 'test', contextWindow: 6000, maxOutputTokens: 256 },
        temperature, onUpdate() {}, execute: async () => '', checkBudget() {}, fetcher: async (_url, init) => {
          bodies.push(JSON.parse(init!.body as string));
          return new Response(done, { headers: { 'content-type': 'text/event-stream' } });
        } });
      await session.start(); await session.prompt('hello');
      assert.equal(bodies[0].temperature, temperature, `${api} temperature ${temperature}`);
      assert.equal('temperature' in bodies[0], temperature !== undefined);
      session.stop();
    }
  }
});

test('OpenCode-only public connections fail before the custom harness sends any request', () => {
  assert.throws(() => new HarnessSession({ gateway: { baseURL: 'http://127.0.0.1:1/v1', sessionToken: 'synthetic', api: 'openai-chat', model: 'deepseek-v4.1-flash-free',
    contextWindow: 200000, maxOutputTokens: 256, opencodePublic: true }, onUpdate() {}, checkBudget() {}, execute: async () => '' }), /cannot be used by Factoryze/);
});


test('sponsored context limits drop complete earlier turns and reject oversized requests before dispatch', async () => {
  const bodies:any[]=[];
  const session=new HarnessSession({gateway:{baseURL:'http://127.0.0.1:1/v1',sessionToken:'synthetic',api:'openai-chat',model:'trial',contextWindow:32768,maxOutputTokens:1024,
    trialLimits:{maxRequestBytes:65536,maxMessages:2,maxTools:32,maxInputTokens:32768}},onUpdate(){},checkBudget(){},execute:async()=>'',fetcher:async(_url,init)=>{
    bodies.push(JSON.parse(init!.body as string));return new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  await session.start();await session.prompt('first');await session.prompt('second');
  assert.equal(bodies.length,2);assert.deepEqual(bodies[1].messages.map((m:any)=>m.role),['system','user']);assert.equal(bodies[1].messages[1].content,'second');
  await assert.rejects(session.prompt('x'.repeat(32000)),/Context limit/);assert.equal(bodies.length,2);session.stop();
});
