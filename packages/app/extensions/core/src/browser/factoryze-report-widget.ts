import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import type { DesktopResultShareState, HostedResultView, PracticeReport } from '@factoryze/protocol';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { button, el } from './dom';
import { submittedLabel, tokens } from './flow-model';
import { renderReportFacts, renderReportLearning, renderReportPrompts } from './report-learning-section';
import { renderReportResult, type ReportResult } from './report-result';
import { reportShareCard, reportShareSummary } from './report-share';
import { hostedResultCopy } from './hosted-result-copy';

export type ReportView = {
  report: PracticeReport; workspace: string; title: string; attempt: number; submission: number; submissions: number;
  budgetLimit: number; startedAt?: string; current: boolean; from: 'home' | 'attempt';
};
export type ReportActions = { back(): void; keepWorking(): void; newAttempt(taskId: string): void; home(): void; submission(n: number): void;
  shareStatus(workspace:string,submission:number):Promise<DesktopResultShareState>;
  publishShare(workspace:string,submission:number):Promise<DesktopResultShareState>;
  revokeShare(workspace:string,submission:number):Promise<void>;
  signInForSharing():void;
  hostedResult(workspace:string,submission:number):Promise<HostedResultView|null>;
  retryHostedResult(workspace:string,submission:number):Promise<HostedResultView|null>;
  /** Restores the attempt's test files, then offers to submit again. */
  restoreTests(workspace:string):Promise<void> };

/** A saved submission. It reads as a result first, then the numbers, then each prompt. */
export class FactoryzeReportWidget extends BaseWidget {
  static readonly ID = 'factoryze-report';
  private readonly content = el('div', { class: 'fz-page-inner fz-report-content' });
  private result?: ReportResult;
  private shareGeneration = 0;
  private hostedGeneration = 0;
  constructor(private readonly actions: ReportActions) {
    super();
    this.id = FactoryzeReportWidget.ID;
    this.title.label = 'Report';
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-checklist';
    this.addClass('fz-page');
    this.addClass('fz-report-view');
    this.node.tabIndex = 0;
    this.node.append(this.content);
  }
  protected override onActivateRequest(): void { this.node.focus(); }
  closeCheckDetails(): void { this.result?.closeDetails(); }
  protected override onBeforeHide(message: Message): void { this.closeCheckDetails(); super.onBeforeHide(message); }
  override dispose(): void { this.closeCheckDetails(); super.dispose(); }

  display(view: ReportView): void {
    const { report } = view;
    this.title.label = `Report, attempt ${view.attempt}`;
    this.closeCheckDetails();
    this.result = renderReportResult(report);
    const share = !report.lab ? this.renderShare(view) : null;
    const hosted = !report.lab ? this.renderHosted(view) : null;

    const picker = view.submissions > 1 ? el('select', { class: 'fz-input', aria: { label: 'Submission' },
      on: { change: event => this.actions.submission(Number((event.target as HTMLSelectElement).value)) } },
      ...Array.from({ length: view.submissions }, (_, i) => { const option = el('option', { text: `Submission ${i + 1} of ${view.submissions}${i + 1 === view.submissions ? ', latest' : ''}` });
        option.value = String(i + 1); option.selected = i + 1 === view.submission; return option; })) : null;

    this.content.replaceChildren(...[
      button(view.from === 'home' ? 'Home' : 'Back to attempt', () => this.actions.back(), { kind: 'quiet', small: true, icon: 'chevron-left' }),
      el('div', { class: 'fz-report-head' },
        el('div', {}, el('span', { class: 'fz-report-eyebrow', text: 'SUBMISSION RESULT' }),
          el('h1', { text: `${view.title}, attempt ${view.attempt}` }),
          el('p', { text: report.lab?`Submitted ${submittedLabel(report.submittedAt)}. Lab ${report.lab.id}; released by your instructor.`:`Submitted ${submittedLabel(report.submittedAt)}. Practice result, not checked by an instructor.` })),
        picker ? el('label', { class: 'fz-field' }, el('span', { class: 'fz-muted', text: 'Showing' }), picker) : null),
      this.result.node,
      hosted,
      el('section', { class: 'fz-report-next', aria: { label: 'Next step' } },
        el('div', {}, el('h2', { text: 'What next?' }),
          el('p', { text: report.correctness.passed === report.correctness.total
            ? 'All hidden checks passed. You can keep exploring or start a fresh attempt.'
            : 'Review the failed checks above, then keep working on your solution.' })),
        el('div', { class: 'fz-report-actions' },
          view.current ? button('Keep working', () => this.actions.keepWorking(), { kind: 'primary' }) : null,
          report.lab ? null : button('New attempt', () => this.actions.newAttempt(report.taskId), { kind: view.current ? undefined : 'primary' }))),
      renderReportFacts(report, view.budgetLimit, view.startedAt),
      share,
      report.budget ? el('p', { class: 'fz-para' }, el('strong', { text: 'Budget raised. ' }),
        `You raised the limit from ${tokens(report.budget.initialLimit)} to ${tokens(report.budget.limit)} tokens during this attempt.`) : null,
      renderReportLearning(report),
      report.executionPins?.length ? el('details', { class: 'fz-details' }, el('summary', { text: 'Recorded agent settings' }),
        el('p', { class: 'fz-help', text: 'Settings recorded when agent sessions started. Compare results that use the same settings. Provider defaults and upstream routing may vary.' }),
        ...report.executionPins.map(pin => el('dl', { class: 'fz-kv' },
          el('dt', { text: 'Harness' }), el('dd', { text: pin.profile }),
          el('dt', { text: 'Model' }), el('dd', { text: pin.model }),
          ...(pin.funding?[el('dt',{text:'Funding'}),el('dd',{text:pin.funding==='trial'?'Factoryze trial credits':'Your API key'})]:[]),
          el('dt', { text: 'Provider host' }), el('dd', { text: pin.providerHost }),
          el('dt', { text: 'Temperature' }), el('dd', { text: pin.temperature === null ? 'Provider default (not pinned)' : String(pin.temperature) }),
          el('dt', { text: 'Operating system' }), el('dd', { text: { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[pin.os] })))) : null,
      renderReportPrompts(report),
      el('div', { class: 'fz-report-actions' },
        button('Back to Home', () => this.actions.home(), { kind: 'quiet' }))].filter((node): node is NonNullable<typeof node> => !!node));
    this.node.scrollTop = 0;
  }

  /** Hosted tasks only: whether this result was sent to the leaderboard. Empty and hidden for every other attempt. */
  private renderHosted(view: ReportView): HTMLElement {
    const generation = ++this.hostedGeneration;
    const section = el('section', { class: 'fz-report-hosted fz-card', aria: { label: 'Leaderboard result' }, hidden: true });
    const show = (state: HostedResultView): void => {
      if (this.hostedGeneration !== generation) return;
      const copy = hostedResultCopy(state);
      const status = el('p', { class: 'fz-help', role: 'status', aria: { live: 'polite' } });
      const fact = (label: string, value: string) => [el('dt', { text: label }), el('dd', { text: value })];
      const bar = el('span'); bar.style.width = `${copy.percentUsed ?? 0}%`;
      let action: HTMLElement | null = null;
      if (copy.action === 'leaderboard' && state.sync.status === 'sent') {
        const link = el('a', { class: 'fz-btn fz-primary', text: 'See the leaderboard' });
        link.href = state.sync.leaderboardURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; action = link;
      } else if (copy.action === 'restore') {
        const restore = button('Restore tests and run again', () => void (async () => {
          restore.disabled = true; status.textContent = 'Downloading the task and restoring its test files…';
          try { await this.actions.restoreTests(view.workspace); status.textContent = 'Test files restored.'; }
          catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not restore the test files.'; restore.disabled = false; }
        })(), { kind: 'primary' });
        action = restore;
      } else if (copy.action === 'retry') {
        const retry = button('Try sending again', () => void (async () => {
          retry.disabled = true; status.textContent = 'Sending…';
          try { const next = await this.actions.retryHostedResult(view.workspace, view.submission); if (next) show(next); else status.textContent = ''; }
          catch { status.textContent = 'Still not sent. Your local result is saved.'; retry.disabled = false; }
        })());
        action = retry;
      } else if (copy.action === 'sign-in') action = button('Sign in', () => this.actions.signInForSharing());
      section.replaceChildren(...[
        el('div', { class: 'fz-row-between' }, el('h2', { text: 'Leaderboard result' }), el('strong', { class: `fz-report-hosted-head fz-tag ${copy.tone === 'ok' ? 'fz-good' : copy.tone === 'bad' ? 'fz-bad' : ''}`.trim(), text: copy.headline })),
        el('p', { class: 'fz-report-hosted-tokens', text: copy.tokens }),
        copy.percentUsed === null ? null : el('div', { class: 'fz-report-hosted-bar', role: 'img', aria: { label: `${copy.percentUsed} percent of the token budget used` } }, bar),
        el('dl', { class: 'fz-kv' }, ...fact('Model', copy.model), ...fact('Hidden checks', copy.checks), ...fact('Test files', copy.testFiles)),
        el('p', { class: `fz-report-hosted-message${copy.tone === 'bad' ? ' fz-report-hosted-bad' : ''}`, text: copy.message }),
        action ? el('div', { class: 'fz-report-actions' }, action) : null,
        status,
        el('p', { class: 'fz-note', text: copy.note })].filter((node): node is NonNullable<typeof node> => !!node));
      section.hidden = false;
    };
    void this.actions.hostedResult(view.workspace, view.submission).then(state => { if (state) show(state); }).catch(() => undefined);
    return section;
  }

  private renderShare(view: ReportView): HTMLElement {
    const generation=++this.shareGeneration;
    const summary = reportShareSummary(view.report, view.title, view.budgetLimit);
    const status = el('p', { class: 'fz-help', role: 'status', aria: { live: 'polite' } });
    const copy = async (): Promise<void> => {
      try { await navigator.clipboard.writeText(summary); status.textContent = 'Result summary copied. Paste it into your post.'; }
      catch { status.textContent = 'Clipboard unavailable. Select and copy the summary below.'; }
    };
    const download = async (): Promise<void> => {
      const blob = new Blob([reportShareCard(summary)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        const picture = new Image();
        picture.src = url;
        await picture.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1200; canvas.height = 630;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(picture, 0, 0);
        const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('Image export unavailable');
        const pngURL = URL.createObjectURL(png);
        const link = document.createElement('a');
        link.href = pngURL; link.download = 'factoryze-practice-result.png'; link.click();
        setTimeout(() => URL.revokeObjectURL(pngURL), 60_000);
        status.textContent = 'Share card downloaded. Attach it to your post.';
      } catch { status.textContent = 'Could not make a share card. Copy the result summary instead.'; }
      finally { URL.revokeObjectURL(url); }
    };
    const social = (label: string): HTMLAnchorElement => {
      const link = el('a', { class: 'fz-btn', text: label, aria: { label } });
      link.hidden=true;link.target = '_blank'; link.rel = 'noopener noreferrer';
      return link;
    };
    const facebook=social('Share on Facebook'),linkedin=social('Share on LinkedIn');
    const publicLink=el('a',{class:'fz-btn',text:'Open public result'});publicLink.hidden=true;publicLink.target='_blank';publicLink.rel='noopener noreferrer';
    const copyLink=button('Copy public link',()=>{if(!shareURL)return;void navigator.clipboard.writeText(shareURL).then(()=>{status.textContent='Public result link copied.';}).catch(()=>{status.textContent='Clipboard unavailable. Copy the address from Open public result.';});});copyLink.hidden=true;
    const publish=button('Publish public link',()=>void change('publish'));publish.hidden=true;
    const revoke=button('Withdraw public link',()=>void change('revoke'));revoke.hidden=true;
    const signIn=button('Sign in to share',()=>this.actions.signInForSharing());signIn.hidden=true;
    const refresh=button('Refresh public link',()=>void loadState());
    let shareURL='',busy=false;
    const display=(state:DesktopResultShareState)=>{
      shareURL=state.published?state.url:'';
      publish.hidden=state.published;revoke.hidden=!state.published;copyLink.hidden=!state.published;
      publicLink.hidden=!state.published;facebook.hidden=!state.published;linkedin.hidden=!state.published;
      if(state.published){publicLink.href=state.url;facebook.href=`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(state.url)}`;
        linkedin.href=`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(state.url)}`;}
    };
    const change=async(kind:'publish'|'revoke')=>{
      if(busy)return;busy=true;publish.disabled=true;revoke.disabled=true;status.textContent=kind==='publish'?'Publishing result…':'Withdrawing public link…';
      try{if(kind==='publish'){const state=await this.actions.publishShare(view.workspace,view.submission);if(this.shareGeneration!==generation)return;display(state);}
        else{await this.actions.revokeShare(view.workspace,view.submission);if(this.shareGeneration!==generation)return;display({published:false});}
        status.textContent=kind==='publish'?'Public link ready. It shows only the summary above and expires after one year.':'Public link withdrawn.';
      }catch(error){status.textContent=error instanceof Error?error.message:'Could not update the public link. Try again.';
        if(/sign.?in|authentication/i.test(status.textContent))signIn.hidden=false;}
      finally{busy=false;publish.disabled=false;revoke.disabled=false;}
    };
    const loadState=async()=>{
      status.textContent='Checking public link…';refresh.disabled=true;
      try{const state=await this.actions.shareStatus(view.workspace,view.submission);if(this.shareGeneration!==generation)return;
        signIn.hidden=true;display(state);status.textContent=state.published?'Your public result link is active. You can withdraw it at any time.':'Your result is private until you publish it.';
      }catch(error){if(this.shareGeneration!==generation)return;status.textContent=error instanceof Error?error.message:'Could not check the public link.';
        signIn.hidden=/sign.?in|authentication/i.test(status.textContent)===false;}
      finally{refresh.disabled=false;}
    };
    void loadState();
    return el('section', { class: 'fz-report-share fz-card', aria: { label: 'Share this practice result' } },
      el('h2', { text: 'Share your result' }),
      el('p', { class: 'fz-help', text: 'Publishing sends only the saved title, check count, eligible token total, optional score and date. This local practice result is self-reported and not independently verified. Prompts, code and account identity stay private.' }),
      el('pre', { class: 'fz-report-share-preview', text: summary }),
      el('div', { class: 'fz-report-actions' },
        button('Copy result summary', () => void copy()),
        button('Download share card', () => void download()),
        signIn,publish,copyLink,publicLink,facebook,linkedin,revoke,refresh),
      status);
  }
}
