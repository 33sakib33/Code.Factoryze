import { button, el, icon } from './dom';
import { guideSteps, parseGuideProgress, type GuideProgress, type GuideStepId } from './first-run';

const eventName = 'factoryze-guide';
const dismissedKey = 'factoryze:guide:dismissed';
const progressKey = (workspace: string): string => `factoryze:guide:${workspace}`;

/** Reports a finished guide step from anywhere in the workbench. Nothing happens when no guide is showing. */
export const markGuide = (step: GuideStepId): void => { window.dispatchEvent(new CustomEvent<GuideStepId>(eventName, { detail: step })); };
export const guideDismissed = (storage: Storage = window.localStorage): boolean => storage.getItem(dismissedKey) === '1';

/** The five steps of a first attempt, shown above the agent conversation. It ticks itself and can be hidden for good. */
export class FirstRunGuide {
  readonly node = el('div', { class: 'fz-guide', hidden: true, role: 'group', aria: { label: 'First attempt guide' } });
  private workspace?: string;
  private progress: GuideProgress = {};
  private readonly listener = (event: Event): void => { this.mark((event as CustomEvent<GuideStepId>).detail); };

  constructor(private readonly storage: Storage = window.localStorage) { window.addEventListener(eventName, this.listener); }
  dispose(): void { window.removeEventListener(eventName, this.listener); }

  /** Starts guiding this attempt. `seed` carries steps the saved attempt already shows, such as an earlier prompt. */
  show(workspace: string, seed: GuideProgress): void {
    this.workspace = workspace;
    this.progress = { ...parseGuideProgress(this.storage.getItem(progressKey(workspace))), ...seed };
    this.node.hidden = false;
    this.render();
  }

  private mark(step: GuideStepId): void {
    if (!this.workspace || this.progress[step]) return;
    this.progress = { ...this.progress, [step]: true };
    this.storage.setItem(progressKey(this.workspace), JSON.stringify(this.progress));
    this.render();
  }

  private dismiss(): void {
    this.storage.setItem(dismissedKey, '1');
    this.workspace = undefined;
    this.node.hidden = true;
  }

  private render(): void {
    const steps = guideSteps(this.progress), current = steps.find(step => step.state === 'current');
    const list = el('ol', { class: 'fz-guide-steps' }, ...steps.map((step, index) => {
      const item = el('li', { class: `fz-guide-${step.state}` },
        step.state === 'done' ? icon('check') : el('span', { class: 'fz-guide-n', text: String(index + 1) }), step.label);
      if (step.state === 'current') item.setAttribute('aria-current', 'step');
      return item;
    }));
    this.node.replaceChildren(list, el('div', { class: 'fz-guide-foot' },
      el('p', { class: 'fz-guide-hint', text: current ? current.hint : 'All five steps done.' }),
      button('Hide guide', () => this.dismiss(), { kind: 'link' })));
  }
}
