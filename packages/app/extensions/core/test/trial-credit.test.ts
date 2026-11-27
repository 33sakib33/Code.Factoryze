import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrialAccountView } from '@factoryze/protocol';
import { trialCreditState, trialFooter } from '../src/browser/trial-credit.ts';

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

// The footer is the dialog's answer to "what do I do now?". These tests keep it to the one next step.
const footer = (account: AccountPatch, extra: Partial<TrialAccountView> = {}) => trialFooter(trialCreditState(view(account, extra))).map(b => (b.primary ? `[${b.label}]` : b.label));
const noCredit = { claimed: false, grantedMicro: 0, availableMicro: 0 };

test('the footer\'s main button is the one next step for every credit state', () => {
  assert.deepEqual(footer({}), ['Cancel', '[Use trial credits]']);
  assert.deepEqual(footer(noCredit), ['Close', '[Request credit]']);
  assert.deepEqual(footer({ spentMicro: 2_000_000, availableMicro: 0 }), ['Close', '[Request more credit]']);
  assert.deepEqual(footer({ expiresAt: new Date(Date.now() - day).toISOString() }), ['Close', '[Request more credit]']);
  // Waiting has nothing to do: closing is the main button and looking again is the only other one.
  assert.deepEqual(footer(noCredit, { creditRequested: true }), ['Check again', '[Close]']);
  assert.deepEqual(footer({ suspended: true }), ['[Close]']);
  assert.deepEqual(footer({}, { programEnabled: false }), ['[Close]']);
  assert.deepEqual(footer({ dailyLimitMicro: 500_000, dailyAvailableMicro: 0 }), ['[Close]']);
  assert.deepEqual(footer({}, { models: [] }), ['[Close]']);
});

test('a button that cannot be pressed is never offered, and "Cancel" never sits beside a sent request', () => {
  const states: [AccountPatch, Partial<TrialAccountView>][] = [[{}, {}], [noCredit, {}], [noCredit, { creditRequested: true }], [{ spentMicro: 2_000_000, availableMicro: 0 }, {}],
    [{ expiresAt: new Date(Date.now() - day).toISOString() }, {}], [{ suspended: true }, {}], [{}, { programEnabled: false }], [{ dailyLimitMicro: 500_000, dailyAvailableMicro: 0 }, {}], [{}, { models: [] }]];
  for (const [account, extra] of states) {
    const state = trialCreditState(view(account, extra)), buttons = trialFooter(state);
    assert.equal(buttons.filter(b => b.primary).length, 1, `${state.kind}: exactly one main button`);
    assert.equal(buttons.at(-1)!.primary, true, `${state.kind}: the main button comes last`);
    assert.equal(buttons.some(b => b.action === 'use'), state.canUse, `${state.kind}: "Use trial credits" appears only when it works`);
    // "Cancel" would read as cancelling the request or the account; it is kept for the one state where a choice is being abandoned.
    assert.equal(buttons.some(b => b.label === 'Cancel'), state.canUse, `${state.kind}: Cancel only beside a usable choice`);
  }
});

test('the waiting message says the request is sent, that the window can be closed, and what works meanwhile', () => {
  const waiting = trialCreditState(view(noCredit, { creditRequested: true }));
  assert.match(waiting.message, /^Request sent\./); assert.match(waiting.message, /close this window/i);
  assert.match(waiting.message, /without the agent/i); assert.match(waiting.message, /your own API key/i);
});
