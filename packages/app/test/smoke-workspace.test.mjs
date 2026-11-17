import assert from 'node:assert/strict';
import test from 'node:test';
import { workbenchWorkspacePath } from '../scripts/smoke-workspace.mjs';

test('installed smoke decodes Theia workspace URLs into native Windows drive and UNC paths', () => {
  assert.equal(workbenchWorkspacePath('http://localhost/#/c:/Users/student/task%20%231%25', 'win32'), 'c:\\Users\\student\\task #1%');
  assert.equal(workbenchWorkspacePath('http://localhost/#/D%3A/work/task', 'win32'), 'D:\\work\\task');
  assert.equal(workbenchWorkspacePath('http://localhost/#//server/share/task', 'win32'), '\\\\server\\share\\task');
});

test('installed smoke preserves POSIX workspace paths and rejects an absent workspace', () => {
  assert.equal(workbenchWorkspacePath('http://localhost/#/private/tmp/task%20%231%25', 'darwin'), '/private/tmp/task #1%');
  assert.equal(workbenchWorkspacePath('http://localhost/#/tmp/task', 'linux'), '/tmp/task');
  assert.throws(() => workbenchWorkspacePath('http://localhost/', 'linux'), /workspace/i);
});
