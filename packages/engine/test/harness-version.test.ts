import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as harness from '../src/harness.ts';

test('instructions, tool definitions and execution limits require a new harness version when changed', () => {
  // Never update an existing entry to bless a behavior change. Bump FACTORYZE_PROFILE and add an entry.
  const fingerprints: Record<string, string> = { 'factoryze@0.1.0': '060485024c76a297e34cb5056c9b43536cc19037c4e292742ca72fdc53115c14' };
  assert.ok('harnessBehavior' in harness, 'The guard must fingerprint the configuration used at runtime');
  const fingerprint = createHash('sha256').update(JSON.stringify(harness.harnessBehavior)).digest('hex');
  assert.equal(fingerprint, fingerprints[harness.FACTORYZE_PROFILE], 'Harness behavior changed: bump the profile version before recording new baselines');
});
