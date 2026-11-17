import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LabEngine } from '../src/lab.ts';
import {DatabaseSync} from 'node:sqlite';

const input = () => ({ schema: 1, config: { schema: 1, lab: 'class-a', task: 'library-fines', timeLimitMinutes: 60,
  agent: { profile: 'factoryze@0.1.0', model: 'synthetic', permissions: { edit: 'ask', shell: 'ask' } },
  budget: { limit: 1000, weights: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 } } },
  providerHost: 'provider.invalid', temperature: 0, roster: ['one', 'two'] });
const enroll = (engine: LabEngine, code: string, studentId: string) => engine.join({ protocol: 1, lab: 'class-a', code, studentId, profile: 'factoryze@0.1.0' });

test('grading failures require instructor retry; v2 migration preserves snapshots and released CSV pins the grader image',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-grading-retry-'));let engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
 try{
  const {code}=engine.create(input()),student=enroll(engine,code,'one'),saved=engine.submit(student.token,{requestId:'first',revision:0});engine.closeLab('class-a');
  await engine.gradeQueued(async()=>{throw Error('Docker unavailable');});assert.equal(engine.submissions(student.token)[0]!.state,'failed');
  engine.close();const previous=new DatabaseSync(join(root,'artifacts.sqlite'));previous.exec('DROP TABLE IF EXISTS grading_provenance; PRAGMA user_version=2;');previous.close();
  engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});assert.equal(engine.submissions(student.token)[0]!.snapshotHash,saved.snapshotHash);
  assert.equal(engine.retryGrades('class-a'),1);
  await engine.gradeQueued(async()=>({passed:1,total:1,provenance:{executor:'docker',image:'sha256:'+'a'.repeat(64),runner:'factoryze-hidden-v1',python:'3.13.0',checkTimeoutMs:10000,runTimeoutMs:120000}}));
  engine.release('class-a');assert.match(engine.exportCsv('class-a'),/grading_image/);assert.match(engine.exportCsv('class-a'),/sha256:aaaa/);
 }finally{engine.close();rmSync(root,{recursive:true,force:true});}
});

test('a private join binding recovers a lost response without allowing another client to claim the identity',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-binding-'));let engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
 try{const {code}=engine.create(input()),request={protocol:1,lab:'class-a',code,studentId:'one',profile:'factoryze@0.1.0',binding:'b'.repeat(43)};
  const first=engine.join(request);engine.close();engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
  assert.equal(engine.join(request).token,first.token);assert.throws(()=>engine.join({...request,binding:'c'.repeat(43)}),/already joined/i);
  engine.resetStudent('class-a','one');assert.throws(()=>engine.join(request),/already joined/i);
 }finally{engine.close();rmSync(root,{recursive:true,force:true});}
});

test('a lab pins its first grading image and refuses a different image before executing a retry',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-image-pin-')),engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
 const image='sha256:'+'a'.repeat(64),verdict=()=>({passed:1,total:1,provenance:{executor:'docker' as const,image,runner:'factoryze-hidden-v1' as const,python:'3.13.0',checkTimeoutMs:10000,runTimeoutMs:120000}});
 try{
  const {code}=engine.create(input()),a=enroll(engine,code,'one'),b=enroll(engine,code,'two');engine.submit(a.token,{requestId:'a',revision:0});engine.submit(b.token,{requestId:'b',revision:0});engine.closeLab('class-a');
  let first=true;await engine.gradeQueued(Object.assign(async()=>{if(first){first=false;return verdict();}throw Error('interrupted');},{image}));
  engine.retryGrades('class-a');let executed=false;
  assert.deepEqual(await engine.gradeQueued(Object.assign(async()=>{executed=true;return verdict();},{image:'sha256:'+'b'.repeat(64)})),{graded:0,failed:1});assert.equal(executed,false);
  engine.retryGrades('class-a');assert.deepEqual(await engine.gradeQueued(Object.assign(async()=>verdict(),{image})),{graded:1,failed:0});engine.release('class-a');assert.equal(engine.releasedReports(b.token).length,1);
 }finally{engine.close();rmSync(root,{recursive:true,force:true});}
});

test('lab task delivery excludes hidden material; mirror sync is bounded, scoped, versioned and idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-workflow-'));
  const engine = new LabEngine(root, { taskRoot: resolve('tasks/practice') });
  try {
    const { code } = engine.create(input()), a = enroll(engine, code, 'one'), b = enroll(engine, code, 'two');
    const task = engine.task(a.token);
    assert.equal(task.task.id, 'library-fines');
    assert.ok(task.files.some(file => file.path.endsWith('.py')));
    assert.equal(task.files.some(file => /hidden|benchmark|reference/.test(file.path)), false);
    const first = engine.mirror(a.token);
    const request = { requestId: 'sync-1', baseRevision: first.revision, files: [...first.files, { path: 'notes.txt', data: Buffer.from('saved').toString('base64') }] };
    const ack = engine.sync(a.token, request);
    assert.equal(ack.revision, 1);
    assert.deepEqual(engine.sync(a.token, request), ack);
    assert.throws(() => engine.sync(a.token, { ...request, files: [] }), /reuse|conflict/i);
    assert.throws(() => engine.sync(a.token, { ...request, requestId: 'sync-2' }), /revision|conflict/i);
    assert.equal(engine.mirror(b.token).revision, 0);
    for (const path of ['../escape', 'C:/escape', 'tests/hidden/secret.py', '.env', '.git/config', 'CON', 'x\\y'])
      assert.throws(() => engine.sync(a.token, { requestId: 'hostile', baseRevision: 1, files: [{ path, data: '' }] }));
    assert.throws(() => engine.sync(a.token, { requestId: 'case', baseRevision: 1, files: [{ path: 'a.py', data: '' }, { path: 'A.py', data: '' }] }));
    assert.equal(engine.mirror(a.token).revision, 1);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('submissions are immutable; closing auto-submits; grades remain private until instructor release', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-submissions-'));
  let engine = new LabEngine(root, { taskRoot: resolve('tasks/practice') });
  try {
    const { code } = engine.create(input()), a = enroll(engine, code, 'one'), b = enroll(engine, code, 'two');
    const receipt = engine.submit(a.token, { requestId: 'submit-1', revision: 0 });
    assert.deepEqual(engine.submit(a.token, { requestId: 'submit-1', revision: 0 }), receipt);
    assert.equal(engine.releasedReports(a.token).length, 0);
    const oldHash = receipt.snapshotHash;
    engine.sync(a.token, { requestId: 'edit', baseRevision: 0, files: [{ path: 'main.py', data: Buffer.from('changed').toString('base64') }] });
    assert.equal(engine.submissions(a.token)[0]!.snapshotHash, oldHash);
    engine.closeLab('class-a');
    assert.deepEqual(engine.submit(a.token,{requestId:'submit-1',revision:0}),receipt,'a lost receipt can be recovered even after the lab closes');
    assert.throws(()=>engine.submit(a.token,{requestId:'new-after-close',revision:1}),/closed/i);
    assert.equal(engine.submissions(a.token).length, 2);
    assert.equal(engine.submissions(b.token).length, 1);
    assert.throws(() => engine.sync(a.token, { requestId: 'late', baseRevision: 1, files: [] }), /closed/i);
    assert.throws(() => engine.release('class-a'), /grad|pending/i);
    await engine.gradeQueued(async snapshot => ({ passed: 1, total: 1, checks: [{ name: 'synthetic_check', passed: true }] }));
    assert.equal(engine.releasedReports(a.token).length, 0);
    engine.release('class-a');
    const reports = engine.releasedReports(a.token);
    assert.equal(reports.length, 2);
    assert.equal(reports[0]!.lab!.snapshotHash, oldHash);
    const token = a.token;
    engine.close(); engine = new LabEngine(root, { taskRoot: resolve('tasks/practice') });
    assert.equal(engine.releasedReports(token).length, 2);
    assert.match(engine.exportCsv('class-a'), /correctness_passed/);
    assert.equal(engine.releasedReports(b.token).length, 1);
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});

test('instructor session recovery preserves identity, budgets and snapshots; student events are untrusted flags', () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-lab-recovery-'));
  const engine = new LabEngine(root, { taskRoot: resolve('tasks/practice') });
  try {
    const { code } = engine.create(input()), a = enroll(engine, code, 'one');
    engine.recordClientEvent(a.token, { id: 'event-1', kind: 'paste', at: new Date().toISOString(), count: 12 });
    engine.recordClientEvent(a.token, { id: 'event-1', kind: 'paste', at: new Date().toISOString(), count: 12 });
    const replacement = engine.resetStudent('class-a', 'one');
    assert.throws(() => engine.student(a.token), /session/i);
    assert.equal(engine.student(replacement.token).usage.remaining, 1000);
    assert.equal(engine.integrity('class-a')[0]!.events.length, 1);
    assert.equal(engine.integrity('class-a')[0]!.trusted, false);
    const state = engine.student(replacement.token);
    assert.equal(state.studentId, 'one');
  } finally { engine.close(); rmSync(root, { recursive: true, force: true }); }
});
