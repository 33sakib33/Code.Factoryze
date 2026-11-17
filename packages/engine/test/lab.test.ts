import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LabEngine } from '../src/lab.ts';

export const labInput = () => ({ schema: 1 as const,
  config: { schema: 1 as const, lab: 'cs201', task: 'library-fines', timeLimitMinutes: 60,
    agent: { profile: 'factoryze@0.1.0', model: 'synthetic', permissions: { edit: 'ask' as const, shell: 'ask' as const } },
    budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
  providerHost: 'provider.invalid', temperature: 0 as const, roster: ['student-1', 'student-2'] });
const joinInput = (code: string, studentId = 'student-1') => ({ protocol: 1 as const, lab: 'cs201', code, studentId, profile: 'factoryze@0.1.0' });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-')); return { root, engine: new LabEngine(root) }; }

test('lab joins are roster-bound, versioned, scoped and do not disclose operator secrets', () => {
  const { root, engine } = fixture();
  try {
    const created = engine.create(labInput());
    assert.throws(() => engine.join({ ...joinInput(created.code), protocol: 2 } as any), /protocol|request/i);
    assert.throws(() => engine.join({ ...joinInput(created.code), profile: 'factoryze@9.0.0' }), /profile/i);
    assert.throws(() => engine.join(joinInput('x'.repeat(16))), /join/i);
    assert.throws(() => engine.join(joinInput(created.code, 'not-in-roster')), /join/i);
    const a = engine.join(joinInput(created.code)), b = engine.join(joinInput(created.code, 'student-2'));
    assert.notEqual(a.token, b.token);
    assert.equal(a.state.usage.remaining, 100);
    assert.equal(a.state.studentId, 'student-1');
    assert.equal(a.state.temperature, 0);
    assert.throws(() => engine.join(joinInput(created.code)), /already joined/i);
    assert.throws(() => engine.student('invalid'), /session/i);
    assert.equal(JSON.stringify(engine.overview('cs201')).includes(a.token), false);
    assert.equal(JSON.stringify(a).includes('student-2'), false);
    const db = readFileSync(join(root, 'labs.sqlite-wal'));
    assert.equal(db.includes(Buffer.from(a.token)), false);
    assert.equal(db.includes(Buffer.from(created.code)), false);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('trusted server metering survives reconnect/restart and cannot reset or cross student/lab budgets', async () => {
  const { root, engine: initial } = fixture(); initial.close();
  let engine = new LabEngine(root);
  try {
    const code = engine.create(labInput()).code;
    const a = engine.join(joinInput(code)), b = engine.join(joinInput(code, 'student-2'));
    await engine.metered(a.token, async () => ({ value: 'synthetic', usage: { input: 80, output: 20, cacheRead: 0, cacheWrite: 0 } }));
    assert.equal(engine.student(a.token).usage.remaining, 0);
    assert.equal(engine.student(b.token).usage.remaining, 100);
    let dispatched = false;
    await assert.rejects(engine.metered(a.token, async () => { dispatched = true; return { value: '', usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } }; }), /budget/i);
    assert.equal(dispatched, false);
    engine.close(); engine = new LabEngine(root);
    assert.equal(engine.student(a.token).usage.remaining, 0);
    assert.equal(engine.student(b.token).usage.remaining, 100);
    const second = labInput(); second.config.lab = 'cs202';
    const next = engine.create(second);
    const c = engine.join({ ...joinInput(next.code), lab: 'cs202' });
    assert.equal(engine.student(c.token).usage.remaining, 100);
    assert.equal(engine.overview('cs201').students.length, 2);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('closing or expiring a lab stops joins and requests while preserving readable usage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-deadline-'));
  let now = Date.parse('2026-10-29T10:00:00Z');
  const engine = new LabEngine(root, { now: () => now });
  try {
    const created = engine.create(labInput()), a = engine.join(joinInput(created.code));
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const active = engine.metered(a.token, signal => new Promise((_resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }));
    await started; engine.closeLab('cs201');
    await assert.rejects(active, /closed/i);
    assert.equal(engine.student(a.token).state, 'closed');
    assert.throws(() => engine.join(joinInput(created.code, 'student-2')), /closed/i);
    await assert.rejects(engine.metered(a.token, async () => { throw Error('must not dispatch'); }), /closed/i);
    const expiring = labInput(); expiring.config.lab = 'deadline';
    const code = engine.create(expiring).code;
    const b = engine.join({ ...joinInput(code), lab: 'deadline' });
    now += 60 * 60_000;
    assert.equal(engine.student(b.token).state, 'closed');
    await assert.rejects(engine.metered(b.token, async () => { throw Error('must not dispatch'); }), /closed/i);
    assert.equal(engine.overview('deadline').closedAt, new Date(now).toISOString());
    now += 24 * 60 * 60_000;
    assert.throws(() => engine.student(b.token), /expired|session/i);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('incomplete requests fail closed, immutable pins and duplicate labs are rejected', async () => {
  const { root, engine } = fixture();
  try {
    const created = engine.create(labInput()), a = engine.join(joinInput(created.code));
    assert.throws(() => engine.create(labInput()), /exists/i);
    for (const patch of [{ temperature: 1 }, { apiKey: 'never-accept' }, { roster: ['student-1', 'student-1'] }])
      assert.throws(() => engine.create({ ...labInput(), ...patch } as any), /config|roster|temperature/i);
    const wrong = labInput(); wrong.config.agent.profile = 'opencode@1.0.0';
    assert.throws(() => engine.create(wrong), /profile/i);
    await assert.rejects(engine.metered(a.token, async () => { throw Error('transport interrupted'); }), /interrupted/);
    assert.equal(engine.student(a.token).usage.status, 'incomplete');
    let dispatched = false;
    await assert.rejects(engine.metered(a.token, async () => { dispatched = true; throw Error('bad'); }), /incomplete/i);
    assert.equal(dispatched, false);
    assert.equal(engine.exportCsv('cs201').includes('student-1'), true);
    assert.equal(engine.exportCsv('cs201').includes(a.token), false);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('queued requests recheck budget and closure before dispatch; invalid usage cannot become complete', async () => {
  const { root, engine } = fixture();
  try {
    const code = engine.create(labInput()).code, a = engine.join(joinInput(code));
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const first = engine.metered(a.token, async () => { entered(); await hold; return { value: 'first', usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 } }; });
    await started;
    let dispatched = false;
    const second = engine.metered(a.token, async () => { dispatched = true; throw Error('must not dispatch'); });
    const refused = assert.rejects(second, /budget/i);
    release(); assert.equal(await first, 'first'); await refused;
    assert.equal(dispatched, false);
    const b = engine.join(joinInput(code, 'student-2'));
    await assert.rejects(engine.metered(b.token, async () => ({ value: 'invalid', usage: undefined as any })));
    assert.equal(engine.student(b.token).usage.status, 'incomplete');
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});
