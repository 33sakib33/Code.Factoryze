import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SoloEngine, soloSettings } from '../packages/engine/src/solo.ts';
import { HarnessSession } from '../packages/engine/src/harness.ts';
import { ModelSettingsStore } from '../packages/app/extensions/core/src/node/model-settings.ts';

// Explicit live check; this is not part of routine verification.
if (process.argv.includes('--help')) {
  console.log('Usage: pnpm spike:harness:live [--existing]\nMakes one billable model request. Agree a spending limit before running.\n--existing uses the saved Factoryze connection; otherwise uses backend environment variables.');
  process.exit(0);
}
const existing = process.argv.includes('--existing');
const selected = existing ? await new ModelSettingsStore().forEngine() : undefined;
if (existing && !selected) throw new Error('No saved Factoryze model connection is available');
const settings = selected ? { ...selected, maxOutputTokens: 128,
  budget: { ...selected.budget, limit: 20000 } }
  : { ...soloSettings(), agent: 'factoryze', maxOutputTokens: 128 };
const root = mkdtempSync(join(tmpdir(), 'factoryze-own-live-'));
const model = settings.model;
const options = { dataDir: join(root, 'data'), userId: 'synthetic-live-user', preparePython: async () => {}, settings };
let engine = new SoloEngine(options), harness;
try {
  const { workspace } = await engine.startTask(join(process.cwd(), 'tasks/practice'), 'library-fines', join(root, 'workspaces'));
  const gateway = await engine.openGateway(workspace);
  let text = '';
  harness = new HarnessSession({ gateway: gateway.connection, checkBudget: gateway.checkBudget,
    onUpdate: update => { if (update.sessionUpdate === 'agent_message_chunk') text += update.content.text; },
    execute: async () => { throw new Error('No tool should be necessary for a greeting'); } });
  await harness.start();
  const timeout = setTimeout(() => harness.stop(), 55000);
  try { assert.equal(await harness.prompt('hello. Reply briefly without tools.'), 'end_turn'); } finally { clearTimeout(timeout); }
  const totals = gateway.totals();
  assert.ok(text.trim()); assert.equal(totals.requests, 1); assert.equal(totals.incompleteRequests, 0); assert.ok(totals.weighted > 0);
  harness.stop(); await engine.close(); engine = new SoloEngine(options);
  const reopened = await engine.openGateway(workspace); assert.deepEqual(reopened.totals(), totals);
  console.log(JSON.stringify({ passed: true, profile: totals.scope.profile, model, requests: totals.requests, raw: totals.raw, weighted: totals.weighted,
    persistedAfterRestart: true, credentialSource: existing ? 'saved-factoryze-connection' : 'backend-environment' }));
} finally { harness?.stop(); await engine.close(); rmSync(root, { recursive: true, force: true }); }
