import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentConfiguration } from '../src/browser/agent-configuration.ts';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('a task without a model offers setup and becomes ready after settings are saved', async () => {
  let saved = false;
  const config = new AgentConfiguration(async () => saved);
  assert.equal(await config.refresh(), false); assert.equal(config.state, 'missing');
  saved = true;
  assert.equal(await config.refresh(), true); assert.equal(config.state, 'ready');
});

test('a settings lookup failure is distinguishable from missing settings and can be retried', async () => {
  let unavailable = true;
  const config = new AgentConfiguration(async () => { if (unavailable) throw new Error('Disconnected'); return true; });
  assert.equal(await config.refresh(), false); assert.equal(config.state, 'unavailable');
  unavailable = false;
  assert.equal(await config.refresh(), true); assert.equal(config.state, 'ready');
});

test('a stale startup lookup cannot disable chat after a successful settings refresh', async () => {
  const initial = deferred<boolean>(); let calls = 0;
  const config = new AgentConfiguration(() => ++calls === 1 ? initial.promise : Promise.resolve(true));
  const startup = config.refresh(); assert.equal(config.state, 'checking');
  assert.equal(await config.refresh(), true);
  initial.resolve(false);
  assert.equal(await startup, true); assert.equal(config.state, 'ready');
});

test('clearing settings wins over an older ready result', async () => {
  const initial = deferred<boolean>(); let calls = 0;
  const config = new AgentConfiguration(() => ++calls === 1 ? initial.promise : Promise.resolve(false));
  const startup = config.refresh(); await config.refresh(); initial.resolve(true);
  assert.equal(await startup, false); assert.equal(config.state, 'missing');
});
