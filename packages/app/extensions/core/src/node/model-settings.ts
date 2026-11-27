import { modelSettingsInputSchema, modelSettingsSchema, providerApi, providerBaseURL, factoryzePublicModelMessage, type ModelSettingsInput, type ModelSettingsView } from '@factoryze/protocol';
import { soloSettings, type SoloSettings } from '@factoryze/engine/solo';
import { TrialConnectionStore, memoryTrialPreferences, type TrialPreferences } from '#trial-connection';
import { LabConnectionStore } from '#lab-connection';
import { factoryzeDataDir } from '@factoryze/engine/data-dir';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

type Credentials = Pick<typeof import('keytar'), 'getPassword' | 'setPassword' | 'deletePassword'>;
const service = 'Factoryze Solo Provider';
const trialService = 'Factoryze Trial Account';

/** Trial preferences as a private file in the app's data folder. It holds no secret, so reading it never opens the system credential store. */
export function fileTrialPreferences(path: string): TrialPreferences {
  return {
    read: async () => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
    write: async value => { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const scratch = path + '.new'; writeFileSync(scratch, value, { mode: 0o600 }); renameSync(scratch, path); },
  };
}

/**
 * While the macOS app has no developer signature, the keychain hands an entry back only to the exact build that saved it and asks the person about any other build.
 * This stamp changes with every build, so a sign-in saved by another build is recognised without reading it. Remove it once releases are signed with a stable identity.
 */
function keychainBuild(platform: NodeJS.Platform): string | undefined {
  if (platform !== 'darwin') return undefined;
  try { const file = statSync(process.execPath); return createHash('sha256').update(`${process.execPath}\n${file.size}\n${file.mtimeMs}`).digest('hex').slice(0, 16); } catch { return undefined; }
}

export class ModelSettingsStore {
  readonly trial: TrialConnectionStore;
  readonly lab:LabConnectionStore;
  private readonly credentials?: Credentials;
  private readonly account: string;
  private readonly platform: NodeJS.Platform;
  constructor(credentials?: Credentials, account = 'default', platform: NodeJS.Platform = process.platform, trialOptions?: {origin:string;fetcher?:typeof fetch;preferences?:TrialPreferences;build?:string}) {
    this.credentials = credentials; this.account = account; this.platform = platform;
    this.lab=new LabConnectionStore({get:id=>this.withKeychain(c=>c.getPassword('Factoryze Lab Sessions',account+':'+id)),
      set:(id,value)=>this.withKeychain(c=>c.setPassword('Factoryze Lab Sessions',account+':'+id,value)),delete:id=>this.withKeychain(async c=>{await c.deletePassword('Factoryze Lab Sessions',account+':'+id);})},
      {directory:join(factoryzeDataDir(),'lab-client',createHash('sha256').update(account).digest('hex').slice(0,16))});
    const trialAccount = account + ':trial';
    this.trial = new TrialConnectionStore({
      // Injected credentials mean a test or a tool: unless it supplies preferences, they stay in memory and the real profile is never read.
      preferences: trialOptions?.preferences ?? (credentials ? memoryTrialPreferences()
        : fileTrialPreferences(join(factoryzeDataDir(), 'trial-connection', createHash('sha256').update(account).digest('hex').slice(0, 16) + '.json'))),
      secret: {
        read: () => this.withKeychain(c => c.getPassword(trialService, trialAccount)),
        // The entry is recreated, never updated: an entry left by another build would keep that build as its owner and bring the macOS dialog back.
        write: value => this.withKeychain(async c => { await c.deletePassword(trialService, trialAccount); await c.setPassword(trialService, trialAccount, value); }),
        delete: () => this.withKeychain(async c => { await c.deletePassword(trialService, trialAccount); }),
      },
      build: trialOptions?.build ?? keychainBuild(platform),
    }, trialOptions?.origin, trialOptions?.fetcher);
  }

  private async keychain(): Promise<Credentials> {
    return this.credentials ?? await import('keytar');
  }

  private async withKeychain<T>(operation: (credentials: Credentials) => Promise<T>): Promise<T> {
    try { return await operation(await this.keychain()); }
    catch {
      const remedy = this.platform === 'linux'
        ? 'Unlock a Secret Service keyring in this desktop session (GNOME Keyring or KWallet with its Secret Service bridge), then retry.'
        : this.platform === 'win32' ? 'Check that Windows Credential Manager is available in your signed-in desktop session, then retry.'
          : 'Unlock your macOS Keychain and allow Factoryze access, then retry.';
      throw new Error(`Factoryze cannot access the system credential store. ${remedy} Alternatively, launch with FACTORYZE_PROVIDER_URL, FACTORYZE_MODEL and FACTORYZE_PROVIDER_API_KEY set in the backend environment.`);
    }
  }

  private async stored(): Promise<ModelSettingsInput | undefined> {
    const raw = await this.withKeychain(credentials => credentials.getPassword(service, this.account));
    if (!raw) return undefined;
    const saved = JSON.parse(raw);
    return modelSettingsInputSchema.parse({ ...saved, agent: 'factoryze', api: providerApi(saved.baseURL, saved.api), baseURL: providerBaseURL(saved.baseURL) });
  }

  async load(env: NodeJS.ProcessEnv = process.env): Promise<ModelSettingsView | null> {
    if(!env.FACTORYZE_PROVIDER_URL && await this.trial.selected())return this.trial.settings();
    return this.loadByok(env);
  }
  async loadByok(env: NodeJS.ProcessEnv = process.env): Promise<ModelSettingsView | null> {
    if (env.FACTORYZE_PROVIDER_URL) {
      const settings = soloSettings(env);
      return { schema: 1, agent: settings.agent, api: settings.provider.api, baseURL: settings.provider.baseURL, model: settings.model,
        contextWindow: settings.contextWindow, maxOutputTokens: settings.maxOutputTokens, budgetTokens: settings.budget.limit,
        ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
        modules: settings.modules, judgeModel: settings.judgeModel, hasKey: true, source: 'environment' };
    }
    const saved = await this.stored();
    if (!saved) return null;
    const { apiKey, ...settings } = saved;
    return { ...settings, hasKey: settings.authentication !== 'opencode-public' && Boolean(apiKey) };
  }

  async save(input: ModelSettingsInput): Promise<ModelSettingsView> {
    if(input.authentication==='trial') {
      if(input.apiKey?.trim()||input.modules?.judge||input.modules?.scoring)throw new Error('Trial connections do not accept provider keys or background feedback calls.');
      return this.trial.preferences(input.budgetTokens);
    }
    const { apiKey, ...settings } = modelSettingsInputSchema.parse({ ...input, agent: 'factoryze', api: providerApi(input.baseURL, input.api), baseURL: providerBaseURL(input.baseURL) });
    const valid = modelSettingsSchema.parse(settings);
    const publicModel = valid.authentication === 'opencode-public';
    if (publicModel) throw new Error(factoryzePublicModelMessage);
    const key = publicModel ? '' : apiKey?.trim() || (await this.stored())?.apiKey;
    if (!publicModel && !key) throw new Error('Enter an API key before saving model settings');
    await this.withKeychain(credentials => credentials.setPassword(service, this.account, JSON.stringify({ ...valid, apiKey: key })));
    await this.trial.useByok();
    return { ...valid, hasKey: !publicModel };
  }

  async clear(): Promise<void> {
    await this.withKeychain(credentials => credentials.deletePassword(service, this.account));
  }

  async forEngine(env: NodeJS.ProcessEnv = process.env): Promise<SoloSettings | undefined> {
    if (env.FACTORYZE_PROVIDER_URL) return soloSettings(env);
    if(await this.trial.selected())return this.trial.forEngine();
    const saved = await this.stored();
    if (!saved || (!saved.apiKey && saved.authentication !== 'opencode-public')) return undefined;
    const { apiKey, ...settings } = saved;
    return {
      ...(settings.agent ? { agent: settings.agent } : {}),
      provider: { baseURL: settings.baseURL, apiKey: apiKey ?? '', api: settings.api, ...(settings.authentication ? { authentication: settings.authentication } : {}) },
      model: settings.model, contextWindow: settings.contextWindow, maxOutputTokens: settings.maxOutputTokens,
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      budget: { limit: settings.budgetTokens ?? 100_000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } },
      ...(settings.modules ? { modules: settings.modules } : {}), ...(settings.judgeModel ? { judgeModel: settings.judgeModel } : {}),
    };
  }
}
