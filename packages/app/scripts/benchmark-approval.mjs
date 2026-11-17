// Test-only unattended commands. Shell operators, arbitrary scripts and credential access still require a person.
const posix = /^(?:cd \. && )?(?:(?:\.venv\/bin\/)?python3? -m (?:pytest|unittest)|pytest)(?: [\w./:=-]+)*(?: 2>&1)?(?: \| (?:tail|head)(?: -n)? -?\d+)?$/;
const windows = /^(?:& )?(?:(?:\.\\)?\.venv\\Scripts\\python\.exe|python(?:3|\.exe)?|py(?: -3(?:\.\d+)?)?) -m (?:unittest|pytest)(?: [\w./\\:=-]+)*(?: 2>&1)?$/i;
export function isBenchmarkTestCommand(command) {
  return typeof command === 'string' && !/[\r\n]/.test(command) && (posix.test(command.trim()) || windows.test(command.trim()));
}
