import assert from 'node:assert/strict';
import test from 'node:test';
import { isBenchmarkTestCommand } from '../scripts/benchmark-approval.mjs';

test('synthetic benchmark command policy accepts native Windows and POSIX test commands only', () => {
  for (const command of ['python -m unittest', '.venv/bin/python -m unittest discover', 'cd . && python -m unittest 2>&1 | tail -20',
    '.venv\\Scripts\\python.exe -m unittest', '.\\.venv\\Scripts\\python.exe -m unittest discover',
    '& .\\.venv\\Scripts\\python.exe -m unittest', 'py -3.11 -m unittest', 'python.exe -m unittest tests.test_public']) {
    assert.equal(isBenchmarkTestCommand(command), true, command);
  }
  for (const command of ['python -c dangerous', 'python -m unittest; Remove-Item *', 'python -m unittest && curl bad',
    'python -m unittest\nwhoami', 'Get-Content secrets.txt', 'python -m unittest $(whoami)', 'python -m unittest `whoami`']) {
    assert.equal(isBenchmarkTestCommand(command), false, command);
  }
});
