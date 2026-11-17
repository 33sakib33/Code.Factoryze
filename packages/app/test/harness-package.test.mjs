import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the desktop app packages and launches only the Factoryze harness', () => {
  const config = JSON.parse(readFileSync('packages/app/package.json', 'utf8'));
  assert.equal(config.build.extraResources.some(resource => resource.to === 'opencode'), false);
  assert.equal(config.scripts['package:installer'].includes('stage:opencode'), false);
  const backend = readFileSync('packages/app/extensions/core/src/node/agent-backend-service.ts', 'utf8');
  assert.equal(/opencode-session|opencode-binary|OpenCodeSession/.test(backend), false);
});

test('the desktop installer includes Factoryze and third-party license notices', () => {
  const config = JSON.parse(readFileSync('packages/app/package.json', 'utf8'));
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(config.build.extraResources.some(resource => resource.from === `../../${name}` && resource.to === name), `${name} must be in installer resources`);
  }
});
