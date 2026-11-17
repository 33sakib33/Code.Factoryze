import assert from 'node:assert/strict';
import test from 'node:test';
import { labClientConfigSchema, labCreateSchema, labJoinRequestSchema } from '../src/index.ts';

test('lab connection contracts require a pinned HTTPS origin and exclude credentials', () => {
  const config = { schema: 1, protocol: 1, baseURL: 'https://lab.example:9443', fingerprint: 'a'.repeat(64),
    certificate: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n' };
  assert.equal(labClientConfigSchema.safeParse(config).success, true);
  for (const baseURL of ['http://localhost:9443', 'https://user:password@lab.example', 'https://lab.example/path', 'https://lab.example/?token=x', 'https://lab.example/#x'])
    assert.equal(labClientConfigSchema.safeParse({ ...config, baseURL }).success, false);
  for (const patch of [{ apiKey: 'private' }, { operatorToken: 'private' }, { protocol: 2 }, { fingerprint: 'bad' }])
    assert.equal(labClientConfigSchema.safeParse({ ...config, ...patch }).success, false);
});

test('lab join and creation inputs exclude student-assigned roles, budget overrides and keys', () => {
  const join = { protocol: 1, lab: 'cs201', code: 'a'.repeat(16), studentId: 's1', profile: 'factoryze@0.1.0' };
  assert.equal(labJoinRequestSchema.safeParse(join).success, true);
  for (const patch of [{ role: 'admin' }, { budget: 999999 }, { model: 'changed' }, { studentId: '../another' }, { studentId: '=formula' }, { protocol: 0 }])
    assert.equal(labJoinRequestSchema.safeParse({ ...join, ...patch }).success, false);
  const lab = { schema: 1, config: { schema: 1, lab: 'cs201', task: 'library-fines', timeLimitMinutes: 60,
    agent: { profile: 'factoryze@0.1.0', model: 'synthetic', permissions: { edit: 'ask', shell: 'ask' } },
    budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } }, providerHost: 'provider.invalid', temperature: 0, roster: ['s1'] };
  assert.equal(labCreateSchema.safeParse(lab).success, true);
  for (const patch of [{ roster: ['s1', 's1'] }, { providerHost: 'https://user:key@provider.invalid/v1' }, { apiKey: 'private' }, { temperature: 1 }])
    assert.equal(labCreateSchema.safeParse({ ...lab, ...patch }).success, false);
});
