import { modelSettingsInputSchema, modelSettingsSchema, providerApi, providerBaseURL, factoryzePublicModelMessage, type ModelSettingsInput, type ModelSettingsView } from '@factoryze/protocol';
import { soloSettings, type SoloSettings } from '@factoryze/engine/solo';
import { TrialConnectionStore } from '#trial-connection';
import { LabConnectionStore } from '#lab-connection';
import { factoryzeDataDir } from '@factoryze/engine/data-dir';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

type Credentials = Pick<typeof import('keytar'), 'getPassword' | 'setPassword' | 'deletePassword'>;
const service = 'Factoryze Solo Provider';

export class ModelSettingsStore {
  readonly trial: TrialConnectionStore;
  readonly lab:LabConnectionStore;
  private readonly credentials?: Credentials;
  private readonly account: string;
  private readonly platform: NodeJS.Platform;
  constructor(credentials?: Credentials, account = 'default', platform: NodeJS.Platform = process.platform, trialOptions?: {origin:string;fetcher?:typeof fetch}) {
    this.credentials = credentials; this.account = account; this.platform = platform;
    this.lab=new LabConnectionStore({get:id=>this.withKeychain(c=>c.getPassword('Factoryze Lab Sessions',account+':'+id)),
      set:(id,value)=>this.withKeychain(c=>c.setPassword('Factoryze Lab Sessions',account+':'+id,value)),delete:id=>this.withKeychain(async c=>{await c.deletePassword('Factoryze Lab Sessions',account+':'+id);})},
      {directory:join(factoryzeDataDir(),'lab-client',createHash('sha256').update(account).digest('hex').slice(0,16))});
    this.trial = new TrialConnectionStore({ read:()=>this.withKeychain(c=>c.getPassword('Factoryze Trial Account',account+':trial')),
      write:value=>this.withKeychain(c=>c.setPassword('Factoryze Trial Account',account+':trial',value)) },trialOptions?.origin,trialOptions?.fetcher);
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
