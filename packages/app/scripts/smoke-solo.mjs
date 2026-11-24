import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { _electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { getSoloEngine } from '../../engine/src/solo.ts';
import { workbenchWorkspacePath } from './smoke-workspace.mjs';

// Launches the real Factoryze application and harness; only the model is synthetic.
// An explicit executable allows the same flow to test an installed or extracted artifact.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultExecutable = process.platform === 'darwin'
  ? join(repo, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app/Contents/MacOS/Factoryze')
  : join(repo, 'dist', process.platform === 'win32' ? 'win-unpacked/Factoryze.exe' : 'linux-unpacked/factoryze');
const executablePath = process.env.FACTORYZE_SMOKE_EXECUTABLE || defaultExecutable;
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'factoryze-installed-smoke-')));
const output = join(repo, 'dist', `smoke-${process.platform}`); mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: false, platform: process.platform, status: 'running' }) + '\n');
const sessions = join(root, 'workspaces');
const credentialAccount = `smoke-${root.split(/[\\/]/).at(-1)}`;
let credentialMode = false;
let expectedTemperature = 0;
let modelCalls = 0;
let judgeCalls = 0;
let step = 0;
let harnessStep = 0;
let harnessCalls = 0;
let harnessWorkspace;
let app;
let db;
let lastPage;
let diagnostics = '';
const recordDiagnostic = message => { diagnostics = (diagnostics + message).slice(-200_000); };
const toolbarOverlapsAfterLoad = [];
let enteredStopJudge;
const stopJudgeEntered = new Promise(resolve => { enteredStopJudge = resolve; });
let source;
let legacyModelCalls = 0;
const newest = prefix => join(sessions, readdirSync(sessions).filter(name => name.startsWith(prefix)).sort().at(-1));
const upstream = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.authorization, 'Bearer synthetic-smoke-key');
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (body.legacySeed === true) {
      legacyModelCalls++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"usage":{"prompt_tokens":10,"completion_tokens":4}}'); return;
    }
    if (body.model === 'judge-replay') {
      judgeCalls++;
      if (JSON.stringify(body.messages).includes('STOP_PROBE')) { enteredStopJudge(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'judge-smoke', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ category: 'specific', specificity: 90, reason: 'Names the file, behavior, and verification.' }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 4 } })); return;
    }
    assert.equal(body.model, 'replay'); modelCalls++;
    assert.equal(body.temperature, expectedTemperature, 'Every harness step uses the saved session temperature');
    assert.equal(body.stream_options.include_usage, true);
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'smoke', object: 'chat.completion.chunk', created: 1, model: 'replay', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    let events = chunk({ role: 'assistant' });
    const tools = body.tools?.map(tool => tool.function?.name ?? tool.name) ?? [];
    const messages = JSON.stringify(body.messages);
    if (tools.includes('list') && messages.includes('HARNESS_PROBE')) {
      harnessCalls++;
      if (!messages.includes('BUDGET_PROBE') && harnessStep < 3) {
        const filePath = join(harnessWorkspace, 'billing', 'promotions.py');
        const name = ['read', 'edit', 'shell'][harnessStep];
        const args = name === 'read' ? { filePath: 'billing/promotions.py' } : name === 'edit'
          ? { filePath: 'billing/promotions.py', oldString: readFileSync(filePath, 'utf8'), newString: readFileSync(filePath, 'utf8') + '\n# Factoryze harness approved edit\n' }
          : { command: 'python -m unittest' };
        events += chunk({ tool_calls: [{ index: 0, id: `harness-${++harnessStep}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }) + chunk({}, 'tool_calls');
      } else {
        if (!messages.includes('BUDGET_PROBE')) assert.match(messages, /Ran 2 tests/, 'The native agent shell must run the bundled public tests');
        events += chunk({ content: 'Factoryze harness done.' }) + chunk({}, 'stop');
      }
    } else if (tools.includes('edit') && step < 2) {
      const filePath = join(newest('library-fines-'), 'library', 'returns.py');
      const name = step === 0 ? 'read' : 'edit';
      if (name === 'edit') source = readFileSync(filePath, 'utf8')
        .replace('from .calendar import', 'from .clock import local_day\nfrom .calendar import')
        .replace('returned_on = returned_at.date()', 'returned_on = local_day(returned_at, branch)');
      const args = step === 0 ? { filePath } : { filePath, oldString: readFileSync(filePath, 'utf8'), newString: source };
      events += chunk({ tool_calls: [{ index: 0, id: `smoke-${++step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }) + chunk({}, 'tool_calls');
    } else events += chunk({ content: 'Done. Return dates follow the branch local day.' }) + chunk({}, 'stop');
    const probe = messages.includes('BUDGET_PROBE');
    events += `data: ${JSON.stringify({ usage: { prompt_tokens: probe ? 3000 : 10, completion_tokens: 4 }, choices: [] })}\n\ndata: [DONE]\n\n`;
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(events);
  } catch (error) { response.writeHead(500).end(); console.error(error); }
});

const launch = async (useKeychain = false) => {
  credentialMode = useKeychain;
  const env = { ...process.env, THEIA_CONFIG_DIR: join(root, 'theia'), FACTORYZE_DATA_DIR: join(root, 'engine'),
    FACTORYZE_CREDENTIAL_ACCOUNT: credentialAccount, FACTORYZE_PRACTICE_SESSIONS_DIR: sessions, FACTORYZE_PROVIDER_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    FACTORYZE_PROVIDER_API_KEY: 'synthetic-smoke-key', FACTORYZE_MODEL: 'replay', FACTORYZE_MODEL_API: 'openai-chat',
    FACTORYZE_TOKEN_BUDGET: '100', FACTORYZE_TEMPERATURE: '0', FACTORYZE_JUDGE_ENABLED: '1', FACTORYZE_SCORING_ENABLED: '1', FACTORYZE_JUDGE_MODEL: 'judge-replay' };
  // Do not let host overrides replace packaged resources or leak a real key into the synthetic run.
  delete env.ELECTRON_RUN_AS_NODE; delete env.FACTORYZE_PRACTICE_TASKS_DIR;
  if (useKeychain) for (const key of Object.keys(env)) { if (key.startsWith('FACTORYZE_PROVIDER_') || ['FACTORYZE_MODEL', 'FACTORYZE_MODEL_API', 'FACTORYZE_TOKEN_BUDGET', 'FACTORYZE_TEMPERATURE', 'FACTORYZE_JUDGE_ENABLED', 'FACTORYZE_JUDGE_MODEL', 'FACTORYZE_SCORING_ENABLED'].includes(key)) delete env[key]; }
  app = await _electron.launch({ executablePath, args: [`--user-data-dir=${join(root, 'electron')}`, `--electronUserData=${join(root, 'electron')}`, '--no-sandbox'], env, timeout: 60_000 });
  app.process().stdout?.on('data', data => { recordDiagnostic(String(data)); if (process.env.FACTORYZE_SMOKE_DEBUG === '1') process.stdout.write(data); });
  app.process().stderr?.on('data', data => { recordDiagnostic(String(data)); if (process.env.FACTORYZE_SMOKE_DEBUG === '1') process.stderr.write(data); });
  app.process().on('exit', (code, signal) => recordDiagnostic(`Electron exit: code=${code} signal=${signal}\n`));
  const ready = async page => {
    lastPage = page;
    page.on('close', () => recordDiagnostic('Workbench page closed\n'));
    page.on('crash', () => recordDiagnostic('Workbench renderer crashed\n'));
    page.on('pageerror', error => recordDiagnostic(`Renderer: ${error.message}\n`));
    page.on('console', message => { if (message.type() === 'error') recordDiagnostic(`Renderer console: ${message.text()}\n`); });
    await page.locator('.factoryze-metrics').waitFor({ state: 'attached', timeout: 60_000 }); return page;
  };
  // Theia opens a short-lived splash window before its workbench.
  const page = await Promise.any([...app.windows().map(ready), app.waitForEvent('window', { timeout: 60_000 }).then(ready)]);
  lastPage = page; page.setDefaultTimeout(45_000);
  // On every later load, record the bottom pane toggle's state at the moment the toolbar is inserted,
  // before any timer or observer could correct it.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const toggle = document.querySelector('.fz-toggles [data-pane=bottom]');
      if (!toggle) return;
      window.__factoryzeInsertedPaneState = toggle.getAttribute('aria-pressed') ?? 'missing';
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  // Use the small default CI window on every OS, including high-resolution Macs.
  const window = await app.browserWindow(page);
  await window.evaluate(async window => {
    // Electron can restore a maximized window on relaunch; sizing it has no effect until it is restored.
    if (window.isMaximized()) await new Promise(resolve => { window.once('unmaximize', resolve); window.unmaximize(); });
    window.setContentSize(683, 512);
  });
  await page.waitForFunction(() => innerWidth === 683 && innerHeight === 512);
  return page;
};
const relaunch = async (useKeychain = credentialMode) => { await app.close(); app = undefined; return launch(useKeychain); };
const home = page => page.locator('.fz-home');
const waitForTaskTitles = async (page, expected) => {
  const selector = '.fz-home-catalog > .fz-task-list h3';
  await page.waitForFunction(({ selector, expected }) => {
    const actual = [...document.querySelectorAll(selector)].map(node => node.textContent?.trim());
    return actual.length === expected.length && actual.every((title, index) => title === expected[index]);
  }, { selector, expected });
  assert.deepEqual(await page.locator(selector).allTextContents(), expected);
};
const toolbarAccessible = async page => {
  // Workspace reloads attach the toolbar before the loading scrim has gone away.
  await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const obscuredButtons = () => page.locator('.factoryze-metrics').evaluate(node => [...node.querySelectorAll('button')]
    .filter(button => button.checkVisibility())
    .flatMap(button => {
      const box = button.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      const outside = x < 0 || x >= innerWidth || y < 0 || y >= innerHeight, top = outside ? null : document.elementFromPoint(x, y);
      if (!outside && button.contains(top)) return [];
      const cover = top ? `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}${typeof top.className === 'string' && top.className ? `.${top.className.trim().split(/\s+/).join('.')}` : ''}` : 'nothing';
      return [`${button.getAttribute('aria-label') || button.textContent} (${outside ? 'outside the window' : `under ${cover}`})`];
    }));
  // Windows lays out its custom title bar a moment after a reload, so only an overlap that lasts is a failure.
  let obscured = await obscuredButtons();
  if (obscured.length) { toolbarOverlapsAfterLoad.push(obscured.join(', ')); recordDiagnostic(`Toolbar overlap after load: ${obscured.join(', ')}\n`); }
  for (const deadline = Date.now() + 5000; obscured.length && Date.now() < deadline; obscured = await obscuredButtons()) await page.waitForTimeout(100);
  assert.deepEqual(obscured, [], 'Window controls must not cover or push toolbar buttons outside the window');
};
const attemptOpened = async (page, prefix) => {
  await page.waitForURL(url => decodeURIComponent(url.hash).includes(prefix));
  await page.locator('.fz-agent').waitFor();
  await page.locator('.fz-tb-attempt').waitFor({ state: 'visible' });
  await toolbarAccessible(page);
};
const goHome = async page => {
  await page.locator('.fz-tb-attempt').getByRole('button', { name: 'Home', exact: true }).click();
  await page.waitForURL(url => url.hash === '' || url.hash === '#');
  await home(page).getByRole('heading', { name: 'Practice tasks', exact: true }).waitFor();
  await page.locator('.fz-tb-home').waitFor({ state: 'visible' });
  await toolbarAccessible(page);
};
const startTask = async (page, title, budget) => {
  await home(page).getByRole('button', { name: `Start ${title}`, exact: true }).click();
  const dialog = page.locator('.fz-dialog');
  await dialog.locator('.fz-check.fz-ok').waitFor({ timeout: 60_000 });
  if (budget) {
    await dialog.getByRole('button', { name: 'Change', exact: true }).click();
    await dialog.getByLabel('Token limit for each attempt of this task').fill(String(budget));
  }
  await dialog.getByRole('button', { name: 'Start attempt', exact: true }).click();
};
const prompt = page => page.getByRole('textbox', { name: 'Prompt for the agent' });
let turnsBeforeSend = 0;
const send = async (page, text) => {
  turnsBeforeSend = await page.locator('.fz-turn').count();
  await prompt(page).fill(text); await page.locator('.fz-composer button[type=submit]').click();
};
const pill = page => page.locator('.fz-pill');
// A turn is done once the new turn exists and is no longer live.
const turnDone = async page => {
  await page.locator('.fz-turn').nth(turnsBeforeSend).waitFor({ state: 'attached' });
  await page.locator('.fz-turn.fz-live').waitFor({ state: 'detached' });
  await page.locator('.fz-composer button[type=submit]').waitFor({ state: 'visible' });
};
const newSession = async page => {
  await page.getByRole('button', { name: 'Agent actions', exact: true }).click();
  await page.locator('.fz-menu button').filter({ hasText: 'New session' }).click();
};
const budgetText = page => page.locator('.fz-budget-text');
const submitAttempt = async page => {
  await page.locator('.fz-tb-attempt').getByRole('button', { name: 'Submit', exact: true }).click();
  await page.locator('.fz-dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  await page.locator('.fz-dialog').waitFor({ state: 'detached', timeout: 60_000 });
  await page.locator('.fz-report-result').waitFor();
};
const runTests = async (page, expected) => {
  await page.locator('.fz-tb-attempt').getByRole('button', { name: 'Run tests', exact: true }).click();
  await page.locator('.fz-tests .fz-sum').getByText(expected, { exact: true }).waitFor({ timeout: 60_000 });
};
const popover = async page => {
  await page.locator('.fz-budget-btn').click();
  const values = Object.fromEntries(await page.locator('.fz-popover dt').evaluateAll(nodes => nodes.map(node => [node.textContent, Number(node.nextElementSibling.textContent.replace(/,/g, ''))])));
  await page.keyboard.press('Escape');
  return values;
};

// Seed upgrade fixtures against the installed task resources, with real venvs, usage and reports.
const seedRetiredAttempts = async () => {
  const packRoot = join(process.platform === 'darwin' ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources'), 'practice-tasks');
  const originalDataDir = process.env.FACTORYZE_DATA_DIR;
  process.env.FACTORYZE_DATA_DIR = join(root, 'engine');
  const engine = getSoloEngine();
  const attempts = [];
  let draft;
  try {
    // Two old unsubmitted drafts push the first outside the three recent rows.
    for (let index = 0; index < 2; index++) {
      const { workspace } = await engine.startTask(packRoot, 'dedupe-ids', sessions);
      writeFileSync(join(workspace, 'app/dedupe.py'), readFileSync(join(workspace, 'app/dedupe.py'), 'utf8') + '\n# Preserved older draft\n');
      draft ??= workspace;
    }
    for (const id of ['dedupe-ids', 'pagination-api']) {
      const { workspace } = await engine.startTask(packRoot, id, sessions);
      if (id === 'dedupe-ids') writeFileSync(join(workspace, 'app/dedupe.py'), 'def unique_ids(ids):\n    return list(dict.fromkeys(ids))\n');
      else {
        const file = join(workspace, 'app/pagination.py');
        writeFileSync(file, readFileSync(file, 'utf8').replace('start + page_size - 1', 'start + page_size'));
      }
      const gateway = await engine.openGateway(workspace, undefined, { provider: { api: 'openai-chat',
        baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: 'synthetic-smoke-key' }, model: 'replay',
        contextWindow: 8192, maxOutputTokens: 256, budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } });
      const response = await fetch(`${gateway.connection.baseURL}/chat/completions`, { method: 'POST',
        headers: { authorization: `Bearer ${gateway.connection.sessionToken}` }, body: '{"model":"replay","legacySeed":true}' });
      assert.equal(response.status, 200); await response.text(); await gateway.close();
      attempts.push({ id, workspace, attempt: id === 'dedupe-ids' ? 3 : 1, report: await engine.submitTask(packRoot, workspace) });
    }
  } finally {
    await engine.close();
    if (originalDataDir === undefined) delete process.env.FACTORYZE_DATA_DIR;
    else process.env.FACTORYZE_DATA_DIR = originalDataDir;
  }
  const db = new DatabaseSync(join(root, 'engine/usage.sqlite'));
  db.prepare('UPDATE practice_workspaces SET task_json=NULL WHERE task_id=?').run('dedupe-ids');
  const stored = JSON.parse(db.prepare('SELECT task_json FROM practice_workspaces WHERE task_id=?').get('pagination-api').task_json);
  delete stored.retired;
  db.prepare('UPDATE practice_workspaces SET task_json=? WHERE task_id=?').run(JSON.stringify(stored), 'pagination-api');
  db.close(); return { attempts, draft };
};

try {
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));

  // Launch opens Home. Nothing is restored or started until the student chooses.
  let page = await launch();
  await home(page).getByRole('heading', { name: 'Practice tasks', exact: true }).waitFor();
  await home(page).getByRole('heading', { name: 'Find a task to practice', exact: true }).waitFor();
  await home(page).getByRole('searchbox', { name: 'Search practice tasks' }).waitFor();
  // First launch: three starters lead the page until a result exists, so the first starter is what must show without scrolling.
  // Measured before the catalog is used, because clicking a topic chip scrolls the page down to the catalog.
  await home(page).getByRole('heading', { name: 'Pick your first bug', exact: true }).waitFor();
  assert.deepEqual(await home(page).locator('.fz-starter h3').allTextContents(), ['Delivery fee', 'Duplicate customers', 'Latency report']);
  await home(page).getByRole('button', { name: 'Start with Delivery fee', exact: true }).waitFor();
  const firstTaskViewport = await home(page).locator('.fz-starter').first().evaluate(node => {
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, viewportHeight: innerHeight };
  });
  assert.ok(firstTaskViewport.top >= 0 && firstTaskViewport.bottom <= firstTaskViewport.viewportHeight,
    `The first starter task should be visible without scrolling: ${JSON.stringify(firstTaskViewport)}`);
  await home(page).getByRole('button', { name: 'SRE 1', exact: true }).click();
  await waitForTaskTitles(page, ['Stop a retry storm']);
  await home(page).getByRole('button', { name: 'All problems', exact: true }).click();
  await waitForTaskTitles(page, ['Delivery fee', 'Duplicate customers', 'Latency report', 'Library fines', 'Login lockout', 'Monthly revenue report', 'Read a Linux process snapshot', 'Stop a retry storm', 'Guard a webhook allowlist']);
  await page.screenshot({ path: join(output, 'home-catalog-compact.png') });
  const taskSearch = home(page).getByRole('searchbox', { name: 'Search practice tasks' });
  await taskSearch.fill('revenue');
  await waitForTaskTitles(page, ['Monthly revenue report']);
  await taskSearch.fill('');
  await waitForTaskTitles(page, ['Delivery fee', 'Duplicate customers', 'Latency report', 'Library fines', 'Login lockout', 'Monthly revenue report', 'Read a Linux process snapshot', 'Stop a retry storm', 'Guard a webhook allowlist']);
  await taskSearch.fill('linux');
  await home(page).getByRole('button', { name: 'Start Read a Linux process snapshot' }).click();
  await page.locator('.fz-dialog').getByText('Linux procfs process records', { exact: false }).waitFor();
  await page.locator('.fz-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await taskSearch.fill('');
  await taskSearch.fill('retry');
  await home(page).getByRole('button', { name: 'Start Stop a retry storm' }).click();
  await page.locator('.fz-dialog').getByText('Helpful background', { exact: true }).waitFor();
  await page.locator('.fz-dialog').getByText('HTTP response status codes', { exact: false }).waitFor();
  await page.locator('.fz-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await taskSearch.fill('');
  assert.equal(await home(page).getByRole('button', { name: /^Start (Stable customer IDs|Pagination API)$/ }).count(), 0);
  assert.ok(['', '#'].includes(new URL(page.url()).hash), 'Launch must not open an attempt');
  assert.equal(await page.locator('.fz-agent:visible').count(), 0, 'Home has no agent pane');
  await home(page).getByText('When you submit an attempt, its report appears here.', { exact: true }).waitFor();
  await home(page).getByRole('button', { name: 'Open task folder…', exact: true }).waitFor();
  await home(page).getByRole('button', { name: 'Open task ZIP…', exact: true }).waitFor();
  assert.equal(await page.getByText(/OpenCode/).count(), 0, 'Factoryze no longer mentions OpenCode');
  await page.screenshot({ path: join(output, 'home.png') });
  const homeWindow = await app.browserWindow(page);
  // Hosted desktops may cap the outer window below the requested size.
  await homeWindow.evaluate(window => window.setContentSize(900, 600));
  await page.waitForFunction(() => innerWidth >= 800 && innerHeight >= 550);
  await page.screenshot({ path: join(output, 'home-wide.png') });
  await homeWindow.evaluate(window => window.setContentSize(683, 512));
  await page.waitForFunction(() => innerWidth === 683 && innerHeight === 512);

  // Start sheet: Python check, then the attempt opens in the same window with its starter file.
  const initialWindows = app.windows().length;
  await startTask(page, 'Library fines');
  await attemptOpened(page, 'library-fines-');
  assert.equal(app.windows().length, initialWindows, 'Starting a task must keep the same window');
  await page.locator('.monaco-editor').first().waitFor();
  await page.locator('.fz-attempt-title').getByText('Attempt 1', { exact: true }).waitFor();
  await runTests(page, '5 of 5 public tests passed');
  console.log('Started an attempt from Home; starter file opened; public tests ran.');

  // Approve an edit shown as a unified diff, then submit for a report.
  await send(page, 'Read library/returns.py. Use clock.local_day for branch-local return dates. Make the edit for my approval.');
  await page.locator('.fz-approval .fz-diff .fz-add').first().waitFor();
  await pill(page).getByText('Waiting for you', { exact: true }).waitFor();
  assert.equal(await page.locator('.fz-step .fz-what').filter({ hasText: /\/private|\/var\/|[A-Z]:\\/ }).count(), 0, 'Tool rows show paths relative to the attempt');
  await page.screenshot({ path: join(output, 'approval.png') });
  await page.locator('.fz-approval').getByRole('button', { name: 'Approve', exact: true }).click();
  await turnDone(page);
  await page.locator('.fz-turn .fz-cost').getByText(/^\d[\d,]* tokens$/).first().waitFor();
  await submitAttempt(page);
  await page.locator('.fz-report-result-number').getByText('9 / 9', { exact: true }).waitFor();
  await page.locator('.fz-report-share').getByRole('heading', { name: 'Share your result', exact: true }).waitFor();
  assert.equal(await page.locator('.fz-report-share').getByRole('link', { name: 'Share on Facebook' }).count(), 0, 'Unpublished reports expose no social link');
  await page.locator('.fz-report-next').getByRole('heading', { name: 'What next?', exact: true }).waitFor();
  await page.locator('.fz-report-next').getByRole('button', { name: 'Keep working', exact: true }).waitFor();
  assert.ok((await page.locator('.fz-report-view').boundingBox()).width >= 600, 'Attempt reports use the full main area');
  assert.equal(await page.locator('.fz-report-check-segment').count(), 9);
  await page.getByRole('button', { name: 'View all 9 checks', exact: true }).click();
  const checkDetails = page.getByRole('dialog', { name: 'Hidden-check details', exact: true });
  await checkDetails.getByText('Evening return on due date is on time at riverside', { exact: true }).waitFor();
  await checkDetails.getByRole('button', { name: 'Close details', exact: true }).click();
  assert.ok((await page.locator('.fz-report-view').boundingBox()).width >= 600, 'Closing check details keeps the report expanded');
  assert.equal(await page.locator('.fz-prompts .fz-tag, .fz-report-advice').count(), 0);
  await page.locator('.fz-prompts .fz-text').getByText(/Use clock.local_day for branch-local return dates/).waitFor();
  await page.getByRole('heading', { name: 'Activity and token usage', exact: true }).waitFor();
  await page.getByText('Saved with this submission', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'report-overview.png') });
  await page.getByText('Recorded agent settings', { exact: true }).click();
  await page.getByText('factoryze@0.1.0', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'report.png') });
  const workspace = newest('library-fines-');
  assert.equal(readFileSync(join(workspace, 'library/returns.py'), 'utf8'), source);
  assert.match(readFileSync(join(workspace, '.venv', process.platform === 'win32' ? 'pip.ini' : 'pip.conf'), 'utf8'), /index-url = http:\/\/127.0.0.1:/);
  db = new DatabaseSync(join(root, 'engine/usage.sqlite'));
  let report = JSON.parse(db.prepare('SELECT report FROM practice_reports ORDER BY id DESC LIMIT 1').get().report);
  assert.deepEqual(report.executionPins, [{ profile: 'factoryze@0.1.0', model: 'replay', providerHost: `127.0.0.1:${upstream.address().port}`, temperature: 0, os: process.platform }]);
  assert.equal(report.promptAssessments[0].acceptedEdit, true);
  assert.equal(report.workspaceUsage[0].weighted, modelCalls * 14);
  assert.equal(report.workspaceUsage[0].promptTurns, 1);
  const firstSubmission = structuredClone(report);
  assert.equal(report.insights.coverage, 'recorded');
  assert.equal(report.insights.prompts.length, 1);
  assert.equal(report.insights.prompts[0].weighted, report.workspaceUsage[0].weighted);
  assert.ok(report.insights.tools.exploration > 0);
  assert.ok(report.insights.tools.editing > 0);
  assert.equal(report.insights.attribution.reduce((sum, bucket) => sum + bucket.weighted, 0), report.workspaceUsage[0].weighted);
  assert.equal(report.checks.length, 9); assert.ok(report.checks.every(check => check.passed));
  assert.ok(judgeCalls >= 1);
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  assert.equal(await page.locator('.theia-maximized').count(), 0, 'Keep working restores the previous pane layout');

  // The title bar meter: one segment per prompt, and the popover separates input, cached input and output.
  await budgetText(page).getByText(`${report.workspaceUsage[0].weighted} of 100 tokens`, { exact: true }).waitFor();
  assert.match(await page.locator('.fz-budget-btn .fz-seg:not(.fz-rest)').last().getAttribute('data-tip'), /^Prompt 1 used \d+ tokens$/);
  const meters = await popover(page);
  assert.equal(meters.Input, report.workspaceUsage[0].raw.input);
  assert.equal(meters.Output, report.workspaceUsage[0].raw.output);
  assert.equal(meters['Cached input, counted at a tenth'], 0);
  await page.screenshot({ path: join(output, 'budget-meter.png') });

  // Exhausting the budget pauses the agent; New session cannot bypass it; raising it is recorded.
  await send(page, 'BUDGET_PROBE: Say Done; do not call tools.');
  await page.locator('.fz-banner').getByText('Token budget used up', { exact: true }).waitFor();
  await pill(page).getByText('Paused', { exact: true }).waitFor();
  const callsAtLimit = modelCalls;
  await newSession(page);
  await page.locator('.fz-banner').getByText('Token budget used up', { exact: true }).waitFor();
  assert.equal(await page.locator('.fz-composer button[type=submit]').isDisabled(), true);
  assert.equal(modelCalls, callsAtLimit);
  await page.screenshot({ path: join(output, 'budget-used-up.png') });
  await page.locator('.fz-banner').getByRole('button', { name: 'Raise budget', exact: true }).click();
  await page.locator('.fz-dialog').getByLabel('New budget, in tokens').fill('5000');
  await page.locator('.fz-dialog').getByRole('button', { name: 'Raise budget', exact: true }).click();
  await page.locator('.fz-banner').waitFor({ state: 'detached' });
  await pill(page).getByText('Ready', { exact: true }).waitFor();
  assert.equal(modelCalls, callsAtLimit, 'Raising the budget makes no model request');
  await submitAttempt(page);
  await page.locator('.fz-report-head select').waitFor();
  assert.equal(await page.locator('.fz-report-head select').inputValue(), '2');
  await page.getByText(/You raised the limit from 100 to 5,000 tokens/).waitFor();
  report = JSON.parse(db.prepare('SELECT report FROM practice_reports ORDER BY id DESC LIMIT 1').get().report);
  assert.deepEqual(report.budget, { limit: 5000, initialLimit: 100 });
  await page.locator('.fz-report-head select').selectOption('1');
  await page.waitForFunction(() => document.querySelector('.fz-report-head select')?.value === '1' && document.querySelectorAll('.fz-prompts li').length === 1);
  await page.locator('.fz-prompts li').first().waitFor();
  assert.equal(await page.locator('.fz-prompts li').count(), 1, 'Earlier submission retains its original prompt snapshot');
  assert.equal(await page.locator('.fz-prompts .fz-tok').innerText(), `${firstSubmission.insights.prompts[0].weighted} tokens`);
  assert.deepEqual(JSON.parse(db.prepare('SELECT report FROM practice_reports WHERE workspace=? ORDER BY id LIMIT 1').get(workspace).report), firstSubmission);
  await page.locator('.fz-report-head select').selectOption('2');
  await page.waitForFunction(() => document.querySelector('.fz-report-head select')?.value === '2');
  console.log('Approved report design: full-width result, nine segments, check modal, no suggestions/grades, pane restoration and saved submission costs verified.');
  console.log('Budget refusal survived New session; raised budget recorded on the second submission.');

  // Relaunch shows Home, not the attempt. Results and Continue come from saved data.
  await app.close(); app = undefined;
  const { attempts: retiredAttempts, draft: retiredDraft } = await seedRetiredAttempts();
  page = await launch();
  await home(page).getByRole('heading', { name: 'Continue', exact: true }).waitFor();
  assert.ok(['', '#'].includes(new URL(page.url()).hash), 'Relaunch must return to Home');
  assert.equal(await home(page).locator('.fz-results tbody tr').count(), 4);
  await page.screenshot({ path: join(output, 'relaunch-home.png') });
  await home(page).locator('.fz-results tbody tr').filter({ hasText: 'Library fines' }).first().click();
  await page.locator('.fz-overlay .fz-report-result-number').getByText('9 / 9', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'report-from-home.png') });
  await page.locator('.fz-overlay').getByRole('button', { name: 'Home', exact: true }).click();

  assert.equal(await home(page).getByRole('button', { name: 'Continue Stable customer IDs, attempt 1', exact: true }).count(), 0);
  await home(page).getByRole('button', { name: 'Show all attempts', exact: true }).click();
  await home(page).getByRole('button', { name: 'Continue Stable customer IDs, attempt 1', exact: true }).click();
  await attemptOpened(page, 'dedupe-ids-');
  assert.equal(realpathSync.native(workbenchWorkspacePath(page.url())), retiredDraft);
  assert.match(readFileSync(join(retiredDraft, 'app/dedupe.py'), 'utf8'), /Preserved older draft/);
  await goHome(page);

  // Retirement only hides new-task cards. Earlier attempts, meters and every submission remain available.
  for (const { id, workspace: oldWorkspace, attempt, report: previous } of retiredAttempts) {
    const title = id === 'dedupe-ids' ? 'Stable customer IDs' : 'Pagination API';
    await home(page).getByRole('button', { name: `Continue ${title}, attempt ${attempt}`, exact: true }).click();
    await attemptOpened(page, `${id}-`);
    const counts = await popover(page);
    assert.equal(counts.Input, 10); assert.equal(counts.Output, 4);
    await submitAttempt(page);
    const saved = JSON.parse(db.prepare('SELECT report FROM practice_reports WHERE workspace=? ORDER BY id DESC LIMIT 1').get(oldWorkspace).report);
    assert.deepEqual(saved.correctness, previous.correctness);
    assert.equal(saved.workspaceUsage[0].weighted, 14);
    assert.deepEqual(JSON.parse(db.prepare('SELECT report FROM practice_reports WHERE workspace=? ORDER BY id LIMIT 1').get(oldWorkspace).report), previous);
    await page.getByRole('button', { name: 'Keep working', exact: true }).click(); await goHome(page);
    assert.equal(await home(page).locator('.fz-results tbody tr').filter({ hasText: title }).count(), 2);
  }
  await page.screenshot({ path: join(output, 'retired-attempts.png') });
  console.log('Retired tasks stay hidden from Practice; earlier attempts, usage, reports and resubmission survive.');
  if (!await home(page).getByRole('button', { name: 'Continue Library fines, attempt 1', exact: true }).count())
    await home(page).getByRole('button', { name: 'Show all attempts', exact: true }).click();
  await home(page).getByRole('button', { name: 'Continue Library fines, attempt 1', exact: true }).click();
  await attemptOpened(page, 'library-fines-');
  await budgetText(page).getByText(/ of 5,000 tokens$/).waitFor();

  // The terminal uses the engine's package index.
  // The restored layout can open the bottom pane with Tests in front of the terminal. Pane toggles must carry
  // that state from the moment they appear; a stale "Show" made this step close the pane on slower Windows runners.
  assert.match(String(await page.evaluate(() => window.__factoryzeInsertedPaneState)), /^(true|false)$/, 'Pane toggles carry their state when the toolbar is inserted');
  const terminalToggle = page.locator('.fz-toggles [data-pane=bottom]');
  // Waits until the toggle and the real pane agree; `expected` narrows it to one state.
  const bottomToggleMatches = (expected = undefined) => page.waitForFunction(expected => {
    const panel = document.getElementById('theia-bottom-content-panel');
    const shown = String(!!panel && panel.offsetParent !== null);
    return document.querySelector('.fz-toggles [data-pane=bottom]')?.getAttribute('aria-pressed') === shown && (!expected || shown === expected);
  }, expected);
  await bottomToggleMatches();
  // Close the pane if it's open, so reopening it brings the terminal forward.
  if (await terminalToggle.getAttribute('aria-pressed') === 'true') { await terminalToggle.click(); await bottomToggleMatches('false'); }
  await terminalToggle.click();
  const terminal = page.locator('.xterm-helper-textarea').last();
  await terminal.waitFor({ state: 'attached' }); await terminal.focus();
  // The terminal starts in the workspace. A relative program path works the same in cmd.exe (Theia's Windows
  // default), PowerShell and bash; a leading `&` or a quoted program path does not.
  const venvPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const python = join(workspace, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'); // the ZIP fixture below runs it directly
  const command = `${venvPython} -c "import os,pathlib; pathlib.Path('pip-index-smoke.txt').write_text(os.environ.get('PIP_INDEX_URL','missing'))"`;
  // xterm draws on a canvas, so give the shell a moment to start; retry once if a slow shell drops the first line.
  const pinFile = join(workspace, 'pip-index-smoke.txt');
  for (let attempt = 0; attempt < 2 && !existsSync(pinFile); attempt++) {
    await page.waitForTimeout(2000); await terminal.focus(); await page.keyboard.type(command); await page.keyboard.press('Enter');
    for (let wait = 0; !existsSync(pinFile) && wait < 150; wait++) await new Promise(resolve => setTimeout(resolve, 100));
  }
  const terminalIndex = readFileSync(pinFile, 'utf8');
  assert.match(terminalIndex, /^http:\/\/127.0.0.1:\d+\/simple\/$/);
  assert.equal((await fetch(terminalIndex)).status, 200);

  // Start sheet budget change, then Stop interrupts a prompt whose judge request is still waiting.
  await goHome(page);
  await startTask(page, 'Monthly revenue report', 2000);
  await attemptOpened(page, 'monthly-revenue-');
  await budgetText(page).getByText('0 of 2,000 tokens', { exact: true }).waitFor();
  await send(page, 'STOP_PROBE: Inspect promotions.py before suggesting a change.');
  let stopTimeout;
  try { await Promise.race([stopJudgeEntered, new Promise((_, reject) => { stopTimeout = setTimeout(() => reject(new Error('Judge did not start')), 15_000); })]); }
  finally { clearTimeout(stopTimeout); }
  await page.locator('.fz-composer').getByRole('button', { name: 'Stop', exact: true }).click();
  await pill(page).getByText('Ready', { exact: true }).waitFor();
  assert.equal(await page.locator('.fz-composer button[type=submit]').isEnabled(), true);
  await page.screenshot({ path: join(output, 'stopped.png') });

  // Folder and ZIP imports go through the real file-dialog action and importer; only the native picker answer is substituted.
  const taskFixture = (id, limit) => {
    const folder = join(root, id); mkdirSync(join(folder, 'workspace/app'), { recursive: true }); mkdirSync(join(folder, 'workspace/tests'), { recursive: true }); mkdirSync(join(folder, 'tests/hidden'), { recursive: true });
    writeFileSync(join(folder, 'task.yaml'), `schema: 1\nid: ${id}\ntitle: ${id}\nbrief: Return the answer.\nminimumPython: "3.11"\nentryFile: app/main.py\nbudgetTokens: ${limit}\n`);
    writeFileSync(join(folder, 'workspace/app/main.py'), 'def answer(): return 42\n');
    const check = 'from app.main import answer\ndef test_answer(): assert answer() == 42\n';
    writeFileSync(join(folder, 'workspace/tests/test_main.py'), check); writeFileSync(join(folder, 'tests/hidden/test_main.py'), check); return folder;
  };
  const folderTask = taskFixture('folder-assessment', 42), zipSource = taskFixture('zip-assessment', 84), zipTask = join(root, 'assessment.zip');
  execFileSync(python, ['-c', 'import sys,pathlib,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED); [z.write(f, f.relative_to(p.parent)) for f in p.rglob("*") if f.is_file()]; z.close()', zipSource, zipTask]);
  for (const [selection, id, limit, zip] of [[folderTask, 'folder-assessment', 42, false], [zipTask, 'zip-assessment', 84, true]]) {
    await goHome(page);
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, selection);
    await home(page).getByRole('button', { name: zip ? 'Open task ZIP…' : 'Open task folder…', exact: true }).click();
    await attemptOpened(page, `${id}-`);
    assert.equal(app.windows().length, initialWindows, 'Task import must preserve the window');
    await budgetText(page).getByText(`0 of ${limit} tokens`, { exact: true }).waitFor();
    await page.locator('.fz-brief').getByText(`${limit} tokens`, { exact: true }).waitFor();
    assert.equal(existsSync(join(newest(`${id}-`), 'tests/hidden')), false);
    await runTests(page, '1 of 1 public test passed');
    await submitAttempt(page);
    await page.locator('.fz-report-result-number').getByText('1 / 1', { exact: true }).waitFor();
  }
  db.close(); db = undefined;
  console.log('Folder and ZIP tasks imported and graded in the same window.');

  // Keychain mode with no model: Home asks to connect; an attempt keeps the draft while Settings connects a model.
  page = await relaunch(true);
  await home(page).getByRole('heading', { name: 'Want an AI assistant?', exact: true }).waitFor();
  await page.locator('.fz-chip').getByText('No model connected', { exact: true }).waitFor();

  const callsBeforeSetup = modelCalls;
  await startTask(page, 'Monthly revenue report');
  await attemptOpened(page, 'monthly-revenue-');
  harnessWorkspace = realpathSync.native(workbenchWorkspacePath(page.url()));
  await page.locator('.fz-agent-empty').getByText('Connect a model to use the agent', { exact: true }).waitFor();
  const draft = 'SETUP_DRAFT: Say Done without calling tools.';
  await send(page, draft);
  await page.locator('.fz-settings').waitFor();
  await page.locator('.fz-settings-header').getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.locator('.fz-settings-layout').waitFor();
  const settingsLayout = await page.locator('.fz-settings').evaluate(node => ({
    content: node.getBoundingClientRect().width,
    layout: node.querySelector('.fz-settings-layout').getBoundingClientRect().width,
    primary: node.querySelector('.fz-settings-primary').getBoundingClientRect().width,
    headerHeight: node.querySelector('.fz-settings-header').getBoundingClientRect().height,
  }));
  if (settingsLayout.content < 720) {
    assert.ok(settingsLayout.primary >= settingsLayout.layout * .8, 'Settings uses one column in a narrow editor pane');
    assert.ok(settingsLayout.headerHeight < 170, 'Settings header stays compact in a narrow editor pane');
  }
  await page.screenshot({ path: join(output, 'settings-overview.png') });
  assert.equal(await prompt(page).inputValue(), draft, 'The draft stays in the composer during setup');
  assert.equal(modelCalls, callsBeforeSetup);
  await page.locator('.fz-settings').getByRole('button', { name: 'Connect a model', exact: true }).click();
  const connect = page.locator('.fz-dialog');
  await connect.getByText('Another OpenAI-compatible service', { exact: true }).click();
  await connect.getByLabel('Base URL', { exact: true }).fill(`http://127.0.0.1:${upstream.address().port}/v1`);
  await connect.getByLabel('API key', { exact: true }).fill('synthetic-smoke-key');
  await connect.getByLabel('Model ID', { exact: true }).fill('replay');
  await connect.getByText('Model limits and sampling', { exact: true }).click();
  assert.equal(await connect.getByLabel('Temperature', { exact: true }).inputValue(), '', 'Existing default stays unset');
  await connect.getByLabel('Temperature', { exact: true }).fill('2.5');
  await connect.getByRole('button', { name: 'Save connection', exact: true }).click();
  await connect.getByText('Enter a temperature from 0 to 2, or leave it blank for the provider default.', { exact: true }).waitFor();
  assert.equal(modelCalls, callsBeforeSetup, 'Invalid settings make no model request');
  await connect.getByLabel('Temperature', { exact: true }).fill('0.25');
  await page.screenshot({ path: join(output, 'connect-model.png') });
  await connect.getByRole('button', { name: 'Save connection', exact: true }).click();
  expectedTemperature = 0.25;
  await connect.waitFor({ state: 'detached' });
  await page.locator('.fz-settings .fz-kv').getByText(`http://127.0.0.1:${upstream.address().port}/v1`, { exact: true }).waitFor();
  await page.locator('.fz-settings .fz-kv').getByText('0.25', { exact: true }).waitFor();
  await page.locator('.fz-agent-model').getByText('replay', { exact: true }).waitFor();
  assert.equal(modelCalls, callsBeforeSetup, 'Saving a connection makes no model request');
  await page.locator('.fz-settings').getByRole('button', { name: 'Back', exact: true }).click();
  turnsBeforeSend = await page.locator('.fz-turn').count();
  await page.locator('.fz-composer button[type=submit]').click();
  await turnDone(page);
  assert.ok(modelCalls > callsBeforeSetup);
  console.log('Connected a model from Settings; the retained draft was sent and metered.');

  // The harness reads, edits and runs a command, each edit and command approved by the student.
  await send(page, 'HARNESS_PROBE: Read billing/promotions.py, add a comment for my approval, then run python -m unittest for my approval.');
  await page.locator('.fz-approval .fz-diff').last().waitFor();
  await page.locator('.fz-approval').last().getByRole('button', { name: 'Approve', exact: true }).click();
  await page.locator('.fz-approval .fz-cmd').getByText('python -m unittest', { exact: true }).waitFor();
  await page.locator('.fz-approval').last().getByRole('button', { name: 'Run', exact: true }).click();
  await turnDone(page);
  assert.equal(harnessCalls, 4, 'Only the explicit coding loop makes model requests');
  assert.match(readFileSync(join(harnessWorkspace, 'billing/promotions.py'), 'utf8'), /Factoryze harness approved edit/);
  await page.screenshot({ path: join(output, 'factoryze-harness.png') });
  await send(page, 'BUDGET_PROBE: Say done.');
  await page.locator('.fz-banner').getByText('Token budget used up', { exact: true }).waitFor();
  const exhaustedCalls = modelCalls;
  const exhaustedMeters = await popover(page);
  page = await relaunch(true);
  await home(page).locator('.fz-continue').first().getByRole('button', { name: /^Continue Monthly revenue report, attempt 2$/ }).click();
  await attemptOpened(page, 'monthly-revenue-');
  await page.locator('.fz-banner').getByText('Token budget used up', { exact: true }).waitFor();
  assert.equal(modelCalls, exhaustedCalls, 'Reopening an exhausted attempt makes no model request');
  console.log('Exhausted budget persisted across restart; reopening the attempt made no request.');

  // A new attempt of the same task starts with zero usage and its own budget; the earlier attempt keeps its counts.
  await goHome(page);
  await startTask(page, 'Monthly revenue report');
  await attemptOpened(page, 'monthly-revenue-');
  await page.locator('.fz-attempt-title').getByText('Attempt 3', { exact: true }).waitFor();
  await budgetText(page).getByText('0 of 2,000 tokens', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'fresh-attempt.png') });
  const callsBeforeFresh = modelCalls;
  await send(page, 'FRESH_RUN: Say done without tools.');
  await turnDone(page);
  assert.equal(modelCalls, callsBeforeFresh + 1);
  await budgetText(page).getByText('14 of 2,000 tokens', { exact: true }).waitFor();
  page = await relaunch(true);
  await home(page).getByRole('button', { name: 'Continue Monthly revenue report, attempt 3', exact: true }).click();
  await attemptOpened(page, 'monthly-revenue-');
  await budgetText(page).getByText('14 of 2,000 tokens', { exact: true }).waitFor();
  const freshMeters = await popover(page);
  assert.equal(freshMeters.Input, 10); assert.equal(freshMeters.Output, 4);
  await goHome(page);
  await home(page).getByRole('button', { name: 'Continue Monthly revenue report, attempt 2', exact: true }).click();
  await attemptOpened(page, 'monthly-revenue-');
  assert.deepEqual(await popover(page), exhaustedMeters, 'The earlier attempt keeps its usage');
  assert.equal(modelCalls, callsBeforeFresh + 1);

  // Forgetting the connection returns the chip and Home to the setup state.
  await goHome(page);
  await page.locator('.fz-chip').click();
  await page.locator('.fz-settings').getByRole('button', { name: 'Forget connection', exact: true }).click();
  await page.locator('.fz-settings').getByText('No model connected', { exact: true }).waitFor();
  await page.locator('.fz-chip').getByText('No model connected', { exact: true }).waitFor();

  // Appearance: Dark switches the whole window through Theia's theme, survives a relaunch, and Match system follows the OS.
  const bodyTheme = () => page.evaluate(() => document.body.classList.contains('theia-dark') ? 'dark' : 'light');
  await page.locator('.fz-settings').getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.waitForFunction(() => document.body.classList.contains('theia-dark'));
  assert.notEqual(await page.locator('#factoryze-settings').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(247, 248, 248)', 'Factoryze pages follow the dark theme');
  await page.screenshot({ path: join(output, 'settings-dark.png') });
  page = await relaunch(true);
  await home(page).getByRole('heading', { name: 'Practice tasks', exact: true }).waitFor();
  assert.equal(await bodyTheme(), 'dark', 'Dark appearance persists after relaunch');
  await page.screenshot({ path: join(output, 'home-dark.png') });
  await home(page).getByRole('button', { name: 'Continue Monthly revenue report, attempt 3', exact: true }).click();
  await attemptOpened(page, 'monthly-revenue-');
  assert.equal(await bodyTheme(), 'dark');
  await page.screenshot({ path: join(output, 'attempt-dark.png') });
  await page.locator('.fz-tb-attempt').getByRole('button', { name: 'Home', exact: true }).click();
  await home(page).waitFor();
  await page.locator('.factoryze-metrics').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.fz-settings').getByRole('radio', { name: 'Match system', exact: true }).click();
  const systemDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await page.waitForFunction(dark => document.body.classList.contains('theia-dark') === dark, systemDark);

  const result = { passed: true, platform: process.platform, modelCalls, judgeCalls, approvedEdit: true, correctness: report.correctness,
    reportExecutionPins: true, reportLearning: true, savedPromptCosts: true,
    approvedReportDesign: true, reportCheckModal: true, reportSuggestionsAbsent: true, reportPromptScoresAbsent: true,
    temperatureConfiguration: true, temperatureOnEveryModelStep: true,
    agentRunsPublicTestsInNativeShell: true,
    titleBarSurvivesWorkspaceReloads: true,
    titleBarControlsAccessible: true,
    compactWindow: { width: 683, height: 512 },
    promotedPracticeTasks: true, retiredAttemptsContinue: true, retiredReportsPreserved: true, retiredResubmission: true,
    retiredUsagePreserved: true, olderRetiredDraftReachable: true, legacyModelCalls,
    launchOpensHome: true, relaunchOpensHome: true, startSheetPythonCheck: true, startSheetBudgetChange: true, continueFromHome: true,
    reportsFromHome: true, multipleSubmissions: true, budgetRaiseRecorded: true, hiddenCheckNames: true, promptTextInReport: true,
    relativeToolPaths: true, unifiedDiffApproval: true, perPromptBudgetSegments: true, separateInputOutputMeters: true,
    freshAttemptMetersReset: true, freshAttemptPersistsAfterRestart: true, previousAttemptUsagePreserved: true,
    factoryzeHarness: { requests: harnessCalls, readEditShell: true, diffAndShellApproved: true, budgetPersistsAfterRestart: true },
    budgetEnforcedAfterNewSession: true, terminalUsesEngineIndex: true, paneTogglesCarryStateOnLoad: true, stopCancelsJudge: true, singleWindowAttempts: true,
    folderImport: true, zipImport: true, draftRetainedDuringSetup: true, keychainSetupEnablesSend: true, forgetConnection: true,
    publicTestsRun: true, starterFileOpened: true, noOpenCodeInUi: true, darkAppearance: true, appearancePersists: true, matchSystemAppearance: true,
    toolbarOverlapsAfterLoad };
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} catch (error) {
  writeFileSync(join(output, 'diagnostics.log'), diagnostics);
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: false, platform: process.platform, error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  await lastPage?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (lastPage && !lastPage.isClosed()) console.error((await lastPage.locator('body').innerText()).slice(-10_000));
  throw error;
} finally {
  db?.close();
  if (credentialMode && app && process.platform === 'darwin') {
    try { execFileSync('security', ['delete-generic-password', '-s', 'Factoryze Solo Provider', '-a', credentialAccount], { stdio: 'ignore' }); } catch { /* Forget connection already removed it. */ }
  }
  await app?.close().catch(() => {});
  if (process.platform === 'darwin' && executablePath === defaultExecutable) {
    // A development smoke run must not leave its build copy in app search.
    try { execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', resolve(dirname(executablePath), '../..')]); } catch { /* Keep original test outcome. */ }
  }
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
