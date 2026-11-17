import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Electron lets the workbench header occupy the macOS title row', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.theia.frontend.config.electron.windowOptions.titleBarStyle, 'hiddenInset');
});
