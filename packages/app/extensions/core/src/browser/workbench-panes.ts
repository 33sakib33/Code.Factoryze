export type PaneArea = 'left' | 'bottom' | 'right';

export interface PaneHost {
  isExpanded(area: PaneArea): boolean;
  hasWidgets(area: PaneArea): boolean;
  collapse(area: PaneArea): Promise<void>;
  expand(area: PaneArea): Promise<void>;
  open(area: PaneArea): Promise<void>;
}

export class WorkbenchPanes {
  private readonly host: PaneHost;
  constructor(host: PaneHost) { this.host = host; }

  isVisible(area: PaneArea): boolean {
    return this.host.hasWidgets(area) && this.host.isExpanded(area);
  }

  async toggle(area: PaneArea): Promise<void> {
    if (this.isVisible(area)) await this.host.collapse(area);
    else {
      if (!this.host.hasWidgets(area)) await this.host.open(area);
      await this.host.expand(area);
    }
  }
}

interface WorkbenchShell {
  isExpanded(area: PaneArea): boolean;
  getWidgets(area: PaneArea): readonly unknown[];
  collapsePanel(area: PaneArea): Promise<void>;
  expandPanel(area: PaneArea): void;
  readonly pendingUpdates: Promise<unknown>;
}

export function createWorkbenchPanes(shell: WorkbenchShell, execute: (command: string) => Promise<unknown>, revealTerminal: () => Promise<void>): WorkbenchPanes {
  return new WorkbenchPanes({
    isExpanded: area => shell.isExpanded(area),
    hasWidgets: area => shell.getWidgets(area).length > 0,
    collapse: area => shell.collapsePanel(area),
    expand: async area => {
      if (area === 'bottom') await revealTerminal();
      else shell.expandPanel(area);
      await shell.pendingUpdates;
    },
    open: async area => {
      // The terminal command creates its own view when the bottom area is empty.
      if (area === 'bottom') return;
      await execute(area === 'left' ? 'fileNavigator:toggle' : 'factoryze.agent.toggle');
    },
  });
}
