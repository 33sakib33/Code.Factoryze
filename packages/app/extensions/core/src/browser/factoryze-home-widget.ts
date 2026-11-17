import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import type { AttemptSummary, ModelSettingsView, ReportSummary, TaskPack } from '@factoryze/protocol';
import type { PracticeTask, TaskTopicCount } from '../common/task-service';
import { isModelConfigured } from '@factoryze/protocol';
import type { TaskService } from '../common/task-service';
import { button, el, errorText, meter } from './dom';
import { continueAttempts, dateLabel, relativeTime, taskState, tokens } from './flow-model';
import { browseTasks, pageSize, topicFacets, topicLabel, untaggedTopic } from './task-browser';

export type HomeActions = {
  continueAttempt(attempt: AttemptSummary): void;
  start(task: TaskPack, attempts: AttemptSummary[]): void;
  importTask(zip: boolean): void;
  connect(): void;
  report(summary: ReportSummary): void;
  joinLab?():void;
};

/** The first screen. Nothing opens until the student chooses an attempt or a task. */
export class FactoryzeHomeWidget extends BaseWidget {
  static readonly ID = 'factoryze-home';
  private readonly content = el('div', { class: 'fz-home-inner' });
  private generation = 0;
  private showAllAttempts = false;
  private taskQuery = '';
  private selectedTopic = '';
  private taskPage = 0;
  private hostedPage = 0;
  private hostedCursors = [''];

  constructor(private readonly service: TaskService, private readonly actions: HomeActions) {
    super();
    this.id = FactoryzeHomeWidget.ID;
    this.title.label = 'Home';
    this.title.closable = false;
    this.addClass('fz-page');
    this.addClass('fz-home');
    this.node.tabIndex = 0;
    this.node.append(this.content);
    const refresh = () => { void this.refresh(); };
    window.addEventListener('factoryze-settings-changed', refresh);
    this.toDispose.push({ dispose: () => window.removeEventListener('factoryze-settings-changed', refresh) });
  }

  protected override onActivateRequest(): void { this.node.focus(); void this.refresh(); }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    try {
      const [tasks, attempts, reports, settings, hostedTopics] = await Promise.all([this.service.localTasks(), this.service.attempts(), this.service.reports(),
        this.service.settings().catch(() => null), this.service.hostedTopics().catch(() => [])]);
      if (generation === this.generation) this.render(tasks, attempts, reports, settings, hostedTopics);
    } catch (error) {
      if (generation === this.generation) this.content.replaceChildren(el('p', { class: 'fz-error', role: 'alert', text: errorText(error) }),
        button('Try again', () => void this.refresh()));
    }
  }

  private render(tasks: PracticeTask[], attempts: AttemptSummary[], reports: ReportSummary[], settings: ModelSettingsView | null, remoteTopics: TaskTopicCount[]): void {
    this.hostedPage = 0;
    this.hostedCursors = [''];
    const main: HTMLElement[] = [];
    const taskSearch = el('input', { type: 'search', aria: { label: 'Search practice tasks' } });
    const intro = el('header', { class: 'fz-home-intro' },
      el('div', {}, el('span', { class: 'fz-home-eyebrow', text: 'PRACTICE' }),
        el('h1', { text: 'Find a task to practice' }),
        el('p', { text: 'Choose a problem, work on it in the editor, and submit to see your result.' })));

    const recent = continueAttempts(attempts, this.showAllAttempts ? 'all' : 3);
    if (recent.length) main.push(el('section', { class: 'fz-home-section', aria: { label: 'Continue' } }, el('div', { class: 'fz-section-head' }, el('h2', { text: 'Continue' }),
      ...(attempts.length > 3 ? [button(this.showAllAttempts ? 'Show recent attempts' : 'Show all attempts', () => {
        this.showAllAttempts = !this.showAllAttempts;
        this.render(tasks, attempts, reports, settings, remoteTopics);
      }, { small: true })] : [])),
      el('div', { class: 'fz-continue-list' }, ...recent.map((attempt, index) => el('article', { class: `fz-continue${index ? ' fz-other' : ''}` },
        el('div', {}, el('h3', { text: attempt.title }),
          el('p', { text: `Attempt ${attempt.attempt}, started ${relativeTime(attempt.startedAt)}. ${attempt.latest
            ? `Last submitted ${relativeTime(attempt.latest.submittedAt)}: ${attempt.latest.passed} of ${attempt.latest.total} checks passed.`
            : `Last worked on ${relativeTime(attempt.lastActivityAt)}.`}` })),
        el('div', { class: 'fz-usage' }, meter([{ tokens: attempt.weighted, label: 'Used' }], attempt.budgetLimit, true),
          el('span', { text: `${tokens(attempt.weighted)} of ${tokens(attempt.budgetLimit)} tokens` })),
        button('Continue', () => this.actions.continueAttempt(attempt), { kind: index ? undefined : 'primary', aria: `Continue ${attempt.title}, attempt ${attempt.attempt}` }))))));

    taskSearch.placeholder = 'Search title, topic, or skill'; taskSearch.value = this.taskQuery;
    const topicCounts = new Map<string, number>();
    for (const facet of [...topicFacets(tasks), ...remoteTopics]) topicCounts.set(facet.id, (topicCounts.get(facet.id) ?? 0) + facet.count);
    const facets = [...topicCounts].map(([id, count]) => ({ id, count })).sort((a, b) =>
      a.id === untaggedTopic ? 1 : b.id === untaggedTopic ? -1 : b.count - a.count || a.id.localeCompare(b.id));
    if (this.selectedTopic && !facets.some(facet => facet.id === this.selectedTopic)) this.selectedTopic = '';
    const taskCount = el('p', { class: 'fz-home-section-description', role: 'status' });
    const taskList = el('ul', { class: 'fz-task-list' });
    const noMatches = el('p', { class: 'fz-empty' });
    const topicSelect = el('select', { aria: { label: 'Filter practice tasks by topic' } },
      el('option', { text: 'All topics' }), ...facets.map(facet => el('option', { text: `${topicLabel(facet.id)} (${facet.count})` })));
    topicSelect.options[0].value = '';
    facets.forEach((facet, index) => { topicSelect.options[index + 1].value = facet.id; });
    topicSelect.value = this.selectedTopic;
    const chips = el('div', { class: 'fz-topic-chips', role: 'group', aria: { label: 'Popular topics' } });
    const quickTopics = ['', ...facets.slice(0, 6).map(facet => facet.id)];
    for (const topic of quickTopics) {
      const count = facets.find(facet => facet.id === topic)?.count;
      const chip = el('button', { type: 'button', class: 'fz-topic-chip', text: topic ? `${topicLabel(topic)} ${count}` : 'All problems' });
      chip.dataset.topic = topic;
      chip.addEventListener('click', () => { this.selectedTopic = topic; this.taskPage = 0; topicSelect.value = topic; renderPage(); resetHosted(); });
      chips.append(chip);
    }
    const previous = button('Previous', () => { this.taskPage--; renderPage(); }, { small: true });
    const next = button('Next', () => { this.taskPage++; renderPage(); }, { small: true });
    const pageLabel = el('span', { class: 'fz-home-page-label' });
    const pagination = el('nav', { class: 'fz-home-pagination', aria: { label: 'Practice task pages' } }, previous, pageLabel, next);
    const row = (task: PracticeTask) => el('li', {},
      el('div', {}, el('h3', {}, task.title, ...(task.hosted ? [el('span', { class: 'fz-hosted-tag', title: 'Published by your Factoryze service', text: 'Hosted' })] : [])), el('p', { text: task.brief })),
      el('div', { class: 'fz-task-meta' },
        el('span', { text: (task.topics?.length ? task.topics.map(topicLabel).join(' · ') : topicLabel(untaggedTopic)) }),
        el('span', { text: `About ${task.timeHintMinutes ?? 30} minutes` }),
        el('span', { text: `Python ${task.minimumPython}+` }),
        el('span', { class: 'fz-state', text: taskState(task.id, attempts) })),
      button('Start practice', () => this.actions.start(task, attempts), { kind: 'primary', aria: `Start ${task.title}` }));
    let remoteVisible = false, remoteLoaded = false, remoteRequest = 0;
    const renderPage = () => {
      const found = browseTasks(tasks, { topic: this.selectedTopic, query: this.taskQuery, page: this.taskPage, pageSize });
      this.taskPage = found.page;
      taskList.replaceChildren(...found.items.map(row));
      const first = found.total ? found.page * pageSize + 1 : 0;
      const last = Math.min(found.total, (found.page + 1) * pageSize);
      taskCount.textContent = found.total ? `Bundled: ${first}–${last} of ${found.total}` : 'No bundled matches';
      noMatches.textContent = tasks.length ? 'No tasks match your search. Try a different word or topic.' : 'No practice tasks are available yet. Refresh the list or import a task below.';
      noMatches.hidden = found.total > 0 || !remoteLoaded || remoteVisible;
      pagination.hidden = found.total <= pageSize;
      previous.disabled = found.page === 0;
      next.disabled = found.page + 1 >= found.pages;
      pageLabel.textContent = `Page ${found.page + 1} of ${found.pages}`;
      for (const chip of chips.querySelectorAll<HTMLButtonElement>('button')) chip.setAttribute('aria-pressed', String(chip.dataset.topic === this.selectedTopic));
    };
    const remoteList = el('ul', { class: 'fz-task-list' });
    const remoteCount = el('p', { class: 'fz-home-section-description', role: 'status', text: 'Loading online problems…' });
    const remoteNote = el('p', { class: 'fz-help', text: 'Sign in on this device when you choose to download a hosted task.' });
    const remotePrevious = button('Previous online page', () => { this.hostedPage--; void loadHosted(); }, { small: true });
    const remoteNext = button('Next online page', () => { this.hostedPage++; void loadHosted(); }, { small: true });
    const remotePageLabel = el('span', { class: 'fz-home-page-label' });
    const remotePagination = el('nav', { class: 'fz-home-pagination', aria: { label: 'Online task pages' } }, remotePrevious, remotePageLabel, remoteNext);
    remotePagination.hidden = true;
    const loadHosted = async () => {
      const request = ++remoteRequest;
      remoteLoaded = false;
      remoteCount.textContent = 'Loading online problems…';
      remoteList.replaceChildren();
      remotePagination.hidden = true;
      try {
        const page = await this.service.browseHosted({ query: this.taskQuery.trim(), topic: this.selectedTopic,
          after: this.hostedCursors[this.hostedPage] ?? '', limit: pageSize });
        if (request !== remoteRequest || !this.content.contains(remoteList)) return;
        remoteLoaded = true; remoteVisible = page.tasks.length > 0;
        remoteList.replaceChildren(...page.tasks.map(row));
        if (page.nextCursor) this.hostedCursors[this.hostedPage + 1] = page.nextCursor;
        else this.hostedCursors.length = this.hostedPage + 1;
        remoteCount.textContent = page.tasks.length ? `Online problems · page ${this.hostedPage + 1}` : 'No online matches';
        remotePrevious.disabled = this.hostedPage === 0;
        remoteNext.disabled = !page.nextCursor;
        remotePagination.hidden = this.hostedPage === 0 && !page.nextCursor;
        remotePageLabel.textContent = `Page ${this.hostedPage + 1}`;
        renderPage();
      } catch {
        if (request !== remoteRequest || !this.content.contains(remoteList)) return;
        remoteLoaded = true; remoteVisible = false;
        remoteCount.textContent = 'Online catalog unavailable. Bundled tasks are ready offline.';
        renderPage();
      }
    };
    const resetHosted = () => { this.hostedPage = 0; this.hostedCursors = ['']; void loadHosted(); };
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    taskSearch.maxLength = 80;
    taskSearch.addEventListener('input', () => { this.taskQuery = taskSearch.value; this.taskPage = 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => { renderPage(); resetHosted(); }, 200); });
    topicSelect.addEventListener('change', () => { this.selectedTopic = topicSelect.value; this.taskPage = 0; renderPage(); resetHosted(); });
    renderPage();
    main.unshift(el('section', { class: 'fz-home-section fz-home-catalog', aria: { label: 'Practice tasks' } },
      el('div', { class: 'fz-section-head' }, el('div', {}, el('h2', { text: 'Practice tasks' }), taskCount)),
      chips,
      el('div', { class: 'fz-home-search' }, taskSearch, topicSelect,
        button('Refresh tasks', () => void this.refresh(), { icon: 'refresh', small: true })),
      taskList, pagination,
      el('div', { class: 'fz-section-head fz-online-head' }, el('div', {}, el('h3', { text: 'Online problems' }), remoteCount)),
      remoteList, noMatches, remotePagination, remoteNote));

    const results = el('section', { class: 'fz-home-section', aria: { label: 'Results' } }, el('div', { class: 'fz-section-head' },
      el('div', {}, el('h2', { text: 'Results' }), el('p', { class: 'fz-home-section-description', text: reports.length
        ? `${reports.length} saved ${reports.length === 1 ? 'submission' : 'submissions'} · Open a row for the full report`
        : 'Your submitted attempts will appear here.' }))));
    if (!reports.length) results.append(el('p', { class: 'fz-empty', text: 'When you submit an attempt, its report appears here.' }));
    else {
      const body = el('tbody');
      for (const report of reports) {
        const open = () => this.actions.report(report);
        const row = el('tr', { class: 'fz-row', on: { click: open, keydown: event => { if (['Enter', ' '].includes((event as KeyboardEvent).key)) { event.preventDefault(); open(); } } } },
          el('td', {}, el('strong', { text: report.title }), ' ', el('span', { class: 'fz-muted', text: `Attempt ${report.attempt}${report.submissions > 1 ? `, submission ${report.submission}` : ''}` })),
          el('td', { class: 'fz-hide-sm', text: dateLabel(report.submittedAt) }),
          el('td', { class: report.passed === report.total ? 'fz-pass' : 'fz-partial', text: `${report.passed} of ${report.total}` }),
          el('td', { class: 'fz-num', text: tokens(report.weighted) }),
          el('td', { class: 'fz-hide-sm fz-muted', text: report.score === null ? 'Not scored' : `${report.score} / 100` }));
        row.tabIndex = 0;
        row.setAttribute('aria-label', `Open the report for ${report.title}, attempt ${report.attempt}`);
        body.append(row);
      }
      results.append(el('div', { class: 'fz-table-wrap' }, el('table', { class: 'fz-results' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Task' }), el('th', { class: 'fz-hide-sm', text: 'Submitted' }), el('th', { text: 'Hidden checks' }),
          el('th', { class: 'fz-num', text: 'Tokens' }), el('th', { class: 'fz-hide-sm', text: 'Score' }))), body)));
    }
    const more = el('section', { class: 'fz-home-more', aria: { label: 'More ways to practice' } },
      el('div', { class: 'fz-home-more-card' }, el('h2', { text: 'Bring your own task' }),
        el('p', { text: 'Open a task folder or ZIP from your computer.' }),
        el('div', { class: 'fz-actions' }, button('Open task folder…', () => this.actions.importTask(false), { icon: 'folder-opened' }),
          button('Open task ZIP…', () => this.actions.importTask(true), { icon: 'file-zip' }))),
      this.actions.joinLab ? el('div', { class: 'fz-home-more-card' }, el('h2', { text: 'Classroom lab' }),
        el('p', { text: 'Join a lab using the details from your instructor.' }),
        el('div', { class: 'fz-actions' }, button('Join a lab', () => this.actions.joinLab!()),
          button('Refresh lab results', () => { void this.service.refreshLabs().then(() => this.refresh()); }, { kind: 'link' }))) : null,
      !isModelConfigured(settings) ? el('div', { class: 'fz-home-more-card' }, el('h2', { text: 'Want an AI assistant?' }),
        el('p', { text: 'Connect a model to use the agent. You can still edit, run tests, and submit without one.' }),
        button('Connect a model', () => this.actions.connect())) : null);
    this.content.replaceChildren(intro, ...main, more, results);
    void loadHosted();
  }
}
