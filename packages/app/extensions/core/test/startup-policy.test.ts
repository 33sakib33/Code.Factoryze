import assert from 'node:assert/strict';
import test from 'node:test';
import { startupWorkspace } from '../src/node/startup-policy.ts';

test('launch opens Home instead of restoring the last attempt, unless a folder is passed on the command line', () => {
  assert.equal(startupWorkspace(undefined, 'file:///Users/me/Factoryze%20Practice/pagination-api-1'), undefined);
  assert.equal(startupWorkspace('', 'file:///previous'), undefined);
  assert.equal(startupWorkspace('file:///explicit', 'file:///previous'), 'file:///explicit');
});
