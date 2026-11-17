import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the Agent view has a chat icon in the right sidebar navigation', () => {
  const widget = readFileSync('packages/app/extensions/core/src/browser/factoryze-agent-widget.ts', 'utf8');
  assert.match(widget, /this\.title\.iconClass\s*=\s*codicon\('comment-discussion'\)/);
});
