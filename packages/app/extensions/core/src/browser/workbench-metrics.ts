import type { PromptUsage, TokenUsage, UsageTotals } from '@factoryze/protocol';

export const taskStartKey = (workspace: string): string => `factoryze:task-start:${workspace}`;

export type TokenSegment = { label: string; tokens: number; active: boolean };
export type MetricsSnapshot = {
  home: boolean;
  weighted: number; budgetLimit: number; remaining: number; segments: TokenSegment[];
  raw: TokenUsage;
  startedAt?: number; taskTitle?: string; status?: UsageTotals['status'];
  attempt?: number; model?: string | null;
};

/** Presentation state only. The engine remains the source of truth for metered totals. */
export class WorkbenchMetrics {
  private home = false;
  private usage?: UsageTotals;
  private taskBudget = 0;
  private segments: TokenSegment[] = [];
  private active?: TokenSegment;
  private promptCount = 0;
  private startedAt?: number;
  private taskTitle?: string;
  private workspace?: string;
  private attempt?: number;
  private model?: string | null;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setHome(home: boolean): void { if (this.home !== home) { this.home = home; this.emit(); } }

  startTask(workspace: string, startedAt: number | undefined, taskTitle?: string, budgetLimit?: number): void {
    this.selectWorkspace(workspace, startedAt);
    this.setTaskTitle(taskTitle);
    if (budgetLimit !== undefined) this.setTaskBudget(budgetLimit);
  }

  selectWorkspace(workspace: string, startedAt?: number): void {
    if (this.workspace !== workspace) {
      this.workspace = workspace;
      this.usage = undefined;
      this.taskBudget = 0;
      this.segments = [];
      this.active = undefined;
      this.promptCount = 0;
      this.taskTitle = undefined;
      this.attempt = undefined;
    }
    this.startedAt = startedAt;
    this.emit();
  }

  setTaskTitle(title?: string): void {
    this.taskTitle = title;
    this.emit();
  }
  setTaskBudget(limit: number): void { this.taskBudget = limit; this.emit(); }
  setAttempt(attempt?: number): void { this.attempt = attempt; this.emit(); }
  /** The connected model's name, or null when no model is connected. */
  setModel(model: string | null): void { this.model = model; this.emit(); }

  onUsage(totals: UsageTotals): boolean {
    if (this.workspace && totals.workspace && this.workspace !== totals.workspace) return false;
    const scope = JSON.stringify(totals.scope);
    const previousScope = this.usage && JSON.stringify(this.usage.scope);
    if (previousScope === scope && this.usage && (totals.requests < this.usage.requests ||
      (['input', 'output', 'cacheRead', 'cacheWrite'] as const).some(key => totals.raw[key] < this.usage!.raw[key]))) return false;
    if (previousScope && previousScope !== scope) {
      this.segments = [];
      this.active = undefined;
      this.promptCount = 0;
    }
    const delta = previousScope === scope ? Math.max(0, totals.weighted - this.usage!.weighted) : totals.weighted;
    if (delta > 0) {
      if (this.active && previousScope === scope) this.active.tokens += delta;
      else {
        const earlier = this.segments.find(segment => segment.label === 'Earlier usage');
        if (earlier) earlier.tokens += delta;
        else this.segments.unshift({ label: 'Earlier usage', tokens: delta, active: false });
      }
    }
    this.usage = totals;
    this.emit();
    return true;
  }

  /** Rebuilds the prompt segments from the engine's saved per-prompt costs for this attempt. */
  seedPrompts(workspace: string, prompts: readonly PromptUsage[]): void {
    if (this.workspace !== workspace || this.active) return;
    const attributed = prompts.reduce((sum, prompt) => sum + prompt.weighted, 0);
    const other = Math.max(0, Math.round(((this.usage?.weighted ?? 0) - attributed) * 1e6) / 1e6);
    this.segments = [
      ...(other > 0 ? [{ label: 'Other usage', tokens: other, active: false }] : []),
      ...prompts.map(prompt => ({ label: `Prompt ${prompt.index}`, tokens: prompt.weighted, active: false })),
    ];
    this.promptCount = prompts.length;
    this.emit();
  }

  beginPrompt(): void {
    if (this.active) this.active.active = false;
    this.active = { label: `Prompt ${++this.promptCount}`, tokens: 0, active: true };
    this.segments.push(this.active);
    this.emit();
  }

  endPrompt(): void {
    if (this.active) this.active.active = false;
    this.active = undefined;
    this.emit();
  }

  snapshot(): MetricsSnapshot {
    return {
      home: this.home,
      weighted: this.usage?.weighted ?? 0,
      raw: this.usage ? { ...this.usage.raw } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      budgetLimit: this.usage?.budgetLimit ?? this.taskBudget,
      remaining: this.usage?.remaining ?? this.taskBudget,
      status: this.usage?.status,
      segments: this.segments.filter(segment => segment.tokens > 0 || segment.active).map(segment => ({ ...segment })),
      startedAt: this.startedAt,
      taskTitle: this.taskTitle,
      attempt: this.attempt,
      model: this.model,
    };
  }

  elapsed(now = Date.now()): string {
    if (this.home) return '—';
    if (this.startedAt === undefined) return '—';
    const seconds = Math.max(0, Math.floor((now - this.startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
