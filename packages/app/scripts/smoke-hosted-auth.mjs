import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const executablePath = join(repo, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app/Contents/MacOS/Factoryze');
const root = mkdtempSync(join(tmpdir(), 'factoryze-hosted-auth-smoke-'));
const requests = [];
const task = { schema: 1, id: 'shipping-cutoff-demo', title: 'Shipping fee at the cutoff',
  brief: 'Fix the shipping fee at exactly 5,000 cents.', minimumPython: '3.11', entryFile: 'app.py', timeHintMinutes: 10,
  sha256: 'a'.repeat(64), archiveBytes: 100 };
const catalog = [...Array.from({ length: 20 }, (_, index) => ({ ...task, id: `online-task-${String(index).padStart(3, '0')}`, title: `Online task ${index}` })), task];
const server = createServer((request, response) => {
  requests.push(request.url);
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/tasks' || url.pathname === '/api/tasks/search') {
    const query = (url.searchParams.get('q') || '').toLowerCase(), after = url.searchParams.get('after') || '';
    const matches = catalog.filter(item => item.id > after && (!query || item.title.toLowerCase().includes(query)));
    const page = matches.slice(0, 20);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ tasks: page, nextCursor: matches.length > 20 ? page.at(-1).id : '' }));
  } else if (url.pathname === '/api/tasks/topics') {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ topics: [] }));
  } else if (url.pathname === '/api/tasks/shipping-cutoff-demo') {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(task));
  } else { response.writeHead(500).end('Unexpected request'); }
});
let app;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, THEIA_CONFIG_DIR: join(root, 'theia'), FACTORYZE_DATA_DIR: join(root, 'engine'),
    FACTORYZE_CREDENTIAL_ACCOUNT: `hosted-auth-${root.split('/').at(-1)}`, FACTORYZE_PRACTICE_SESSIONS_DIR: join(root, 'workspaces'),
    FACTORYZE_TRIAL_URL: `http://127.0.0.1:${server.address().port}`, FACTORYZE_PYTHON_BIN: '/opt/homebrew/bin/python3.12' };
  for (const key of Object.keys(env)) if (key.startsWith('FACTORYZE_PROVIDER_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  app = await _electron.launch({ executablePath, args: [`--user-data-dir=${join(root, 'electron')}`, `--electronUserData=${join(root, 'electron')}`, '--no-sandbox'], env, timeout: 60_000 });
  const deadline = Date.now() + 60_000;
  let page;
  while (!page && Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (!candidate.isClosed() && await candidate.locator('.fz-home').count().catch(() => 0)) { page = candidate; break; }
    }
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Home should open');
  page.setDefaultTimeout(30_000);
  await page.getByRole('heading', { name: 'Find a task to practice', exact: true }).waitFor();
  // First launch leads with the starter tasks. Measured before the catalog is used, because paging the online list scrolls the page.
  const firstTask = page.locator('.fz-starter').first();
  await firstTask.waitFor();
  assert.equal(await firstTask.evaluate(node => {
    const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;
  }), true, 'The first starter task should be visible without scrolling');
  await page.getByRole('button', { name: 'Next online page' }).click();
  await page.getByRole('button', { name: 'Start Shipping fee at the cutoff' }).waitFor();
  await page.getByRole('button', { name: 'Previous online page' }).click();
  const search = page.getByRole('searchbox', { name: 'Search practice tasks' });
  await search.fill('no matching problem');
  await page.getByText('No tasks match your search. Try a different word or topic.').waitFor();
  await search.fill('shipping');
  const hostedTask = page.locator('.fz-task-list li').filter({ hasText: 'Shipping fee at the cutoff' });
  await hostedTask.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.fz-task-list li:visible').count(), 1, 'Search should show only the matching hosted task');
  await page.getByRole('button', { name: 'Start Shipping fee at the cutoff' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shipping fee at the cutoff' });
  await dialog.getByText('Sign in to download this hosted task.').waitFor();
  await dialog.locator('.fz-check.fz-ok').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Start attempt' }).isDisabled(), true);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.fz-settings').waitFor();
  await page.getByRole('dialog', { name: 'Connect a model' }).getByLabel('Email address').waitFor();
  assert.deepEqual(requests.filter(path => path?.includes('/archive')), []);
  console.log(JSON.stringify({ passed: true, hostedListed: true, startBlockedUntilSignIn: true, directDesktopSignIn: true, archiveRequests: 0 }));
} finally {
  await app?.close().catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
