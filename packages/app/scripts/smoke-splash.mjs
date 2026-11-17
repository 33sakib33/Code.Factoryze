import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const executablePath = join(repo, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app/Contents/MacOS/Factoryze');
const root = mkdtempSync(join(tmpdir(), 'factoryze-splash-smoke-'));
const env = { ...process.env, THEIA_CONFIG_DIR: join(root, 'theia'), FACTORYZE_DATA_DIR: join(root, 'engine'),
  FACTORYZE_CREDENTIAL_ACCOUNT: 'splash-smoke', FACTORYZE_PRACTICE_SESSIONS_DIR: join(root, 'workspaces'), FACTORYZE_TRIAL_URL: 'http://127.0.0.1:1' };
for (const key of Object.keys(env)) if (key.startsWith('FACTORYZE_PROVIDER_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];

let app;
const samples = [];
try {
  app = await _electron.launch({ executablePath, args: [`--user-data-dir=${join(root, 'electron')}`, `--electronUserData=${join(root, 'electron')}`, '--no-sandbox'], env, timeout: 60_000 });
  let sampling = false;
  const collect = async () => {
    if (sampling) return;
    sampling = true;
    try {
      for (const page of app.windows()) {
        if (page.isClosed() || !page.url().endsWith('/factoryze.svg')) continue;
        const width = Number(await page.locator('#fz-splash-fill').getAttribute('width', { timeout: 250 }).catch(() => NaN));
        const label = await page.locator('#fz-splash-status').textContent({ timeout: 250 }).catch(() => null);
        if (Number.isFinite(width) && label) samples.push({ width, label });
      }
    } finally { sampling = false; }
  };
  const timer = setInterval(() => void collect(), 25);
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      await collect();
      for (const page of app.windows()) {
        if (!page.isClosed() && await page.locator('.factoryze-metrics').count().catch(() => 0)) ready = true;
      }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'The workbench should open');
    await new Promise(resolve => setTimeout(resolve, 600));
  } finally { clearInterval(timer); }
  assert.ok(samples.length > 0, 'The splash should render its progress display');
  assert.ok(samples.some(sample => sample.width > 0), 'The bar should advance after a real startup milestone');
  assert.ok(samples.some(sample => sample.label !== 'Starting Factoryze'), 'The status should name a completed startup milestone');
  console.log(JSON.stringify({ passed: true, stages: [...new Set(samples.map(sample => sample.label))], maxWidth: Math.max(...samples.map(sample => sample.width)) }));
} finally {
  await app?.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}
