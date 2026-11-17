import assert from 'node:assert/strict';
import test from 'node:test';
import { promptText, rememberPrompt } from '../src/browser/prompt-history.ts';

test('prompt text is kept locally by prompt ID and long prompts are shortened', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  rememberPrompt('p1', 'Fix page_of() in app/pagination.py', storage);
  rememberPrompt('p2', 'x'.repeat(5000), storage);
  assert.equal(promptText('p1', storage), 'Fix page_of() in app/pagination.py');
  assert.equal(promptText('p2', storage)!.length, 2000);
  assert.equal(promptText('missing', storage), undefined);
  const failing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.doesNotThrow(() => rememberPrompt('p3', 'text', failing));
  assert.equal(promptText('p3', failing), undefined);
});
