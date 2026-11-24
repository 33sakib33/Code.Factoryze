import type { AttemptSummary, ModelSettingsView, ReportSummary } from '@factoryze/protocol';
import { isModelConfigured } from '@factoryze/protocol';
import type { PracticeTask } from '../common/task-service';

/**
 * Home offers these to someone with no result yet, in this order. The first one present is marked "Start here".
 * All three are short. Each teaches one thing: the loop, telling the agent a rule it cannot read, and aiming a prompt to save tokens.
 */
export const starterTaskIds = ['delivery-fee', 'duplicate-customers', 'latency-report'] as const;

export type StarterPick = { task: PracticeTask; recommended: boolean };

/** Starter choices for the first run. Empty once any result has been submitted. Only bundled tasks qualify. */
export function starterPicks(tasks: readonly PracticeTask[], reports: readonly ReportSummary[]): StarterPick[] {
  if (reports.length) return [];
  const found = starterTaskIds.map(id => tasks.find(task => task.id === id && !task.hosted)).filter((task): task is PracticeTask => !!task);
  return found.map((task, index) => ({ task, recommended: index === 0 }));
}

export const guideStepIds = ['read', 'ask', 'approve', 'test', 'submit'] as const;
export type GuideStepId = typeof guideStepIds[number];
export type GuideProgress = Partial<Record<GuideStepId, true>>;
export type GuideStep = { id: GuideStepId; label: string; hint: string; state: 'done' | 'current' | 'todo' };

const guideCopy: Record<GuideStepId, [label: string, hint: string]> = {
  read: ['Read', 'Read the bug in the brief on the left.'],
  ask: ['Ask', 'Tell the agent what to fix. Precise prompts cost fewer tokens.'],
  approve: ['Approve', 'Review the agent\'s change. Nothing changes until you approve it.'],
  test: ['Test', 'Run the tests to check the fix.'],
  submit: ['Submit', 'Submit to run the hidden checks and see your result.'],
};

/** The five steps of a first attempt. Doing any later step counts the brief as read; the first step left is current. */
export function guideSteps(progress: GuideProgress): GuideStep[] {
  const done = (id: GuideStepId): boolean => !!progress[id] || (id === 'read' && guideStepIds.some(other => progress[other]));
  const current = guideStepIds.find(id => !done(id));
  return guideStepIds.map(id => ({ id, label: guideCopy[id][0], hint: guideCopy[id][1], state: done(id) ? 'done' : id === current ? 'current' : 'todo' }));
}

/** Guide progress as saved in local storage. Anything unexpected reads as "nothing done yet". */
export function parseGuideProgress(raw: string | null): GuideProgress {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const progress: GuideProgress = {};
    for (const id of guideStepIds) if ((value as Record<string, unknown>)[id] === true) progress[id] = true;
    return progress;
  } catch { return {}; }
}

/** The guide is for practice attempts before the first submitted result, until the student hides it. */
export function guideActive(input: { reports: number; dismissed: boolean; lab: boolean }): boolean {
  return input.reports === 0 && !input.dismissed && !input.lab;
}

const minutes = (task: PracticeTask | undefined): number => task?.timeHintMinutes ?? 30;

/** After a result: the next starter not tried yet, in starter order; after those, the shortest untried bundled task. */
export function nextTask(tasks: readonly PracticeTask[], attempts: readonly AttemptSummary[], currentId: string): PracticeTask | undefined {
  // Lab attempts of the same task belong to their lab, so they do not count as practice here.
  const practised = new Set(attempts.filter(item => !item.lab).map(item => item.taskId));
  const open = tasks.filter(task => !task.hosted && task.id !== currentId && !practised.has(task.id));
  const starters: readonly string[] = starterTaskIds;
  return starters.map(id => open.find(task => task.id === id)).find(task => task !== undefined)
    ?? open.sort((a, b) => minutes(a) - minutes(b) || a.title.localeCompare(b.title))[0];
}

export function nextTaskLabel(current: PracticeTask | undefined, next: PracticeTask): string {
  return current && minutes(next) > minutes(current) ? 'Try a harder one' : 'Try another task';
}

/** The start sheet's Model row: whether the agent can run, and who pays for its requests. */
export function startSheetModel(settings: ModelSettingsView | null | undefined): { connected: boolean; text: string } {
  if (!settings || !isModelConfigured(settings)) return { connected: false, text: 'Not connected. The agent needs a model.' };
  if (settings.authentication === 'trial') return { connected: true, text: `Trial credits · ${settings.model}` };
  return { connected: true, text: `${settings.model} · ${settings.source === 'environment' ? 'set on this computer' : 'your API key'}` };
}
