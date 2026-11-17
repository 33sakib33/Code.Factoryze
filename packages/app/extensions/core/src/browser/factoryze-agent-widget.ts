import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { codicon } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import type { AgentClient, AgentService } from '../common/agent-service';
import type { UsageTotals, PromptAssessment, Reconciliation, UsageIssue, LabDesktopStatus } from '@factoryze/protocol';
import { agentErrorMessage } from './agent-error';
import { AgentConfiguration } from './agent-configuration';
import { WorkbenchMetrics } from './workbench-metrics';
import { button, el, icon } from './dom';
import { followsOutput, labAgentNotice, tokens, toolLabel, unifiedDiff, workspaceRelative } from './flow-model';
import { rememberPrompt } from './prompt-history';
import { fixTokenCountDialog, raiseBudgetDialog } from './dialogs';

type Data = Record<string, unknown>;
const data = (value: unknown): Data => value && typeof value === 'object' ? value as Data : {};
const kindIcon: Record<string, string> = { read: 'eye', edit: 'edit', execute: 'terminal', search: 'search' };

export type AgentActions = { settings(): void; openFile(path: string): void; setBudget(limit: number): Promise<void>;
  isLab?():boolean; labStatus?():Promise<LabDesktopStatus|null>;
  usageIssues(): Promise<UsageIssue[]>; reconcile(input: Reconciliation): Promise<void> };

/** The Factoryze agent: prompts, tool rows, approval cards and the per-prompt cost of each turn. */
export class FactoryzeAgentWidget extends BaseWidget implements AgentClient {
  static readonly ID = 'factoryze-agent';
  private service?: AgentService;
  private readonly model = el('div', { class: 'fz-agent-model' });
  private readonly pill = el('span', { class: 'fz-pill' });
  private readonly menu = el('div', { class: 'fz-menu', hidden: true, role: 'menu' });
  private readonly more = el('button', { type: 'button', class: 'fz-icon-btn', aria: { label: 'Agent actions', expanded: 'false', haspopup: 'menu' } }, icon('ellipsis'));
  private readonly log = el('div', { class: 'fz-log', aria: { live: 'polite' } });
  private readonly jump = el('button', { type: 'button', class: 'fz-btn fz-jump-latest', hidden: true }, icon('arrow-down'), 'Jump to latest');
  /** Whether new output keeps the log at the bottom; false once the reader scrolls up. */
  private following = true;
  private labNotice?: { title: string; text: string };
  private readonly banner = el('div', { class: 'fz-banner-slot' });
  private readonly promptInput = el('textarea', { aria: { label: 'Prompt for the agent' } });
  private readonly note = el('span', { class: 'fz-composer-note' });
  private readonly sendButton = el('button', { type: 'submit', class: 'fz-btn fz-primary' }, 'Send ', el('kbd', { text: 'Enter' }));
  private readonly stopButton = el('button', { type: 'button', class: 'fz-btn', hidden: true }, icon('debug-stop'), 'Stop');
  private readonly configuration: AgentConfiguration;
  private readonly tools = new Map<string, HTMLElement>();
  private usage?: UsageTotals;
  private startedWorkspace?: string;
  private started = false;
  private busy = false;
  private waitingForApproval = false;
  private cancelPermission?: () => void;
  private turn?: HTMLElement;
  private reply?: HTMLElement;
  private lastPrompt?: string;

  constructor(private readonly workspace: WorkspaceService, private readonly metrics: WorkbenchMetrics, private readonly actions: AgentActions,
    isConfigured: () => Promise<boolean>) {
    super();
    this.id = FactoryzeAgentWidget.ID;
    this.title.label = 'Agent';
    this.title.caption = 'Factoryze agent';
    this.title.iconClass = codicon('comment-discussion');
    this.title.closable = true;
    this.addClass('fz-agent');

    this.menu.append(
      el('button', { type: 'button', role: 'menuitem', on: { click: () => { this.toggleMenu(false); void this.newSession(); } } },
        'New session', el('small', { text: 'Clears the conversation. Tokens already used stay counted.' })),
      el('button', { type: 'button', role: 'menuitem', on: { click: () => { this.toggleMenu(false); this.actions.settings(); } } },
        'Model settings', el('small', { text: 'Change the provider, model or key.' })));
    this.more.addEventListener('click', () => this.toggleMenu());
    const head = el('header', { class: 'fz-agent-head' }, el('div', { class: 'fz-who' }, el('h2', { text: 'Factoryze agent' }), this.model), this.pill, this.more);

    const composer = el('form', { class: 'fz-composer' });
    this.promptInput.rows = 3;
    this.promptInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); } });
    composer.addEventListener('submit', event => { event.preventDefault(); void this.send(); });
    this.stopButton.addEventListener('click', () => void this.stop());
    composer.append(this.promptInput, el('div', { class: 'fz-composer-bar' }, this.note, this.sendButton, this.stopButton));
    this.node.append(head, this.menu, this.log, this.jump, this.banner, composer);
    this.log.addEventListener('scroll', () => { this.following = followsOutput(this.log); if (this.following) this.jump.hidden = true; });
    this.jump.addEventListener('click', () => this.scrollToEnd(true));

    this.configuration = new AgentConfiguration(isConfigured, () => this.render());
    const refresh = () => { void this.configuration.refresh(); };
    const closeMenu = (event: Event) => { if (!this.menu.contains(event.target as Node) && event.target !== this.more && !this.more.contains(event.target as Node)) this.toggleMenu(false); };
    const connectionChanged = () => { this.started = false; void this.service?.stop().catch(error=>this.addError(errorTextForConnection(error))); };
    const errorTextForConnection = (error:unknown) => error instanceof Error?error.message:'Could not close the previous connection.';
    window.addEventListener('factoryze-connection-changed', connectionChanged);
    this.toDispose.push({dispose:()=>window.removeEventListener('factoryze-connection-changed',connectionChanged)});
    for (const event of ['factoryze-settings-changed', 'focus']) window.addEventListener(event, refresh);
    document.addEventListener('mousedown', closeMenu);
    const unsubscribe = metrics.subscribe(() => { this.model.textContent = metrics.snapshot().model ?? 'No model connected'; });
    this.toDispose.push({ dispose: () => { for (const event of ['factoryze-settings-changed', 'focus']) window.removeEventListener(event, refresh); document.removeEventListener('mousedown', closeMenu); unsubscribe(); } });
    void this.configuration.refresh();
    this.render();
  }

  connect(service: AgentService): void { this.service = service; }

  private toggleMenu(open = this.menu.hidden): void { this.menu.hidden = !open; this.more.setAttribute('aria-expanded', String(open)); }
  private get root(): string | undefined { return this.workspace.tryGetRoots()[0]?.resource.path.fsPath(); }
  private get connected(): boolean { return this.configuration.state === 'ready'; }
  private budgetBlocked(): boolean { return this.usage !== undefined && this.usage.status !== 'ready'; }

  /** One place decides the pill, the banner, the empty state and whether the composer can send. */
  private render(): void {
    this.model.textContent = this.metrics.snapshot().model ?? (this.configuration.state === 'checking' ? 'Checking model…' : 'No model connected');
    const status = this.usage?.status;
    const [label, kind] = this.busy && this.waitingForApproval ? ['Waiting for you', 'fz-wait'] : this.busy ? ['Working', 'fz-busy']
      : status === 'exhausted' || status === 'incomplete' ? ['Paused', 'fz-stop'] : !this.connected ? ['Not connected', ''] : ['Ready', ''];
    this.pill.textContent = label; this.pill.className = `fz-pill ${kind}`;
    this.banner.replaceChildren();
    if (status === 'exhausted') this.banner.append(el('div', { class: 'fz-banner', role: 'status' }, el('h3', { text: 'Token budget used up' }),
      el('p', { text: 'The agent is paused for this attempt. You can still edit, run tests and submit.' }),
      this.actions.isLab?.()?el('p',{class:'fz-help',text:'The instructor controls this lab budget.'}):button('Raise budget', () => this.raiseBudget(), { small: true })));
    else if (status === 'incomplete') this.banner.append(el('div', { class: 'fz-banner', role: 'status' }, el('h3', { text: 'Token count incomplete' }),
      el('p', { text: 'The last response ended before your provider reported its usage. The agent is paused until the count is fixed.' }),
      this.actions.isLab?.()?el('p',{class:'fz-help',text:'Ask the instructor to reconcile the server usage record.'}):button('Fix token count', () => void this.fixTokenCount(), { small: true })));
    const blocked = !this.connected ? 'Connect a model to send prompts' : this.budgetBlocked() ? 'The agent is paused'
      : this.waitingForApproval ? 'Approve or reject the agent\'s request first' : '';
    this.promptInput.disabled = !!blocked && !this.busy && this.connected;
    this.promptInput.placeholder = blocked || 'Describe the change. Name the file, the function and what done looks like.';
    this.sendButton.hidden = this.busy; this.stopButton.hidden = !this.busy;
    this.sendButton.disabled = this.busy || this.budgetBlocked() || this.configuration.state === 'checking';
    this.note.textContent = this.busy ? (this.waitingForApproval ? 'Waiting for your approval' : 'The agent is working') : '';
    if (!this.log.querySelector('.fz-turn')) this.showEmpty();
  }

  private showEmpty(): void {
    if(this.actions.isLab?.()&&!this.connected){const notice=this.labNotice??labAgentNotice(null);
      this.log.replaceChildren(el('div',{class:'fz-agent-empty'},el('h3',{text:notice.title}),el('p',{text:notice.text}),button('Lab connection',()=>this.actions.settings(),{small:true})));
      void this.actions.labStatus?.().then(status=>{const next=labAgentNotice(status);if(next.title!==notice.title||next.text!==notice.text){this.labNotice=next;this.render();}}).catch(()=>{});return;}
    if (this.configuration.state === 'unavailable') this.log.replaceChildren(el('div', { class: 'fz-agent-empty' }, el('h3', { text: 'Couldn\'t read the model settings' }),
      el('p', { text: 'Your draft stays here. Try again, or check the connection in Settings.' }), button('Try again', () => void this.configuration.refresh(), { small: true })));
    else if (!this.connected && this.configuration.state !== 'checking') this.log.replaceChildren(el('div', { class: 'fz-agent-empty' }, el('h3', { text: 'Connect a model to use the agent' }),
      el('p', { text: 'You can still edit, run tests and submit without one.' }), button('Connect a model', () => this.actions.settings(), { kind: 'primary' })));
    else this.log.replaceChildren(el('div', { class: 'fz-agent-empty' }, el('h3', { text: 'Ask for a specific change' }),
      el('p', { text: 'Name the file, the function and what done looks like. Specific prompts cost fewer tokens. Each prompt\'s cost appears here and in your report.' })));
  }

  private async start(): Promise<boolean> {
    const folder = this.root;
    if (!folder || !this.service) return false;
    this.cancelPermission?.();
    try {
      this.onUsage(await this.service.start(folder));
      this.started = true; this.startedWorkspace = folder;
      return true;
    } catch (error) {
      this.started = false;
      this.cancelPermission?.();
      this.addError(agentErrorMessage(error));
      return false;
    }
  }

  /** Practice only. The session is restarted so the raised limit takes effect and the banner clears. */
  private raiseBudget(): void {
    raiseBudgetDialog(this.usage?.budgetLimit ?? 0, async next => {
      await this.service?.stop(); this.started = false;
      await this.actions.setBudget(next);
      await this.start();
    });
  }
  private async fixTokenCount(): Promise<void> {
    try {
      await this.service?.stop(); this.started = false;
      fixTokenCountDialog(await this.actions.usageIssues(), input => this.actions.reconcile(input), () => void this.start());
    } catch (error) { this.addError(error instanceof Error ? error.message : String(error)); }
  }

  private async newSession(): Promise<void> {
    if (this.busy) await this.stop();
    await this.service?.stop().catch(() => undefined);
    this.started = false; this.tools.clear(); this.turn = undefined;
    this.log.replaceChildren(); this.render();
  }

  private async send(): Promise<void> {
    const text = this.promptInput.value.trim();
    if (!text || this.busy) return;
    if (!(await this.configuration.refresh())) { this.actions.settings(); return; }
    if (this.startedWorkspace !== this.root) this.started = false;
    this.busy = true; this.render();
    if (!this.started && !(await this.start())) { this.busy = false; this.render(); return; }
    if (this.budgetBlocked()) { this.busy = false; this.render(); return; }
    this.promptInput.value = '';
    this.log.querySelector('.fz-agent-empty')?.remove();
    this.turn = el('article', { class: 'fz-turn fz-live' }, el('div', { class: 'fz-prompt' }, el('p', { text: text })));
    this.log.append(this.turn);
    this.reply = undefined; this.lastPrompt = text;
    this.metrics.beginPrompt();
    this.render(); this.scrollToEnd(true);
    let ending = '';
    try {
      const reason = await this.service?.prompt(text);
      if (reason === 'max_tokens') ending = 'The reply hit the output limit. Ask the agent to continue.';
    } catch (error) {
      this.started = false;
        this.cancelPermission?.();
      this.addError(agentErrorMessage(error));
    } finally {
      const segment = this.metrics.snapshot().segments.at(-1);
      this.metrics.endPrompt();
      this.busy = false; this.waitingForApproval = false;
      this.turn?.querySelector('.fz-cost-live')?.remove();
      if (ending) this.turn?.append(el('p', { class: 'fz-help', text: ending }));
      this.turn?.append(el('div', { class: 'fz-cost', text: `${tokens(segment?.active ? segment.tokens : 0)} tokens` }));
      this.turn?.classList.remove('fz-live');
      this.render(); this.scrollToEnd();
    }
  }

  private async stop(): Promise<void> {
    this.cancelPermission?.();
    try { await this.service?.stop(); } catch (error) { this.addError(error instanceof Error ? error.message : String(error)); }
    finally { this.started = false; }
  }

  onAssessment(assessment: PromptAssessment): void {
    if (this.lastPrompt) rememberPrompt(assessment.promptId, this.lastPrompt);
    if (assessment.status !== 'scored' || !assessment.verdict || !this.turn) return;
    const score = assessment.verdict.specificity;
    this.turn.querySelector('.fz-prompt')?.append(el('p', { class: 'fz-feedback' },
      el('span', { class: `fz-tag ${score >= 75 ? 'fz-good' : score >= 45 ? 'fz-mid' : 'fz-bad'}`, text: `${score >= 75 ? 'Specific' : score >= 45 ? 'Fairly specific' : 'Vague'}, ${score}. ` }),
      assessment.verdict.reason));
  }

  onUsage(totals: UsageTotals): void {
    if (!this.metrics.onUsage(totals)) return;
    this.usage = totals;
    this.render();
    const live = this.turn?.querySelector('.fz-cost-live');
    const segment = this.metrics.snapshot().segments.at(-1);
    if (this.busy && segment?.active) {
      if (live) live.textContent = `${tokens(segment.tokens)} tokens so far`;
      else this.turn?.append(el('div', { class: 'fz-cost fz-cost-live', text: `${tokens(segment.tokens)} tokens so far` }));
    }
  }

  onUpdate(value: unknown): void {
    const update = data(value);
    if (!this.turn) return;
    if (update.sessionUpdate === 'agent_message_chunk') {
      const content = data(update.content);
      if (content.type !== 'text' || typeof content.text !== 'string') return;
      if (!this.reply) { this.reply = el('div', { class: 'fz-reply' }); this.insert(this.reply); }
      this.reply.textContent += content.text;
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const id = typeof update.toolCallId === 'string' ? update.toolCallId : String(Math.random());
      const kind = typeof update.kind === 'string' ? update.kind : 'search', status = typeof update.status === 'string' ? update.status : 'completed';
      const title = workspaceRelative(typeof update.title === 'string' ? update.title : 'tool', this.root);
      const row = el('div', { class: 'fz-step' }, icon(kindIcon[kind] ?? 'tools'), el('span', { class: 'fz-what', text: toolLabel(title, kind, status) }),
        status === 'failed' ? el('span', { class: 'fz-res fz-bad', text: 'Failed' }) : status === 'in_progress' ? el('span', { class: 'fz-res', text: '…' }) : null);
      const existing = this.tools.get(id);
      if (existing) existing.replaceWith(row); else this.insert(row);
      this.tools.set(id, row);
      this.reply = undefined;
    }
    this.scrollToEnd();
  }

  requestPermission(value: unknown): Promise<string | null> {
    const request = data(value), tool = data(request.toolCall), raw = data(tool.rawInput);
    const options = Array.isArray(request.options) ? request.options.map(data) : [];
    const approve = options.find(option => option.kind === 'allow_once'), reject = options.find(option => option.kind === 'reject_once');
    const diff = (Array.isArray(tool.content) ? tool.content.map(data) : []).find(item => item.type === 'diff');
    const path = workspaceRelative(typeof tool.title === 'string' ? tool.title : '', this.root);
    // The card replaces the in-progress row, so the finished row lands after the decision.
    if (typeof tool.toolCallId === 'string') { this.tools.get(tool.toolCallId)?.remove(); this.tools.delete(tool.toolCallId); }
    const card = el('section', { class: 'fz-approval', role: 'group' });
    const actions = el('div', { class: 'fz-ap-actions' });
    let approveLabel = 'Approve', rejectLabel = 'Reject';
    if (diff) {
      const lines = unifiedDiff(typeof diff.oldText === 'string' ? diff.oldText : '', typeof diff.newText === 'string' ? diff.newText : '');
      const added = lines.filter(line => line.kind === '+').length, removed = lines.filter(line => line.kind === '-').length;
      const changed = added === removed ? `${added} line${added === 1 ? '' : 's'} changed` : `${added} added, ${removed} removed`;
      card.append(el('div', { class: 'fz-ap-head' }, icon('edit'), el('span', { class: 'fz-ap-title' }, `${typeof diff.oldText === 'string' && diff.oldText ? 'Edit' : 'Create'} `, el('code', { text: path })),
        el('span', { class: 'fz-ap-meta', text: changed })),
        el('pre', { class: 'fz-diff' }, ...lines.map(line => el('div', { class: line.kind === '+' ? 'fz-add' : line.kind === '-' ? 'fz-del' : '' },
          el('span', { class: 'fz-n', text: String(line.number ?? '') }), el('span', { text: line.kind }), el('span', { text: line.text })))));
    } else if (tool.kind === 'execute') {
      approveLabel = 'Run'; rejectLabel = 'Don\'t run';
      card.append(el('div', { class: 'fz-ap-head' }, icon('terminal'), el('span', { class: 'fz-ap-title', text: 'Run a command' })),
        el('pre', { class: 'fz-cmd', text: typeof raw.command === 'string' ? raw.command : path }),
        el('p', { class: 'fz-ap-note', text: 'Runs in this attempt\'s folder with the task\'s Python environment. It can\'t see your provider key.' }));
    } else {
      card.append(el('div', { class: 'fz-ap-head' }, icon('shield'), el('span', { class: 'fz-ap-title', text: `Allow access to ${path || 'a file'}` })));
    }
    const allow = button(approveLabel, () => choose(typeof approve?.optionId === 'string' ? approve.optionId : null, diff ? 'Approved' : 'Ran', 'fz-ok'), { kind: 'primary', small: true });
    allow.disabled = !approve;
    actions.append(allow, button(rejectLabel, () => choose(typeof reject?.optionId === 'string' ? reject.optionId : null, diff ? 'Rejected' : 'Declined', 'fz-bad'), { small: true }));
    if (diff && path) actions.append(button('Show file', () => this.actions.openFile(path), { kind: 'quiet', small: true }));
    card.append(actions);
    this.insert(card);
    this.waitingForApproval = true; this.render(); this.scrollToEnd();
    allow.focus();
    let resolve!: (id: string | null) => void;
    const result = new Promise<string | null>(done => { resolve = done; });
    const choose = (id: string | null, label: string, kind: string): void => {
      actions.replaceWith(el('p', { class: `fz-ap-result ${kind}` }, icon(kind === 'fz-ok' ? 'check' : 'close'), label));
      this.cancelPermission = undefined; this.waitingForApproval = false; this.render();
      resolve(id);
    };
    this.cancelPermission = () => choose(null, 'Cancelled', 'fz-bad');
    return result;
  }

  private insert(node: HTMLElement): void {
    const live = this.turn?.querySelector('.fz-cost-live');
    if (live) live.before(node); else this.turn?.append(node);
  }
  private addError(message: string): void {
    const target = this.turn ?? this.log;
    if (!this.turn) this.log.querySelector('.fz-agent-empty')?.remove();
    target.append(el('p', { class: 'fz-error', role: 'alert', text: message }));
    this.scrollToEnd();
  }
  /** Keep the newest output in view unless the reader has scrolled up; a new prompt or Jump to latest always returns to the end. */
  private scrollToEnd(force = false): void {
    if (force) this.following = true;
    if (this.following) { this.log.scrollTop = this.log.scrollHeight; this.jump.hidden = true; }
    else this.jump.hidden = false;
  }
}
