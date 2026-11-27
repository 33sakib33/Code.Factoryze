import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrialAccountView } from '@factoryze/protocol';
import { trialCreditState } from '../src/browser/trial-credit.ts';

const day = 86_400_000;
type AccountPatch = Partial<NonNullable<TrialAccountView['account']>>;
const view = (account: AccountPatch | null, extra: Partial<TrialAccountView> = {}): TrialAccountView => ({
  origin: 'https://trial.example', selected: false, signedIn: account !== null, programEnabled: true, inferenceEnabled: true,
  models: [{ id: 'trial-coder', maxInputTokens: 32768, maxOutputTokens: 2048, outputParameter: 'max_tokens' }], maxRequestBytes: 65536, maxMessages: 128, maxTools: 32,
  ...(account === null ? {} : { account: { id: 'email:x', email: 'x@example.test', claimed: true, suspended: false, grantedMicro: 2_000_000, spentMicro: 0, reservedMicro: 0,
    availableMicro: 2_000_000, expiresAt: new Date(Date.now() + day).toISOString(), ...account } }), ...extra });

test('credit that is ready can be used and never asks for a code or a request', () => {
  const state = trialCreditState(view({}));
  assert.deepEqual([state.kind, state.label, state.canUse, state.request], ['ready', 'Credit ready', true, undefined]);
});

test('an account with no credit has exactly one next step: ask for it', () => {
  const none = trialCreditState(view({ claimed: false, grantedMicro: 0, availableMicro: 0 }));
  assert.deepEqual([none.kind, none.label, none.canUse, none.request], ['none', 'No credit yet', false, 'Request credit']);
  assert.match(none.message, /attached to your email/i);
  assert.doesNotMatch(none.message + none.label, /invitation|code/i);
});

test('after asking, the account waits and can only check again', () => {
  const waiting = trialCreditState(view({ claimed: false, grantedMicro: 0, availableMicro: 0 }, { creditRequested: true }));
  assert.deepEqual([waiting.kind, waiting.label, waiting.canUse, waiting.request], ['waiting', 'Waiting for approval', false, undefined]);
  // A request that has been answered with credit no longer shows as waiting.
  assert.equal(trialCreditState(view({}, { creditRequested: true })).kind, 'ready');
});

test('used-up and expired credit offer to ask for more', () => {
  const spent = trialCreditState(view({ spentMicro: 2_000_000, availableMicro: 0 }));
  assert.deepEqual([spent.kind, spent.label, spent.request], ['spent', 'Credit used up', 'Request more credit']);
  const expired = trialCreditState(view({ expiresAt: new Date(Date.now() - day).toISOString() }));
  assert.deepEqual([expired.kind, expired.label, expired.request], ['expired', 'Credit expired', 'Request more credit']);
  assert.equal(trialCreditState(view({ spentMicro: 2_000_000, availableMicro: 0 }, { creditRequested: true })).kind, 'waiting');
});

test('a daily limit, a block and a paused program explain themselves without a request button', () => {
  const daily = trialCreditState(view({ dailyLimitMicro: 500_000, dailyAvailableMicro: 0 }));
  assert.deepEqual([daily.kind, daily.canUse, daily.request], ['daily', false, undefined]);
  const blocked = trialCreditState(view({ suspended: true }));
  assert.deepEqual([blocked.kind, blocked.label, blocked.canUse, blocked.request], ['blocked', 'Account blocked', false, undefined]);
  for (const off of [{ programEnabled: false }, { inferenceEnabled: false }]) {
    const paused = trialCreditState(view({}, off));
    assert.deepEqual([paused.kind, paused.label, paused.canUse, paused.request], ['paused', 'Trial credits are paused', false, undefined]);
  }
  // Someone with no credit can still ask while the program is paused, so the owner sees the demand.
  assert.equal(trialCreditState(view({ claimed: false, grantedMicro: 0, availableMicro: 0 }, { programEnabled: false })).request, 'Request credit');
  assert.equal(trialCreditState(view({}, { models: [] })).canUse, false);
});
