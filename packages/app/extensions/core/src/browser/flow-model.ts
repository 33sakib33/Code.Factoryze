import type { AttemptSummary, LabDesktopStatus } from '@factoryze/protocol';

/** `test_each_page_includes_its_last_item` reads as "Each page includes its last item". */
export function checkLabel(name: string): string {
  if (!/^test_[a-z0-9_]+$/i.test(name)) return name;
  const words = name.slice(5).replace(/_+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

const pad = (value: number): string => String(value).padStart(2, '0');
const monthDay = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const clock = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && sameDay(new Date(iso), new Date(now))) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(new Date(iso), yesterday)) return 'yesterday';
  return monthDay(new Date(iso));
}

/** "Today, 14:52" or "Oct 21, 16:05". */
export function dateLabel(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  return `${sameDay(date, new Date(now)) ? 'Today' : monthDay(date)}, ${clock(date)}`;
}

export const tokens = (value: number): string => Math.round(value).toLocaleString('en-US');
export const attemptLabel = (attempt: Pick<AttemptSummary, 'title' | 'attempt'>): string => `${attempt.title}, attempt ${attempt.attempt}`;

export function continueAttempts(attempts: readonly AttemptSummary[], limit: number | 'all' = 3): AttemptSummary[] {
  return [...attempts].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, limit === 'all' ? undefined : limit);
}

/** Practice attempts of one task; lab attempts of the same task belong to their lab, not to Practice tasks. */
export function practiceAttempts(taskId: string, attempts: readonly AttemptSummary[]): AttemptSummary[] {
  return attempts.filter(item => item.taskId === taskId && !item.lab);
}

/** What a task row says on Home: an unsubmitted attempt, else the best submission, else nothing yet. */
export function taskState(taskId: string, attempts: readonly AttemptSummary[]): string {
  const mine = practiceAttempts(taskId, attempts);
  const open = mine.filter(item => item.submissions === 0).sort((a, b) => b.attempt - a.attempt)[0];
  if (open) return `Attempt ${open.attempt} in progress`;
  const best = mine.filter(item => item.latest).sort((a, b) => b.latest!.passed / b.latest!.total - a.latest!.passed / a.latest!.total)[0];
  return best ? `Best result: ${best.latest!.passed} of ${best.latest!.total} checks` : 'Not attempted yet';
}

/** Tool titles name files by absolute path. Students see paths relative to their attempt folder. */
export function workspaceRelative(text: string, workspace: string | undefined): string {
  if (!workspace) return text;
  const root = workspace.replace(/[\\/]+$/, '');
  return text.split(root + '/').join('').split(root + '\\').join('').replace(/\\/g, match => text.includes(root + '\\') ? '/' : match);
}

export type DiffLine = { kind: ' ' | '-' | '+'; number?: number; text: string };

/** Line diff with context, for approval cards. Large files fall back to a block replace of the changed middle. */
export function unifiedDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  if (start === endA && start === endB) return [];
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const ops: DiffLine[] = [];
  if (midA.length * midB.length <= 250_000) {
    const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i--) for (let j = midB.length - 1; j >= 0; j--)
      table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { ops.push({ kind: ' ', number: start + j + 1, text: midB[j]! }); i++; j++; }
      else if (i < midA.length && (j === midB.length || table[i + 1]![j]! >= table[i]![j + 1]!)) { ops.push({ kind: '-', number: start + i + 1, text: midA[i]! }); i++; }
      else { ops.push({ kind: '+', number: start + j + 1, text: midB[j]! }); j++; }
    }
  } else {
    midA.forEach((text, index) => ops.push({ kind: '-', number: start + index + 1, text }));
    midB.forEach((text, index) => ops.push({ kind: '+', number: start + index + 1, text }));
  }
  const lead = a.slice(Math.max(0, start - context), start).map((text, index, list) => ({ kind: ' ' as const, number: start - list.length + index + 1, text }));
  const trail = b.slice(endB, endB + context).map((text, index) => ({ kind: ' ' as const, number: endB + index + 1, text }));
  return [...lead, ...ops, ...trail];
}

const verbs: Record<string, [string, string]> = {
  read: ['Reading', 'Read'], list: ['Listing', 'Listed'], grep: ['Searching', 'Searched'],
  edit: ['Editing', 'Edited'], write: ['Writing', 'Wrote'],
};
/** "read app/x.py" from the harness becomes "Read app/x.py"; shell commands become "Ran <command>". */
export function toolLabel(title: string, kind: string, status: string): string {
  const done = status !== 'in_progress' && status !== 'pending';
  if (kind === 'execute') return `${done ? 'Ran' : 'Running'} ${title}`;
  const [name = '', ...rest] = title.split(' ');
  const target = rest.join(' ').trim();
  const verb = verbs[name];
  if (!verb) return title;
  if (name === 'list' && (!target || target === '.')) return `${done ? 'Listed' : 'Listing'} the files`;
  return `${verb[done ? 1 : 0]} ${target || 'the task folder'}`;
}

/** "today at 14:52" or "on Oct 21 at 16:05", for sentences. */
export function submittedLabel(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  return `${sameDay(date, new Date(now)) ? 'today' : `on ${monthDay(date)}`} at ${clock(date)}`;
}

/** Follow new agent output only while the reader is at (or within a line of) the bottom. */
export function followsOutput(log: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight <= 48;
}

/** Why the lab agent cannot take prompts, and that the student can keep working. */
export function labAgentNotice(status: Pick<LabDesktopStatus, 'state' | 'offline' | 'inference'> | null): { title: string; text: string } {
  if (status?.state === 'closed') return { title: 'This lab is closed', text: 'The agent and new submissions are no longer available. Your saved submissions are kept.' };
  if (status?.offline) return { title: "Can't reach the lab server", text: 'You can keep editing locally. Reconnect before using the agent or submitting.' };
  if (status && !status.inference) return { title: 'The agent is off for this lab', text: 'Your instructor has not turned on the agent for this lab. You can still edit, run tests and submit.' };
  return { title: 'Lab agent unavailable', text: 'Check the lab connection with your instructor. Your local files are kept.' };
}
