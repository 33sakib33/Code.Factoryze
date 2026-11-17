import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchPanes, createWorkbenchPanes, type PaneArea } from '../src/browser/workbench-panes.ts';

test('pane controls hide and restore each pane independently without closing its content', async () => {
  const visible = new Set<PaneArea>(['left', 'bottom', 'right']);
  const opened: PaneArea[] = [];
  const panes = new WorkbenchPanes({
    isExpanded: area => visible.has(area),
    hasWidgets: () => true,
    collapse: async area => { visible.delete(area); },
    expand: async area => { visible.add(area); },
    open: async area => { opened.push(area); },
  });
  for (const area of ['left', 'bottom', 'right'] as const) {
    await panes.toggle(area);
    assert.equal(panes.isVisible(area), false);
    assert.equal(visible.size, 2);
    await panes.toggle(area);
    assert.equal(panes.isVisible(area), true);
    assert.equal(visible.size, 3);
  }
  assert.deepEqual(opened, []);
});

test('showing an empty pane restores its default view before expanding', async () => {
  let hasWidgets = false;
  const actions: string[] = [];
  const panes = new WorkbenchPanes({
    isExpanded: () => false,
    hasWidgets: () => hasWidgets,
    collapse: async () => { actions.push('collapse'); },
    expand: async () => { assert.equal(hasWidgets, true); actions.push('expand'); },
    open: async () => { actions.push('open'); hasWidgets = true; },
  });
  await panes.toggle('bottom');
  assert.deepEqual(actions, ['open', 'expand']);
});

test('opening the bottom pane reveals the terminal even when the Problems view already exists', async () => {
  const commands: string[] = [];
  const panes = createWorkbenchPanes({
    isExpanded: () => false,
    getWidgets: () => [{ id: 'problems' }],
    collapsePanel: async () => {},
    expandPanel: () => assert.fail('The terminal command should select the terminal tab'),
    pendingUpdates: Promise.resolve(),
  }, async command => { commands.push(command); }, async () => { commands.push('reveal-terminal'); });
  await panes.toggle('bottom');
  assert.deepEqual(commands, ['reveal-terminal']);
});
