import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TrialClient, TrialError, type HostedTask } from '@factoryze/engine/trial-client';
import { ModelSettingsStore } from '../src/node/model-settings.ts';
import { TrialConnectionStore, memoryTrialPreferences } from '../src/node/trial-connection.ts';
import { listPracticeTasks } from '@factoryze/engine/tasks';
import { practiceTasks } from '../src/node/hosted-tasks.ts';

const session = 's'.repeat(43), archive = Buffer.from('synthetic hosted task archive');
const digest = createHash('sha256').update(archive).digest('hex');
const listed = (extra: object = {}) => ({ schema: 1, id: 'hosted-sample', title: 'Hosted sample', brief: 'Fix the hosted boundary.', minimumPython: '3.11', timeHintMinutes: 20, sha256: digest, archiveBytes: archive.length, ...extra });
function service(catalog: unknown[], body: Buffer = archive) {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url)), path = parsed.pathname, headers = init?.headers as Record<string, string>; requests.push(path+parsed.search);
    if(path.startsWith('/api/tasks')){assert.equal(headers?.Authorization, undefined);assert.equal(headers?.['X-Factoryze-Desktop'],undefined);}
    else {assert.equal(headers['X-Factoryze-Desktop'], '1'); assert.equal(headers.Authorization, `Bearer ${session}`);}
    assert.equal(init?.redirect, 'error');
    if (path === '/api/tasks') return new Response(JSON.stringify({ tasks: catalog }), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/tasks/search') return new Response(JSON.stringify({ tasks: catalog, nextCursor: '' }), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/tasks/topics') return new Response(JSON.stringify({ topics: [{ id: 'linux', count: 2 }] }), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/tasks/hosted-sample') return new Response(JSON.stringify(catalog[0]), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/desktop/tasks') return new Response(JSON.stringify({ tasks: catalog }), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/desktop/tasks/hosted-sample/archive') return new Response(new Uint8Array(body), { headers: { 'content-type': 'application/zip', 'x-task-sha256': digest } });
    if (path.endsWith('/archive')) return new Response(JSON.stringify({ error: { code: 'task_not_found' } }), { status: 404 });
    throw new Error('Unexpected test path ' + path);
  };
  return { requests, client: new TrialClient('https://trial.example', fetcher), fetcher };
}

test('hosted task listings keep only valid task packs with a digest and size', async () => {
  const { client, requests } = service([listed(), listed({ id: 'Bad ID' }), listed({ id: 'no-digest', sha256: 'x' }), listed({ id: 'too-big', archiveBytes: 21 * 1024 * 1024 }), null]);
  assert.deepEqual(await client.tasks(session), [listed()]);
  assert.deepEqual(requests, ['/api/desktop/tasks']);
});

test('public hosted browsing requests a bounded page, topic counts and one task without a desktop session', async () => {
  const { client, requests } = service([listed({ topics: ['linux'] })]);
  const page = await client.publicTasksPage({ query: 'process', topic: 'linux', after: 'alpha', limit: 20 });
  assert.equal(page.tasks.length, 1);
  assert.equal(page.nextCursor, '');
  assert.deepEqual(await client.publicTaskTopics(), [{ id: 'linux', count: 2 }]);
  assert.equal((await client.publicTask('hosted-sample')).id, 'hosted-sample');
  assert.deepEqual(requests, ['/api/tasks/search?limit=20&q=process&topic=linux&after=alpha', '/api/tasks/topics', '/api/tasks/hosted-sample']);
  await assert.rejects(client.publicTasksPage({ query: '', topic: '', after: '', limit: 1000 }), TrialError);
});

test('a hosted task download is written only when its SHA-256 matches the catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-hosted-')), target = join(root, 'task.zip');
  try {
    const task = listed() as HostedTask;
    await service([]).client.downloadTask(session, task, target);
    assert.deepEqual(readFileSync(target), archive);
    rmSync(target);
    await assert.rejects(service([], Buffer.from('tampered archive bytes!!!!!!!')).client.downloadTask(session, task, target), (e: unknown) => e instanceof TrialError && e.code === 'hosted_task_corrupt');
    assert.equal(existsSync(target), false);
    await assert.rejects(service([], Buffer.concat([archive, Buffer.from('extra')])).client.downloadTask(session, task, target), (e: unknown) => e instanceof TrialError && e.code === 'hosted_task_corrupt');
    await assert.rejects(service([]).client.downloadTask(session, { ...task, id: 'withdrawn' }, target), (e: unknown) => e instanceof TrialError && e.code === 'hosted_task_unavailable');
    assert.equal(existsSync(target), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an expired desktop session blocks a hosted download before requesting an archive', async () => {
  let requests = 0;
  const preferences = memoryTrialPreferences();
  await preferences.write(JSON.stringify({ schema: 'trial-connection@2', origin: 'https://trial.example', selected: true, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  const store = new TrialConnectionStore({ preferences, secret: { read: async () => session, write: async () => undefined, delete: async () => undefined } },
    'https://trial.example', async () => { requests++; throw new Error('Unexpected request'); });
  assert.equal((await store.view()).signedIn, false);
  await assert.rejects(store.downloadHostedTask(listed() as HostedTask, join(tmpdir(), 'never-created.zip')),
    (error: unknown) => error instanceof TrialError && error.code === 'authentication_required');
  assert.equal(requests, 0);
});

test('Practice tasks browse backend catalog while signed out; bundled tasks win on the same id', async () => {
  {
    const values = new Map<string, string>(), credentials = { getPassword: async (s: string, a: string) => values.get(s + ':' + a) ?? null, setPassword: async (s: string, a: string, v: string) => { values.set(s + ':' + a, v); }, deletePassword: async (s: string, a: string) => values.delete(s + ':' + a) };
    const { fetcher } = service([listed(), listed({ id: 'library-fines', title: 'Shadow of a bundled task' })]);
    const preferences = memoryTrialPreferences();
    const settings = new ModelSettingsStore(credentials, 'test', 'win32', { origin: 'https://trial.example', fetcher, preferences });
    const tasks = { list: async () => (await practiceTasks(await listPracticeTasks(resolve('tasks/practice')), settings.trial)).tasks };
    const signedOut = await tasks.list();
    assert.deepEqual(signedOut.filter(task=>task.hosted).map(task=>task.id),['hosted-sample']);
    values.set('Factoryze Trial Account:test:trial', session);
    await preferences.write(JSON.stringify({ schema: 'trial-connection@2', origin: 'https://trial.example', selected: false, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    const signedIn = await tasks.list();
    assert.deepEqual(signedIn.filter(task => task.hosted).map(task => task.id), ['hosted-sample']);
    assert.equal(signedIn.find(task => task.id === 'library-fines')?.title, 'Library fines');
    assert.equal(signedIn.length, signedOut.length);
    assert.equal('sha256' in signedIn.find(task => task.hosted)!, false);
  }
});
