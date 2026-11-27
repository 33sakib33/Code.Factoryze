import type { TrialAccountView } from '@factoryze/protocol';

/**
 * What the trial dialog shows for a signed-in account. Credit is attached to the account's email,
 * so the only thing a person can ever be asked to do here is to request credit.
 */
export type TrialCreditState = {
  kind: 'ready' | 'none' | 'waiting' | 'spent' | 'expired' | 'daily' | 'blocked' | 'paused';
  /** Short status for the account card. */
  label: string;
  /** One or two sentences saying where things stand and what happens next. */
  message: string;
  /** True when "Use trial credits" may be pressed. */
  canUse: boolean;
  /** Label of the request button, when asking for credit is the next step. */
  request?: 'Request credit' | 'Request more credit';
};

export function trialCreditState(view: TrialAccountView): TrialCreditState {
  const a = view.account;
  const serviceOn = view.inferenceEnabled && view.programEnabled;
  if (!a) return { kind: 'none', label: 'Not signed in', message: 'Sign in with your email to see your credit.', canUse: false };
  if (a.suspended) return { kind: 'blocked', label: 'Account blocked', message: 'The project owner has blocked this account. Contact them, or use your own API key.', canUse: false };
  const expired = a.claimed && Date.parse(a.expiresAt) <= Date.now();
  const usable = a.claimed && !expired && a.availableMicro > 0;
  if (!usable) {
    if (view.creditRequested) return { kind: 'waiting', label: 'Waiting for approval', message: 'Your request has been sent to the project owner. Credit appears here as soon as it is approved; you do not need to do anything else.', canUse: false };
    if (!a.claimed) return { kind: 'none', label: 'No credit yet', message: 'Credit is attached to your email, and none is waiting for this address. Ask the project owner for some.', canUse: false, request: 'Request credit' };
    return expired
      ? { kind: 'expired', label: 'Credit expired', message: 'Your trial credit has expired. You can ask for more, or use your own API key.', canUse: false, request: 'Request more credit' }
      : { kind: 'spent', label: 'Credit used up', message: 'You have used all of your trial credit. You can ask for more, or use your own API key.', canUse: false, request: 'Request more credit' };
  }
  if (!serviceOn) return { kind: 'paused', label: 'Trial credits are paused', message: 'Trial credits are paused right now. Your credit and your work are saved; try again later or use your own API key.', canUse: false };
  if (a.dailyLimitMicro && a.dailyAvailableMicro === 0) {
    return { kind: 'daily', label: 'Daily limit reached', message: `You have reached today's limit. It resets at ${a.dailyResetAt ? new Date(a.dailyResetAt).toLocaleString() : '00:00 UTC'}.`, canUse: false };
  }
  return { kind: 'ready', label: 'Credit ready', message: 'Your credit is ready. Choose a model and start.', canUse: view.models.length > 0 };
}
