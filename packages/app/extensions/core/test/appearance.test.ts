import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceKey, readAppearance, themeFor } from '../src/browser/appearance.ts';

test('appearance defaults to matching the system and maps each mode to a Theia theme', () => {
  const store = (value: string | null) => ({ getItem: () => value });
  assert.equal(readAppearance(store(null)), 'system');
  assert.equal(readAppearance(store('dark')), 'dark');
  assert.equal(readAppearance(store('light')), 'light');
  assert.equal(readAppearance(store('purple')), 'system');
  assert.equal(readAppearance({ getItem: () => { throw new Error('blocked'); } }), 'system');
  assert.equal(themeFor('system', true), 'dark');
  assert.equal(themeFor('system', false), 'light');
  assert.equal(themeFor('light', true), 'light');
  assert.equal(themeFor('dark', false), 'dark');
  assert.equal(appearanceKey, 'factoryze:appearance');
});
