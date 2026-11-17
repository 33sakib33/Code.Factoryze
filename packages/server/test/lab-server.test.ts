import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LabEngine } from '../../engine/src/lab.ts';
import { initializeServer, loadIdentity } from '../src/identity.ts';
import { createLabServer } from '../src/server.ts';
import { LabClient } from '../src/client.ts';
import { execFile, spawn } from 'node:child_process';
import { createServer as createPortProbe } from 'node:net';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const input = { schema: 1, config: { schema: 1, lab: 'network-lab', task: 'library-fines', timeLimitMinutes: 60,
  agent: { profile: 'factoryze@0.1.0', model: 'synthetic', permissions: { edit: 'ask', shell: 'ask' } },
  budget: { limit: 100, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
  providerHost: 'provider.invalid', temperature: 0, roster: ['one', 'two'] };

test('real TLS clients join/reconnect, cannot administer or self-report usage, and observe closure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-network-'));
  const initialized = initializeServer(join(root, 'state'), 'https://localhost:9443');
  const identity = loadIdentity(join(root, 'state'));
  const engine = new LabEngine(join(root, 'state'));
  const server = createLabServer(engine, identity);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const connection = { ...initialized, baseURL: `https://localhost:${address.port}` };
  const operator = new LabClient(connection, identity.operatorToken), publicClient = new LabClient(connection);
  try {
    const created = await operator.request('POST', '/v1/admin/labs', input);
    const joinRequest = { protocol: 1, lab: 'network-lab', code: created.code, studentId: 'one', profile: 'factoryze@0.1.0' };
    const a = await publicClient.request('POST', '/v1/join', joinRequest);
    const b = await publicClient.request('POST', '/v1/join', { ...joinRequest, studentId: 'two' });
    const student = new LabClient(connection, a.token);
    assert.equal((await student.request('GET', '/v1/me')).studentId, 'one');
    assert.equal((await new LabClient(connection, b.token).request('GET', '/v1/me')).studentId, 'two');
    await assert.rejects(student.request('GET', '/v1/admin/labs/network-lab'), /401/);
    await assert.rejects(student.request('POST', '/v1/admin/labs', input), /401/);
    for(const action of ['close','release','grade'])await assert.rejects(student.request('POST',`/v1/admin/labs/network-lab/${action}`,{}),/401/);
    for(const action of ['reset','reconcile'])await assert.rejects(student.request('POST',`/v1/admin/labs/network-lab/students/one/${action}`,{}),/401/);
    await assert.rejects(student.request('GET','/v1/admin/labs/network-lab/integrity'),/401/);
    await assert.rejects(publicClient.request('GET', '/v1/me'), /401/);
    await assert.rejects(student.request('POST', '/v1/usage', { input: 0 }), /404/);
    await assert.rejects(publicClient.request('POST', '/v1/join', { ...joinRequest, protocol: 2 }), /400/);
    await assert.rejects(publicClient.request('POST', '/v1/join', { ...joinRequest, apiKey: 'forbidden' }), /400/);
    assert.throws(() => new LabClient({ ...connection, fingerprint: '0'.repeat(64) }), /fingerprint|pin/i);
    const wrongHost = new LabClient({ ...connection, baseURL: `https://127.0.0.1:${address.port}` });
    await assert.rejects(wrongHost.request('GET', '/v1/health'), /altname|IP|Hostname/i);
    await operator.request('POST', '/v1/admin/labs/network-lab/close', {});
    assert.equal((await student.request('GET', '/v1/me')).state, 'closed');
    await assert.rejects(publicClient.request('POST', '/v1/join', joinRequest), /409/);
    const overview = await operator.request('GET', '/v1/admin/labs/network-lab');
    assert.equal(overview.students.length, 2);
    assert.equal(JSON.stringify(overview).includes(a.token), false);
    assert.equal(readFileSync(join(root, 'state/client.json'), 'utf8').includes(identity.operatorToken), false);
    assert.throws(() => initializeServer(join(root, 'state'), 'https://localhost:9443'), /exists|initialized/i);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('instructor CLI creates, watches, closes and exports over real HTTPS without leaking its token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-cli-')), state = join(root, 'state');
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const run = async (...args: string[]) => (await promisify(execFile)(process.execPath, ['--experimental-strip-types', cli, ...args], { windowsHide: true, timeout: 30_000 })).stdout;
  try {
    const initialized = JSON.parse(await run('server', 'init', '--data', state, '--url', 'https://localhost:9443'));
    const identity = loadIdentity(state), probe = createPortProbe();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); assert.ok(address && typeof address !== 'string');
    await new Promise<void>(resolve => probe.close(() => resolve()));
    writeFileSync(join(state, 'client.json'), JSON.stringify({ ...identity.connection, baseURL: `https://localhost:${address.port}` }));
    writeFileSync(join(root, 'lab.json'), JSON.stringify(input));
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, 'server', 'serve', '--data', state], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('CLI server did not start')), 10_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(Error('CLI server exited before listening')); });
        child.stdout.on('data', chunk => { if (String(chunk).includes('"status":"listening"')) { clearTimeout(timer); resolve(); } });
      });
      assert.equal(JSON.stringify(initialized).includes(identity.operatorToken), false);
      const createdText = await run('lab', 'create', '--data', state, '--config', join(root, 'lab.json'));
      const created = JSON.parse(createdText);
      const watched = JSON.parse(await run('lab', 'watch', 'network-lab', '--data', state, '--once'));
      assert.equal(watched.config.lab, 'network-lab');
      assert.equal(watched.students.length, 2);
      assert.equal(createdText.includes(identity.operatorToken), false);
      assert.equal(JSON.stringify(watched).includes(created.code), false);
      const closed = JSON.parse(await run('lab', 'close', 'network-lab', '--data', state));
      assert.ok(closed.closedAt);
      const output = join(root, 'usage.csv');
      await run('lab', 'export', 'network-lab', '--data', state, '--out', output);
      const csv = readFileSync(output, 'utf8');
      assert.match(csv, /student_id/); assert.match(csv, /not_joined/);
      assert.equal(csv.includes(identity.operatorToken), false);
      await assert.rejects(run('lab', 'export', 'network-lab', '--data', state, '--out', output));
    } finally {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    }
    assert.ok(existsSync(join(state, 'operator.json')));
    const reopened = new LabEngine(state);
    try { assert.ok(reopened.overview('network-lab').closedAt); } finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed initialization does not overwrite an identity or leave partial keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-init-')), state = join(root, 'failed');
  try {
    assert.throws(() => initializeServer(state, 'http://localhost:9443'), /HTTPS/i);
    assert.equal(existsSync(state), false);
    assert.throws(() => initializeServer(state, 'https://localhost:9443', join(root, 'not-an-executable')), /initialization failed/i);
    assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
