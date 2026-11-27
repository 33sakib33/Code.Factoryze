import type { AttemptSummary, ModelSettingsInput, ModelSettingsView, PracticeWorkspace, UsageIssue, Reconciliation } from '@factoryze/protocol';
import { providerApi, providerBaseURL, temperatureSchema } from '@factoryze/protocol';
import type { PracticeTask, TaskService } from '../common/task-service';
import { button, el, errorText, icon, modal } from './dom';
import { tokens } from './flow-model';
import { connectionTabs, trialConnectionDialog } from './trial-dialog';
import { startSheetModel } from './first-run';

const field = (label: string, control: HTMLElement, help?: string): HTMLLabelElement => {
  if (label && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
  return el('label', { class: 'fz-field' }, el('span', { text: label }), control, help ? el('small', { text: help }) : null);
};
const input = (value: string, type = 'text'): HTMLInputElement => { const node = el('input', { class: 'fz-input', type }); node.value = value; return node; };
type Step = { node: HTMLLIElement; set(state: 'todo' | 'doing' | 'done' | 'failed', label?: string): void };
function steps(labels: string[]): { list: HTMLOListElement; items: Step[] } {
  const list = el('ol', { class: 'fz-steps', aria: { live: 'polite' } });
  const items = labels.map(label => {
    const text = el('span', { text: label }), node = el('li', { class: 'fz-todo' }, el('span', { class: 'fz-mark' }), text);
    list.append(node);
    return { node, set(state: 'todo' | 'doing' | 'done' | 'failed', next?: string) {
      node.className = `fz-${state}`; if (next) text.textContent = next;
      node.firstElementChild!.replaceChildren(state === 'done' ? icon('check') : state === 'failed' ? icon('close') : '');
    } };
  });
  return { list, items };
}

/** Start sheet: brief, Python check, the attempt's budget, then real setup steps. */
export function startAttemptDialog(task: PracticeTask, options: {
  service: TaskService; inProgress?: AttemptSummary; budget: number; judge: boolean; connection?: ModelSettingsView|null;
  openSettings(): void; open(workspace: PracticeWorkspace): Promise<void>;
}): void {
  const { service } = options;
  const m = modal(task.title);
  const python = el('dd', {}, el('span', { class: 'fz-check', text: 'Checking…' }));
  const budgetInput = input(String(options.budget), 'number'); budgetInput.min = '1000'; budgetInput.step = '1000';
  budgetInput.setAttribute('aria-label', 'Token limit for each attempt of this task');
  const budgetEdit = field('', budgetInput, 'Applies to every attempt of this task. Your report shows the limit you chose.'); budgetEdit.hidden = true;
  const budgetView = el('span', {}, `Each attempt can use up to ${tokens(options.budget)} tokens. `,
    button('Change', () => { budgetView.hidden = true; budgetEdit.hidden = false; budgetInput.focus(); }, { kind: 'link' }));
  const facts = el('dl', { class: 'fz-facts' },
    el('dt', { text: 'Time' }), el('dd', { text: `About ${task.timeHintMinutes ?? 30} minutes. There's no time limit in practice.` }),
    el('dt', { text: 'Python' }), python,
    el('dt', { text: 'Token budget' }), el('dd', {}, budgetView, budgetEdit),
    el('dt', { text: 'Prompt feedback' }), el('dd', {}, options.judge ? 'On. Each prompt gets a specificity rating in your report. ' : 'Off. ',
      button('Change in Settings', () => { m.close(); options.openSettings(); }, { kind: 'link' })));
  if (task.recommendedKnowledge?.length) facts.append(el('dt', { text: 'Helpful background' }),
    el('dd', { text: task.recommendedKnowledge.join(' · ') }));
  if(options.connection?.authentication==='trial')facts.append(el('dt',{text:'Model connection'}),el('dd',{text:`Trial credits · ${options.connection.model}. Credit is shared across attempts; this token limit applies to this attempt.`}));
  const details = el('div', { class: 'fz-dialog-section' }, el('p', { class: 'fz-lead', text: task.brief }), facts,
    options.inProgress ? el('p', { class: 'fz-callout' }, el('strong', { text: `Attempt ${options.inProgress.attempt} is still in progress.` }),
      ' Starting a new attempt keeps it, and you can continue it from Home.') : null,
    el('p', { class: 'fz-help', text: 'Each attempt starts from a fresh copy of the starter code.' }));
  const start = button('Start attempt', () => void begin(), { kind: 'primary' }); start.disabled = true;
  // No model yet: say so and offer both ways to connect here, so the student never leaves the task they chose.
  if (!startSheetModel(options.connection).connected) {
    const model = el('dd', { text: startSheetModel(options.connection).text });
    facts.prepend(el('dt', { text: 'Model' }), model);
    const choices = el('div', { class: 'fz-connect-choices', role: 'group', aria: { label: 'Connect a model' } });
    const note = el('p', { class: 'fz-help', text: 'You can also start without a model. Editing, tests and submitting work without the agent.' });
    const connected = (view: ModelSettingsView): void => {
      const next = startSheetModel(view);
      if (!next.connected) return;
      model.textContent = next.text; choices.remove(); note.remove();
      start.classList.add('fz-primary'); start.focus();
    };
    const choice = (title: string, text: string, open: () => void): HTMLButtonElement =>
      el('button', { type: 'button', class: 'fz-connect-choice', aria: { label: title }, on: { click: open } }, el('strong', { text: title }), el('small', { text }));
    const ownKey = (): void => connectOwnKeyDialog(service, connected);
    choices.append(
      choice('Sign in for trial credits', 'Use your email. Credit is attached to your address; no API key or code is needed.', () => trialConnectionDialog(service, ownKey, connected)),
      choice('Use my own key', 'OpenAI, Anthropic, OpenRouter, or a model on this computer.', ownKey));
    details.append(choices, note);
    start.classList.remove('fz-primary');
  }
  let pythonReady = false, accountReady = !task.hosted;
  const updateStart = () => { start.disabled = !pythonReady || !accountReady; };
  const signIn = () => { m.close(); options.openSettings(); };
  const access = el('div', { class: 'fz-hosted-access', role: 'status' });
  if (task.hosted) details.append(access);
  m.body.append(details);
  m.foot.append(button('Cancel', () => m.close()), start);

  const checkAccess = async (): Promise<void> => {
    if (!task.hosted) return;
    accountReady = false; updateStart();
    access.replaceChildren(el('p', { text: 'Checking your Factoryze sign-in…' }));
    try {
      const account = await service.trialAccount();
      accountReady = account.signedIn;
      access.replaceChildren(accountReady
        ? el('p', { text: 'Signed in. This task will be downloaded when you start.' })
        : el('p', { text: 'Sign in to download this hosted task.' }),
      ...(accountReady ? [] : [button('Sign in', signIn, { kind: 'primary' })]));
    } catch (error) {
      access.replaceChildren(el('p', { class: 'fz-error', text: `Could not check sign-in: ${errorText(error)}` }),
        button('Try again', () => void checkAccess()));
    }
    updateStart();
  };

  let found: string | undefined;
  const check = async (): Promise<void> => {
    python.replaceChildren(el('span', { class: 'fz-check', text: 'Checking…' })); pythonReady = false; updateStart();
    try {
      const result = await service.checkPython(task.id);
      found = result.version;
      if (result.ok) {
        python.replaceChildren(el('span', { class: 'fz-check fz-ok' }, icon('check'), `Python ${result.version} found`));
        pythonReady = true; updateStart();
      } else {
        python.replaceChildren(el('span', { class: 'fz-check fz-bad' }, icon('close'), result.message && result.version ? `Python ${result.version} needs setup` : `Python ${result.minimum} or newer not found${result.version ? ` (found ${result.version})` : ''}`),
          el('span', { class: 'fz-help', text: result.message ?? 'Install it from python.org, then check again. You don\'t need to restart Factoryze.' }),
          button('Check again', () => void check(), { small: true }));
      }
    } catch (error) { python.replaceChildren(el('span', { class: 'fz-check fz-bad', text: errorText(error) }), button('Check again', () => void check(), { small: true })); }
  };
  void check(); void checkAccess();

  async function begin(): Promise<void> {
    const limit = Number(budgetInput.value);
    if (!budgetEdit.hidden && (!Number.isSafeInteger(limit) || limit < 1)) { budgetInput.focus(); return; }
    const progress = steps([`Python ${found ?? ''} ready`.replace('  ', ' '), 'Copying the task files and creating the Python environment', 'Opening the editor']);
    progress.items[0]!.set('done');
    m.body.replaceChildren(progress.list);
    m.foot.replaceChildren();
    m.dialog.querySelector('.fz-dialog-head .fz-icon-btn')?.remove();
    m.dialog.addEventListener('cancel', event => event.preventDefault());
    try {
      progress.items[1]!.set('doing');
      const attempt = await service.start(task.id);
      if (!budgetEdit.hidden && limit !== options.budget) await service.setTaskBudget(attempt.workspace, limit);
      progress.items[1]!.set('done');
      progress.items[2]!.set('doing');
      await options.open(attempt);
    } catch (error) {
      progress.items.find(item => item.node.className === 'fz-doing')?.set('failed');
      const message = errorText(error);
      m.body.append(el('p', { class: 'fz-error', role: 'alert', text: message }));
      m.foot.replaceChildren(...(task.hosted && message === 'Your trial sign-in expired. Sign in again.'
        ? [button('Sign in again', signIn, { kind: 'primary' })] : []), button('Close', () => m.close()));
    }
  }
}

const providers = [
  { id: 'openai', label: 'OpenAI', help: 'Uses api.openai.com', url: 'https://api.openai.com/v1', api: 'openai-chat', model: '' },
  { id: 'anthropic', label: 'Anthropic', help: 'Uses api.anthropic.com', url: 'https://api.anthropic.com/v1', api: 'anthropic-messages', model: '' },
  { id: 'openrouter', label: 'OpenRouter', help: 'One key for many models, including free ones', url: 'https://openrouter.ai/api/v1', api: 'openai-chat', model: '' },
  { id: 'compatible', label: 'Another OpenAI-compatible service', help: 'For example MiniMax, DeepSeek or Groq', url: '', api: 'openai-chat', model: '' },
  { id: 'local', label: 'A model on this computer', help: 'Ollama, LM Studio or another local server', url: 'http://localhost:11434/v1', api: 'openai-chat', model: '' },
] as const;
const providerFor = (url: string): (typeof providers)[number]['id'] =>
  providers.find(item => item.url && url.startsWith(item.url))?.id ?? (/localhost|127\.0\.0\.1/.test(url) ? 'local' : 'compatible');

/** Model connection. The key goes straight to the backend keychain and never comes back to this page. */
export function connectModelDialog(service: TaskService, current: ModelSettingsView | null, saved: (view: ModelSettingsView) => void): void {
  const ownKey=()=>connectOwnKeyDialog(service,saved);
  if(current?.authentication==='trial'){trialConnectionDialog(service,ownKey,saved);return;}
  connectByokDialog(service,current,saved);
}
export function connectOwnKeyDialog(service:TaskService,saved:(view:ModelSettingsView)=>void):void {
  void service.byokSettings().then(view=>connectByokDialog(service,view,saved)).catch(error=>{const m=modal('Model connection');m.body.append(el('p',{class:'fz-error',role:'alert',text:errorText(error)}));m.foot.append(button('Close',()=>m.close()));});
}
function connectByokDialog(service: TaskService, current: ModelSettingsView | null, saved: (view: ModelSettingsView) => void): void {
  const m = modal('Connect a model', { wide: true });
  m.body.append(connectionTabs('byok',()=>{m.close();trialConnectionDialog(service,()=>connectOwnKeyDialog(service,saved),saved);}));
  const url = input(current?.baseURL ?? ''), model = input(current?.model ?? ''), key = input('', 'password');
  key.autocomplete = 'off'; key.placeholder = current?.hasKey ? 'Leave blank to keep the saved key' : 'Paste your API key';
  const context = input(String(current?.contextWindow ?? 128000), 'number'), output = input(String(current?.maxOutputTokens ?? 4096), 'number');
  const temperature = input(current?.temperature === undefined ? '' : String(current.temperature), 'number');
  temperature.min = '0'; temperature.max = '2'; temperature.step = 'any'; temperature.placeholder = 'Provider default';
  const status = el('p', { class: 'fz-error', role: 'alert' });
  let selected: string = current ? providerFor(current.baseURL) : 'openai';
  const choices = el('fieldset', { class: 'fz-providers' }, el('legend', { text: 'Where is your model?' }));
  for (const provider of providers) {
    const radio = el('input', { type: 'radio' }); radio.name = 'fz-provider'; radio.value = provider.id; radio.checked = provider.id === selected;
    radio.addEventListener('change', () => {
      selected = provider.id; url.value = provider.url || (providerFor(url.value) === 'compatible' ? url.value : '');
      key.placeholder = provider.id === 'local' ? 'Any text if your server doesn\'t check keys' : current?.hasKey ? 'Leave blank to keep the saved key' : 'Paste your API key';
      url.focus();
    });
    choices.append(el('label', { class: 'fz-provider' }, radio, el('span', { text: provider.label }), el('small', { text: provider.help })));
  }
  if (!current) url.value = providers[0].url;
  const limits = el('details', { class: 'fz-details' }, el('summary', { text: 'Model limits and sampling' }),
    el('div', { class: 'fz-grid2' }, field('Context window, in tokens', context), field('Longest reply, in tokens', output)),
    field('Temperature', temperature, 'Optional, from 0 to 2. Leave blank for the provider default. Lower values usually vary less; some models restrict this setting. Applies to new agent sessions.'));
  m.body.append(el('p', { class: 'fz-lead', text: 'The agent\'s requests go through Factoryze, which counts tokens against each attempt\'s budget. Your key is stored in your system keychain.' }),
    choices, field('Base URL', url), field('API key', key, 'Stored in your system keychain.'), field('Model ID', model, 'Exactly as your provider lists it.'), limits, status);
  const save = button('Save connection', () => void submit(), { kind: 'primary' });
  m.foot.append(button('Cancel', () => m.close()), save);
  async function submit(): Promise<void> {
    status.textContent = '';
    if (!url.value.trim() || !model.value.trim()) { status.textContent = 'Enter the base URL and the model ID.'; return; }
    const sampling = temperature.value.trim() === '' ? undefined : Number(temperature.value);
    if (temperature.validity.badInput || (sampling !== undefined && !temperatureSchema.safeParse(sampling).success)) {
      status.textContent = 'Enter a temperature from 0 to 2, or leave it blank for the provider default.'; temperature.focus(); return;
    }
    const baseURL = providerBaseURL(url.value.trim());
    const api = providerApi(baseURL, (providers.find(item => item.id === selected)?.api ?? 'openai-chat') as ModelSettingsInput['api']);
    save.disabled = true;
    try {
      const view = await service.saveSettings({ schema: 1, agent: 'factoryze', api, baseURL, model: model.value.trim(),
        contextWindow: Number(context.value), maxOutputTokens: Number(output.value), apiKey: key.value,
        ...(sampling === undefined ? {} : { temperature: sampling }),
        ...(current?.modules ? { modules: current.modules } : {}), ...(current?.judgeModel ? { judgeModel: current.judgeModel } : {}),
        ...(current?.budgetTokens ? { budgetTokens: current.budgetTokens } : {}) });
      window.dispatchEvent(new Event('factoryze-settings-changed'));
      window.dispatchEvent(new Event('factoryze-connection-changed'));
      saved(view); m.close();
    } catch (error) { status.textContent = errorText(error); save.disabled = false; }
  }
  if (current) model.focus(); else url.focus();
}

/** Submit confirmation, then the hidden checks run while the dialog shows progress. */
export function submitDialog(run: (options: { includeSolution: boolean }) => Promise<void>, lab = false,
  hosted?: { signedIn: boolean; sentSubmission?: number } | null): void {
  const m = modal('Submit this attempt?');
  m.body.append(el('p', { text: lab ? 'Save a fixed copy of your synchronized files and usage on the lab server. Your instructor releases the report after isolated grading. You can keep working while the lab is open.' : 'Factoryze runs the task\'s hidden checks on your code and saves a report. You can keep working afterwards and submit again. Every submission is kept.' }));
  // Off by default every time; nothing about the solution is remembered between submissions.
  const solution = el('input', { type: 'checkbox' });
  const sending = !lab && hosted?.signedIn && hosted.sentSubmission === undefined;
  if (!lab && hosted) m.body.append(el('p', { class: 'fz-help', text: hosted.sentSubmission !== undefined
    ? `This attempt's leaderboard result was already sent with submission ${hosted.sentSubmission}. This submission is graded locally only.`
    : hosted.signedIn
      ? 'This is a hosted task, so the result is sent to the leaderboard: checks passed, tokens used, the model and this attempt\'s ID. Only the first sent submission of an attempt counts.'
      : 'This is a hosted task. Sign in before submitting if you want the result on the leaderboard.' }));
  if (sending) m.body.append(el('label', { class: 'fz-confirm' }, solution,
    el('span', {}, 'Include my changed files. ', el('span', { class: 'fz-help', text: 'Kept private for reviewing problems; never shown on any page.' }))));
  const go = button('Submit', () => void confirm(), { kind: 'primary' });
  m.foot.append(button('Cancel', () => m.close()), go);
  go.focus();
  async function confirm(): Promise<void> {
    const progress = steps(lab ? ['Synchronizing files', 'Saving the submission'] : ['Running hidden checks', 'Saving the report']);
    progress.items[0]!.set('doing');
    m.body.replaceChildren(progress.list); m.foot.replaceChildren();
    m.dialog.querySelector('.fz-dialog-head .fz-icon-btn')?.remove();
    m.dialog.addEventListener('cancel', event => event.preventDefault());
    try { await run({ includeSolution: Boolean(sending && solution.checked) }); m.close(); }
    catch (error) {
      progress.items[0]!.set('failed');
      m.body.append(el('p', { class: 'fz-error', role: 'alert', text: errorText(error) }));
      m.foot.replaceChildren(button('Close', () => m.close(), { kind: 'primary' }));
    }
  }
}

/** Practice-only: raise this task's limit after the agent pauses. */
export function raiseBudgetDialog(limit: number, apply: (next: number) => Promise<void>): void {
  const m = modal('Raise the token budget');
  const next = input(String(limit + 10000), 'number'); next.min = String(limit + 1); next.step = '1000';
  const status = el('p', { class: 'fz-error', role: 'alert' });
  m.body.append(el('p', { text: `This attempt has used its ${tokens(limit)} tokens. In practice you can raise the limit and keep going. Your report will show that you raised it.` }),
    field('New budget, in tokens', next), status);
  const go = button('Raise budget', async () => {
    const value = Number(next.value);
    if (!Number.isSafeInteger(value) || value <= limit) { status.textContent = `Enter more than ${tokens(limit)} tokens.`; return; }
    go.disabled = true;
    try { await apply(value); m.close(); } catch (error) { status.textContent = errorText(error); go.disabled = false; }
  }, { kind: 'primary' });
  m.foot.append(button('Cancel', () => m.close()), go);
  next.focus(); next.select();
}

/** Guided reconciliation for a response that ended before the provider reported its usage. */
export function fixTokenCountDialog(issues: UsageIssue[], reconcile: (input: Reconciliation) => Promise<void>, done: () => void): void {
  const issue = issues[0];
  if (!issue) return;
  const m = modal('Fix the token count', { wide: true });
  const observed = issue.observed ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const counts = (['input', 'output', 'cacheRead'] as const).map(name => { const node = input(String(observed[name]), 'number'); node.min = String(observed[name]); return [name, node] as const; });
  const reference = input(''); reference.placeholder = 'For example the request ID';
  const confirmed = el('input', { type: 'checkbox' });
  const status = el('p', { class: 'fz-error', role: 'alert' });
  const labels = { input: 'Input', output: 'Output', cacheRead: 'Cached input' } as const;
  m.body.append(
    el('p', { class: 'fz-lead', text: 'The last response ended before your provider reported its token usage, so Factoryze can\'t tell how much of your budget it used. The agent stays paused until the count is complete.' }),
    el('dl', { class: 'fz-facts' },
      el('dt', { text: '1. Find it' }), el('dd', { text: `Open your provider's usage page and find the request to ${issue.scope.model}. Factoryze saw at least ${tokens(observed.input + observed.output)} tokens before it ended.` }),
      el('dt', { text: '2. Enter counts' }), el('dd', {}, el('div', { class: 'fz-grid3' }, ...counts.map(([name, node]) => field(labels[name], node))), field('Provider\'s request reference', reference)),
      el('dt', { text: '3. Confirm' }), el('dd', {}, el('label', { class: 'fz-confirm' }, confirmed, 'These counts match my provider\'s record.'))),
    el('p', { class: 'fz-help', text: 'Counts can\'t be lower than what Factoryze already saw. The correction is kept in this attempt\'s history.' }), status);
  const save = button('Save counts', async () => {
    if (!confirmed.checked) { status.textContent = 'Confirm that the counts match your provider\'s record.'; return; }
    if (reference.value.trim().length < 3) { status.textContent = 'Enter the provider\'s request reference.'; reference.focus(); return; }
    save.disabled = true;
    try {
      const value = Object.fromEntries(counts.map(([name, node]) => [name, Number(node.value)]));
      await reconcile({ requestId: issue.requestId, usage: { input: value.input!, output: value.output!, cacheRead: value.cacheRead!, cacheWrite: observed.cacheWrite },
        reference: reference.value.trim(), confirmed: true, confirmAbandoned: issue.status === 'pending' });
      m.close(); done();
    } catch (error) { status.textContent = errorText(error); save.disabled = false; }
  }, { kind: 'primary' });
  m.foot.append(button('Cancel', () => m.close()), save);
}
