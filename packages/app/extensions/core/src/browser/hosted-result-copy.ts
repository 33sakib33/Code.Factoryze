import type { HostedResultView } from '@factoryze/protocol';

const count = (value: number): string => Math.round(value).toLocaleString('en-US');
export function ordinal(rank: number): string {
  const tens = rank % 100, ones = rank % 10;
  return `${count(rank)}${tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`;
}

export type HostedResultCopy = {
  headline: string; tokens: string; percentUsed: number | null; model: string; checks: string; testFiles: string;
  message: string; tone: 'ok' | 'quiet' | 'bad';
  action: 'leaderboard' | 'restore' | 'retry' | 'sign-in' | null;
  note: string;
};

/** Words for the hosted-result section. Pass/fail is always local and self-reported; nothing here says "verified". */
export function hostedResultCopy(view: HostedResultView): HostedResultCopy {
  const { sync } = view;
  const weighted = view.weightedTokens;
  const locallySolved = view.total > 0 && view.passed === view.total && (weighted ?? 0) <= view.budgetTokens;
  const solved = sync.status === 'sent' ? sync.response.solved : locallySolved;
  const funding = view.funding === 'hosted' ? 'Factoryze trial credits' : view.funding === 'own_key' ? 'your API key' : undefined;
  const board = (b: 'hosted' | 'own_key') => b === 'hosted' ? 'trial-credits board' : 'own-key board';
  let message: string, tone: HostedResultCopy['tone'] = 'quiet', action: HostedResultCopy['action'] = null;
  switch (sync.status) {
    case 'sent':
      if (!sync.response.counted) message = 'Result sent. The service recorded it but did not count it on the leaderboard.';
      else if (sync.response.standing) { message = `Result sent. You are now ${ordinal(sync.response.standing.rank)} on the ${board(sync.response.standing.board)}.`; tone = 'ok'; action = 'leaderboard'; }
      else { message = 'Result sent. It appears on the leaderboard once you solve a problem.'; action = 'leaderboard'; }
      if (sync.solutionNote) message += ` ${sync.solutionNote}`;
      else if (sync.solutionIncluded) message += ' Your solution files were included.';
      break;
    case 'not_counted_edited': message = 'Not counted. The test files were edited, so this result was not sent.'; tone = 'bad'; action = 'restore'; break;
    case 'already_sent': message = `Not sent. This attempt's result was already sent with submission ${sync.submission}. Start a new attempt to send another.`; break;
    case 'signed_out': message = 'Not sent. Sign in to send results from hosted tasks.'; action = 'sign-in'; break;
    case 'not_eligible': message = `Not sent. ${sync.message}`; break;
    case 'unavailable': message = 'Not sent. The results service is not available right now.'; action = sync.retry ? 'retry' : null; break;
    case 'rejected': message = `Not sent. ${sync.message}`; break;
  }
  return {
    headline: view.testFiles === 'edited' ? 'Not counted.' : solved ? 'Solved.' : 'Not solved.',
    tokens: weighted === undefined ? `No model tokens recorded · budget ${count(view.budgetTokens)}` : `${count(weighted)} of ${count(view.budgetTokens)} tokens`,
    percentUsed: weighted === undefined ? null : Math.min(100, Math.round(weighted / view.budgetTokens * 100)),
    model: view.model ? `${view.model}${funding ? ` · ${funding}` : ''}` : 'No model used',
    checks: `${view.passed} of ${view.total} passed`,
    testFiles: view.testFiles === 'edited' ? 'Edited on this computer' : 'Unchanged',
    message, tone, action,
    note: sync.status === 'sent'
      ? sync.response.tokenCheck === 'checked'
        ? 'Checks ran on this computer, so pass/fail is self-reported. The service compared the token count with its own gateway records.'
        : 'Checks ran on this computer and the token count comes from your own key, so this result is self-reported.'
      : 'Checks ran on this computer, so results are self-reported. The test-file check only catches casual edits.'
  };
}
