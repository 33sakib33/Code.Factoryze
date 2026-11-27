import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelSettingsStore, fileTrialPreferences } from '../src/node/model-settings.ts';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const setup = {
  schema: 1 as const, api: 'openai-chat' as const, baseURL: 'https://api.example.com/v1', model: 'example-model',
  contextWindow: 8192, maxOutputTokens: 2048, budgetTokens: 5000,
};

test('unavailable Linux Secret Service gives safe recovery guidance for reads, writes and deletes', async () => {
  const fail = async (): Promise<never> => { throw new Error('synthetic-private-native-error'); };
  const store = new ModelSettingsStore({ getPassword: fail, setPassword: fail, deletePassword: fail }, 'isolated', 'linux');
  for (const action of [() => store.load({}), () => store.forEngine({}), () => store.save({ ...setup, apiKey: 'synthetic-key' }), () => store.clear()]) {
    await assert.rejects(action, error => error instanceof Error && /Secret Service|GNOME Keyring|KWallet/.test(error.message) &&
      /FACTORYZE_PROVIDER_URL/.test(error.message) && !error.message.includes('synthetic-private'));
  }
  const view = await store.load({ FACTORYZE_PROVIDER_URL: 'http://127.0.0.1:9000/v1', FACTORYZE_MODEL: 'replay', FACTORYZE_PROVIDER_API_KEY: 'synthetic' });
  assert.equal(view?.source, 'environment', 'An unavailable keychain cannot break the explicit backend fallback');
});

test('temperature persists, reaches the engine and can be cleared without replacing credentials', async () => {
  let raw: string | null = null;
  const store = new ModelSettingsStore({ getPassword: async () => raw,
    setPassword: async (_s, _a, value) => { raw = value; }, deletePassword: async () => true });
  await store.save({ ...setup, apiKey: 'synthetic-key', temperature: 0 });
  assert.equal((await store.load({}))?.temperature, 0);
  assert.equal((await store.forEngine({}))?.temperature, 0);
  await store.save({ ...setup, temperature: undefined });
  assert.equal((await store.forEngine({}))?.temperature, undefined);
  assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-key');
  await assert.rejects(store.save({ ...setup, temperature: -1 }));
});

test('environment temperature is validated and visible without keychain access', async () => {
  const store = new ModelSettingsStore({ getPassword: async () => { throw new Error('No keychain access'); }, setPassword: async () => {}, deletePassword: async () => false });
  const env = { FACTORYZE_PROVIDER_URL: 'http://127.0.0.1:9000/v1', FACTORYZE_MODEL: 'replay', FACTORYZE_PROVIDER_API_KEY: 'synthetic' };
  assert.equal((await store.forEngine({ ...env, FACTORYZE_TEMPERATURE: '0' }))?.temperature, 0);
  assert.equal((await store.load({ ...env, FACTORYZE_TEMPERATURE: '0.5' }))?.temperature, 0.5);
  assert.equal((await store.forEngine(env))?.temperature, undefined);
  await assert.rejects(store.forEngine({ ...env, FACTORYZE_TEMPERATURE: 'nonsense' }));
});

test('model settings keep the key in the credential store and return only redacted settings', async () => {
  const passwords = new Map<string, string>();
  const credentials = {
    getPassword: async (_service: string, account: string) => passwords.get(account) ?? null,
    setPassword: async (_service: string, account: string, password: string) => { passwords.set(account, password); },
    deletePassword: async (_service: string, account: string) => passwords.delete(account),
  };
  const store = new ModelSettingsStore(credentials);
  assert.equal(await store.load(), null);
  await assert.rejects(() => store.save(setup), /API key/i);
  const visible = await store.save({ ...setup, apiKey: 'secret-test-value' });
  assert.deepEqual(visible, { ...setup, agent: 'factoryze', hasKey: true });
  assert.equal(JSON.stringify(visible).includes('secret-test-value'), false);
  assert.equal((await store.forEngine())?.provider.apiKey, 'secret-test-value');
  const updated = await store.save({ ...setup, model: 'second-model' });
  assert.equal(updated.model, 'second-model');
  assert.equal((await store.forEngine())?.provider.apiKey, 'secret-test-value');
  assert.equal((await store.forEngine())?.budget.limit, 5000);
  await store.clear();
  assert.equal(await store.load(), null);
  assert.equal(await store.forEngine(), undefined);
});

test('model settings reject unsafe provider URLs and invalid capacities before saving', async () => {
  let saves = 0;
  const store = new ModelSettingsStore({
    getPassword: async () => null,
    setPassword: async () => { saves++; },
    deletePassword: async () => true,
  });
  await assert.rejects(() => store.save({ ...setup, baseURL: 'http://api.example.com/v1', apiKey: 'test' }), /HTTPS/i);
  await assert.rejects(() => store.save({ ...setup, maxOutputTokens: 9999, apiKey: 'test' }), /output.*context/i);
  assert.equal(saves, 0);
});

test('judge and scoring remain opt-in and selected judge settings reach only the engine', async () => {
  const values = new Map<string, string>();
  const store = new ModelSettingsStore({ getPassword: async () => values.get('saved') ?? null,
    setPassword: async (_service, _account, value) => { values.set('saved', value); },
    deletePassword: async () => values.delete('saved') });
  const view = await store.save({ schema: 1, api: 'openai-chat', baseURL: 'https://provider.invalid/v1', model: 'main',
    contextWindow: 8192, maxOutputTokens: 2048, budgetTokens: 1000, apiKey: 'synthetic-secret',
    modules: { judge: true, scoring: true }, judgeModel: 'small-judge' });
  assert.equal(JSON.stringify(view).includes('synthetic-secret'), false);
  assert.deepEqual((await store.forEngine())?.modules, { judge: true, scoring: true });
  assert.equal((await store.forEngine())?.judgeModel, 'small-judge');
});

test('explicit backend provider configuration works without accessing the desktop keychain', async () => {
  const store = new ModelSettingsStore({ getPassword: async () => { throw new Error('Keychain must not be accessed'); }, setPassword: async () => {}, deletePassword: async () => false });
  const settings = await store.forEngine({ FACTORYZE_PROVIDER_URL: 'http://127.0.0.1:9000/v1', FACTORYZE_MODEL: 'replay', FACTORYZE_PROVIDER_API_KEY: 'synthetic', FACTORYZE_JUDGE_ENABLED: '1' });
  assert.equal(settings?.model, 'replay');
  assert.equal(settings?.modules?.judge, true);
  assert.equal(settings?.modules?.scoring, false);
  const view = await store.load({ FACTORYZE_PROVIDER_URL: 'http://127.0.0.1:9000/v1', FACTORYZE_MODEL: 'replay', FACTORYZE_PROVIDER_API_KEY: 'synthetic' });
  assert.equal(view?.source, 'environment');
  assert.equal(view?.hasKey, true);
  assert.equal(JSON.stringify(view).includes('synthetic'), false);
});

test('isolated credential accounts do not read, overwrite or delete the normal desktop setup', async () => {
  const values = new Map<string, string>();
  const credentials = { getPassword: async (_service: string, account: string) => values.get(account) ?? null,
    setPassword: async (_service: string, account: string, value: string) => { values.set(account, value); },
    deletePassword: async (_service: string, account: string) => values.delete(account) };
  const normal = new ModelSettingsStore(credentials), smoke = new ModelSettingsStore(credentials, 'smoke-isolated');
  await normal.save({ ...setup, apiKey: 'synthetic-normal' });
  assert.equal(await smoke.load({}), null);
  await smoke.save({ ...setup, model: 'smoke-model', apiKey: 'synthetic-smoke' });
  assert.equal((await normal.load({}))?.model, setup.model);
  assert.equal((await smoke.load({}))?.model, 'smoke-model');
  await smoke.clear(); assert.equal(await smoke.load({}), null);
  assert.equal((await normal.forEngine({}))?.provider.apiKey, 'synthetic-normal');
});

test('OpenRouter saves and legacy reads select Chat Completions without replacing the saved key', async () => {
  let raw = JSON.stringify({ ...setup, baseURL: 'https://openrouter.ai/api/v1', api: 'anthropic-messages', model: 'nvidia/nemotron-3.5-lightning', apiKey: 'synthetic-router-key' });
  const store = new ModelSettingsStore({ getPassword: async () => raw, setPassword: async (_s, _a, value) => { raw = value; }, deletePassword: async () => true });
  assert.equal((await store.load({}))?.api, 'openai-chat');
  assert.equal((await store.forEngine({}))?.provider.api, 'openai-chat');
  assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-router-key');
  const saved = await store.save({ ...setup, api: 'anthropic-messages', baseURL: 'https://openrouter.ai/api/v1', model: 'nvidia/nemotron-3.5-lightning:free' });
  assert.equal(saved.api, 'openai-chat'); assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-router-key');
});

test('pasting an OpenRouter completion endpoint repairs the base URL on save and legacy load without losing credentials', async () => {
  let raw = JSON.stringify({ ...setup, baseURL: 'https://openrouter.ai/api/v1/chat/completions/', apiKey: 'synthetic-router-key' });
  const store = new ModelSettingsStore({ getPassword: async () => raw, setPassword: async (_s, _a, value) => { raw = value; }, deletePassword: async () => true });
  assert.equal((await store.load({}))?.baseURL, 'https://openrouter.ai/api/v1');
  assert.equal((await store.forEngine({}))?.provider.baseURL, 'https://openrouter.ai/api/v1');
  const view = await store.save({ ...setup, baseURL: 'https://openrouter.ai/api/v1/chat/completions' });
  assert.equal(view.baseURL, 'https://openrouter.ai/api/v1');
  assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-router-key');
});

test('Factoryze is explicitly selected, survives keychain reload and retains the existing provider key', async () => {
  let raw: string | null = null;
  const store = new ModelSettingsStore({ getPassword: async () => raw,
    setPassword: async (_s, _a, value) => { raw = value; }, deletePassword: async () => true });
  await store.save({ ...setup, apiKey: 'synthetic-existing' });
  assert.equal((await store.forEngine({}))?.agent, 'factoryze', 'Existing connections use our own backend');
  await store.save({ ...setup, agent: 'factoryze' });
  assert.equal((await store.load({}))?.agent, 'factoryze');
  assert.equal((await store.forEngine({}))?.agent, 'factoryze');
  assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-existing');
  assert.equal(JSON.stringify(await store.load({})).includes('synthetic-existing'), false);
});

test('legacy OpenCode settings migrate to Factoryze without losing the provider key or budget', async () => {
  let raw = JSON.stringify({ ...setup, agent: 'opencode', apiKey: 'synthetic-legacy' });
  const store = new ModelSettingsStore({ getPassword: async () => raw, setPassword: async (_s, _a, value) => { raw = value; }, deletePassword: async () => true });
  assert.equal((await store.load({}))?.agent, 'factoryze');
  assert.equal((await store.forEngine({}))?.agent, 'factoryze');
  assert.equal((await store.forEngine({}))?.budget.limit, 5000);
  assert.equal((await store.forEngine({}))?.provider.apiKey, 'synthetic-legacy');
  assert.equal((await store.save({ ...setup, agent: 'opencode' })).agent, 'factoryze');
});

test('trial preferences are a private file that is replaced whole, and a missing or damaged file reads as nothing saved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-trial-preferences-'));
  try {
    const path = join(root, 'trial-connection', 'account.json'), preferences = fileTrialPreferences(path);
    assert.equal(await preferences.read(), null);
    await preferences.write('{"first":true}'); await preferences.write('{"second":true}');
    assert.equal(await preferences.read(), '{"second":true}');
    assert.deepEqual(readdirSync(join(root, 'trial-connection')), ['account.json'], 'no scratch file is left behind');
    if (process.platform !== 'win32') { assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(statSync(join(root, 'trial-connection')).mode & 0o777, 0o700); }
    // The store treats text it cannot parse as a fresh start instead of failing at launch.
    writeFileSync(path, 'not json');
    const store = new ModelSettingsStore({ getPassword: async () => { throw new Error('The credential store must stay closed'); }, setPassword: async () => {}, deletePassword: async () => false },
      'file-check', 'darwin', { origin: 'https://trial.example', preferences });
    assert.equal(await store.trial.selected(), false); assert.equal((await store.trial.view()).signedIn, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
