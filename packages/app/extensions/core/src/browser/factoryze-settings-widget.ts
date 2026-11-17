import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import type { ModelSettingsView, TrialAccountView } from '@factoryze/protocol';
import { isModelConfigured } from '@factoryze/protocol';
import type { TaskService } from '../common/task-service';
import { button, el, errorText } from './dom';
import { connectModelDialog, connectOwnKeyDialog } from './dialogs';
import { trialConnectionDialog } from './trial-dialog';
import { tokens } from './flow-model';
import type { AppearanceController } from './appearance-controller';
import type { Appearance } from './appearance';

/** App-level settings. Attempt budgets are chosen when an attempt starts, not here. */
export class FactoryzeSettingsWidget extends BaseWidget {
  static readonly ID = 'factoryze-settings';
  private readonly content = el('div', { class: 'fz-page-inner fz-settings' });
  private trial?: TrialAccountView;
  private settings: ModelSettingsView | null = null;
  constructor(private readonly service: TaskService, private readonly back: () => void, private readonly appearance?: AppearanceController) {
    super();
    this.id = FactoryzeSettingsWidget.ID;
    this.title.label = 'Settings';
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-settings-gear';
    this.addClass('fz-page');
    this.node.tabIndex = 0;
    this.node.append(this.content);
  }
  protected override onActivateRequest(): void { this.node.focus(); void this.refresh(); }

  connect(): void { connectModelDialog(this.service, this.settings, view => { this.settings = view; this.render(); }); }
  connectTrial(): void { trialConnectionDialog(this.service,
    () => connectOwnKeyDialog(this.service, view => { this.settings = view; this.render(); }),
    view => { this.settings = view; this.render(); }); }

  async refresh(): Promise<void> {
    try { this.settings = await this.service.settings(); this.trial=this.settings?.authentication==='trial'?await this.service.trialAccount().catch(()=>undefined):undefined; this.render(); }
    catch (error) { this.content.replaceChildren(el('h1', { text: 'Settings' }), el('p', { class: 'fz-error', role: 'alert', text: errorText(error) })); }
  }

  private appearanceSection(status: HTMLElement): HTMLElement {
    const appearance = this.appearance!;
    const group = el('div', { class: 'fz-segmented', role: 'radiogroup', aria: { label: 'Appearance' } });
    for (const [mode, label] of [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']] as [Appearance, string][]) {
      const option = el('button', { type: 'button', role: 'radio', text: label, aria: { checked: String(appearance.mode === mode) } });
      option.addEventListener('click', () => void appearance.set(mode).then(() => {
        for (const other of Array.from(group.children)) other.setAttribute('aria-checked', String(other === option));
        status.textContent = mode === 'system' ? 'Factoryze follows your system appearance.' : `${label} appearance is on.`;
      }).catch(error => { status.textContent = errorText(error); }));
      group.append(option);
    }
    return el('section', {}, el('h2', { text: 'Appearance' }), el('div', { class: 'fz-card' },
      el('div', {}, el('h3', { text: 'Theme' }), el('p', { text: 'Applies to the whole window: Home, the editor, the terminal and the agent.' })), group));
  }

  private render(): void {
    const settings = this.settings, connected = isModelConfigured(settings), managed = settings?.source === 'environment', trial=settings?.authentication==='trial';
    const status = el('p', { class: 'fz-status', role: 'status' });
    const save = async (patch: Partial<ModelSettingsView>, message: string): Promise<void> => {
      if (!settings) return;
      try {
        const { hasKey: _hasKey, source: _source, ...current } = settings;
        this.settings = await this.service.saveSettings({ ...current, ...patch, apiKey: '' });
        window.dispatchEvent(new Event('factoryze-settings-changed'));
        status.textContent = message;
      } catch (error) { status.textContent = errorText(error); }
    };
    const toggle = (label: string, checked: boolean, change: (value: boolean) => void): HTMLLabelElement => {
      const input = el('input', { type: 'checkbox', aria: { label } }); input.checked = checked; input.disabled = !connected || managed || trial;
      input.addEventListener('change', () => change(input.checked));
      return el('label', { class: 'fz-switch' }, input, el('span'));
    };
    const judgeModel = el('input', { class: 'fz-input' }); judgeModel.value = settings?.judgeModel ?? ''; judgeModel.placeholder = 'Same as the agent\'s model';
    judgeModel.disabled = !connected || managed || trial;
    judgeModel.addEventListener('change', () => void save({ judgeModel: judgeModel.value.trim() || undefined }, 'Feedback model saved.'));
    const budget = el('input', { class: 'fz-input fz-narrow', type: 'number' }); budget.min = '1000'; budget.step = '1000';
    budget.value = String(settings?.budgetTokens ?? 100000); budget.disabled = !connected || managed;
    budget.addEventListener('change', () => { const value = Number(budget.value); if (Number.isSafeInteger(value) && value > 0) void save({ budgetTokens: value }, `Default budget set to ${tokens(value)} tokens.`); });

    const model = trial && settings
      ? el('div',{class:'fz-card'},el('div',{class:'fz-row-between'},el('div',{},el('h3',{text:'Factoryze trial credits'}),el('p',{text:settings.hasKey?`Using ${settings.model}. Your provider key is not used.`:'Review your sign-in, invitation, balance and model selection.'})),el('span',{class:`fz-dot${settings.hasKey?'':' fz-off'}`})),
        ...(this.trial?.account?[el('dl',{class:'fz-kv'},el('dt',{text:'Account'}),el('dd',{text:this.trial.account.email}),el('dt',{text:'Available credit'}),el('dd',{text:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(this.trial.account.availableMicro/1000000)}))]:[]),
        el('div',{class:'fz-actions'},button('Manage trial account',()=>this.connect(),{small:true}),button('Use my API key',()=>{connectOwnKeyDialog(this.service,updated=>{this.settings=updated;this.render();});},{small:true,kind:'quiet'})))
      : connected && settings
      ? el('div', { class: 'fz-card' },
        el('div', { class: 'fz-row-between' }, el('div', {}, el('h3', { text: settings.model }),
          el('p', { text: `${settings.api === 'anthropic-messages' ? 'Anthropic Messages API' : 'OpenAI-compatible API'}. ${managed ? 'Set by environment variables for this session.' : 'Your key is stored in your system keychain and never leaves Factoryze\'s backend.'}` })),
          el('span', { class: 'fz-dot', title: 'Connected' })),
        el('dl', { class: 'fz-kv' }, el('dt', { text: 'Base URL' }), el('dd', { text: settings.baseURL }), el('dt', { text: 'Model ID' }), el('dd', { text: settings.model }),
          el('dt', { text: 'Context window' }), el('dd', { text: `${tokens(settings.contextWindow)} tokens` }),
          el('dt', { text: 'Temperature' }), el('dd', { text: settings.temperature === undefined ? 'Provider default' : String(settings.temperature) })),
        managed ? el('p', { class: 'fz-help', text: 'Restart Factoryze without FACTORYZE_PROVIDER_URL to change the connection here.' })
          : el('div', { class: 'fz-actions' }, button('Change', () => this.connect(), { small: true }),
            button('Forget connection', async () => {
              try { await this.service.clearSettings(); this.settings = null; window.dispatchEvent(new Event('factoryze-settings-changed')); this.render(); }
              catch (error) { status.textContent = errorText(error); }
            }, { kind: 'quiet', small: true })))
      : el('div', { class: 'fz-card' }, el('div', { class: 'fz-row-between' }, el('div', {}, el('h3', { text: 'No model connected' }),
        el('p', { text: 'The agent needs a model. Editing, tests and submitting work without one.' })), el('span', { class: 'fz-dot fz-off' })),
        el('div', {}, button('Connect a model', () => this.connect(), { kind: 'primary', small: true })));

    const connectionSection = el('section', { class: 'fz-settings-section' },
      el('div', { class: 'fz-settings-section-head' }, el('h2', { text: 'Model connection' }),
        el('p', { text: 'Choose how the agent connects while you work.' })), model);
    const practiceSection = el('section', { class: 'fz-settings-section' },
      el('div', { class: 'fz-settings-section-head' }, el('h2', { text: 'Practice preferences' }),
        el('p', { text: 'Defaults for new solo attempts.' })),
        trial?el('p',{class:'fz-help',text:'Background prompt feedback and scoring are off for sponsored requests. Your saved BYOK preferences are retained.'}):null,
        connected ? null : el('p', { class: 'fz-help', text: 'Connect a model to change these.' }),
        el('div', { class: 'fz-card' }, el('div', { class: 'fz-row-between' }, el('div', {}, el('h3', { text: 'Prompt feedback' }),
          el('p', { text: 'A second model call rates each prompt for how specific it is, with a short reason. It uses your provider and costs tokens, but those tokens don\'t count against the task budget.' })),
          toggle('Prompt feedback', settings?.modules?.judge ?? false, value => void save({ modules: { judge: value, scoring: settings?.modules?.scoring ?? false } }, value ? 'Prompt feedback is on for new prompts.' : 'Prompt feedback is off.'))),
          el('label', { class: 'fz-field' }, el('span', { text: 'Feedback model' }), judgeModel, el('small', { text: 'A smaller, cheaper model from the same provider works well.' }))),
        el('div', { class: 'fz-card' }, el('div', { class: 'fz-row-between' }, el('div', {}, el('h3', { text: 'Score in results' }),
          el('p', { text: 'Combines hidden checks, eligible token efficiency and prompt feedback into a score saved with submissions and shown in Home results. The report view shows correctness and usage without prompt scores.' })),
          toggle('Score in results', settings?.modules?.scoring ?? false, value => void save({ modules: { judge: settings?.modules?.judge ?? false, scoring: value } }, value ? 'New results include a score.' : 'New results don\'t include a score.')))),
        el('div', { class: 'fz-card' }, el('h3', { text: 'Default token budget' }),
          el('p', { text: 'Used when a task doesn\'t set its own. You can change it for a task when you start an attempt.' }),
          el('label', { class: 'fz-field' }, el('span', { text: 'Tokens per attempt' }), budget)));
    const dataSection = el('section', { class: 'fz-settings-section' }, el('h2', { text: 'Data on this computer' }),
      el('div', { class: 'fz-card' }, el('p', { text: 'Attempts, token usage and reports are stored on this computer. Model requests go to your selected provider or through Factoryze’s trial gateway. Local task files and reports are not uploaded as a separate submission.' })));
    this.content.replaceChildren(
      button('Back', () => this.back(), { kind: 'quiet', small: true, icon: 'chevron-left' }),
      el('header', { class: 'fz-settings-header' },
        el('div', {}, el('span', { class: 'fz-settings-eyebrow', text: 'PERSONALIZE YOUR WORKSPACE' }),
          el('h1', { text: 'Settings' }),
          el('p', { text: 'Manage your model, practice defaults, and appearance in one place.' })),
        el('span', { class: `fz-settings-state${connected ? ' fz-ready' : ''}`, text: connected
          ? `${settings?.model} ready` : trial ? 'Trial sign-in needed' : 'Model setup needed' })),
      el('div', { class: 'fz-settings-layout' },
        el('div', { class: 'fz-settings-primary' }, connectionSection, practiceSection),
        el('aside', { class: 'fz-settings-aside', aria: { label: 'Appearance and data' } },
          ...(this.appearance ? [this.appearanceSection(status)] : []), dataSection)),
      status);
  }
}
