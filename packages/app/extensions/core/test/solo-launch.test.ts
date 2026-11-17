import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePracticeLaunch, practiceLaunchKey } from '../src/browser/solo-launch.ts';

test('only a recent explicit task open reveals its starter once for its own workspace', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
  assert.equal(consumePracticeLaunch(storage, '/old-workspace', 1000), false);
  values.set(practiceLaunchKey('/new-workspace'), '1000');
  assert.equal(consumePracticeLaunch(storage, '/other-workspace', 1100), false);
  assert.equal(consumePracticeLaunch(storage, '/new-workspace', 1100), true);
  assert.equal(consumePracticeLaunch(storage, '/new-workspace', 1200), false);
  values.set(practiceLaunchKey('/new-workspace'), '1000');
  assert.equal(consumePracticeLaunch(storage, '/new-workspace', 100_000), false);
  values.set(practiceLaunchKey('/new-workspace'), 'invalid');
  assert.equal(consumePracticeLaunch(storage, '/new-workspace', 100_000), false);
});
