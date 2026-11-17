import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LabEngine } from '@factoryze/engine/lab';
import { LabConnectionStore } from '../src/node/lab-connection.ts';
import { LabClient } from '@factoryze/engine/lab-client';
import { createLabServer } from '../../../../server/src/server.ts';
import { initializeServer, loadIdentity } from '../../../../server/src/identity.ts';

test('desktop lab connection stores tokens only in credentials, resumes safely and retains concurrent offline work/events',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-desktop-lab-')),engine=new LabEngine(join(root,'state'),{taskRoot:resolve('tasks/practice')});
 initializeServer(join(root,'identity'),'https://localhost:9443');const identity=loadIdentity(join(root,'identity')),server=createLabServer(engine,identity);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const connection={...identity.connection,baseURL:`https://localhost:${address.port}`},values=new Map<string,string>();
 const secrets={get:async(id:string)=>values.get(id)??null,set:async(id:string,value:string)=>{values.set(id,value);},delete:async(id:string)=>{values.delete(id);}};
 const options={directory:join(root,'client'),sessionsRoot:join(root,'attempts'),prepare:async()=>{},environment:async()=>({}),monitor:false};
 let store=new LabConnectionStore(secrets,options);
 try{
  const {code}=engine.create({schema:1,config:{schema:1,lab:'desktop',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:25000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one']});
  const input={connection,lab:'desktop',studentId:'one',code},request=LabClient.prototype.request;
  LabClient.prototype.request=async function(method,path,body,signal){const result=await request.call(this,method,path,body,signal);if(path==='/v1/join')throw Error('Lost join response');return result;};
  try{await assert.rejects(store.join(input),/Lost join response/);}finally{LabClient.prototype.request=request;}
  store.dispose();store=new LabConnectionStore(secrets,options);const attempt=await store.join(input);
  assert.equal(attempt.lab!.id,'desktop');assert.equal(attempt.task.id,'library-fines');assert.equal(store.has(attempt.workspace),true);
  assert.deepEqual(store.attempts().map(item=>[item.taskId,item.lab]),[['library-fines','desktop']],'lab attempts are marked so Practice tasks can ignore them');
  const savedPath=join(root,'client',readdirSync(join(root,'client')).find(name=>/^[a-f0-9-]{36}\.json$/.test(name))!);
  const token=JSON.parse([...values.values()][0]!).token;
  assert.equal(readFileSync(savedPath,'utf8').includes(token),false);
  assert.equal(readdirSync(attempt.workspace).some(name=>name==='hidden'),false);
  const client=await store.client(attempt.workspace),original=client.request.bind(client);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let delayed=true;
  client.request=async(method,path,body,signal)=>{if(path==='/v1/me'&&delayed){delayed=false;entered();await gate;}return original(method,path,body,signal);};
  const refreshing=store.refresh(attempt.workspace);await started;
  store.queueEvent(attempt.workspace,'paste',13);writeFileSync(join(attempt.workspace,'notes.txt'),'offline draft');
  await store.sync(attempt.workspace);release();await refreshing;
  const saved=JSON.parse(readFileSync(savedPath,'utf8'));assert.equal(saved.revision,1);assert.equal(saved.events.length,1);
  let loseReply=true;client.request=async(method,path,body,signal)=>{const result=await original(method,path,body,signal);
   if(path==='/v1/submit'&&loseReply){loseReply=false;throw Error('Simulated lost submission response');}return result;};
  await assert.rejects(store.submit(attempt.workspace),/lost submission response/);
  store.dispose();store=new LabConnectionStore(secrets,options);const resumed=await store.join(input);
  assert.equal(resumed.workspace,attempt.workspace);assert.equal(readFileSync(join(resumed.workspace,'notes.txt'),'utf8'),'offline draft');
  const receipt=await store.submit(attempt.workspace);assert.equal(receipt.revision,1);
  assert.equal((await store.view(attempt.workspace)).submissions.length,1,'restarting after a lost reply must reuse the saved submission ID');
  const resumedClient=await store.client(attempt.workspace),send=resumedClient.request.bind(resumedClient);
  let savedButOffline=false;resumedClient.request=async(method,path,body,signal)=>{
   if(path==='/v1/me'&&savedButOffline)throw Error('Offline after save');const result=await send(method,path,body,signal);if(path==='/v1/submit')savedButOffline=true;return result;};
  assert.equal((await store.submit(attempt.workspace)).number,2,'an acknowledged save succeeds even if the subsequent status refresh is offline');
  assert.equal((await store.view(attempt.workspace)).submissions.length,2);
  savedButOffline=false;
  let posting!:()=>void,allowPost!:()=>void;const postStarted=new Promise<void>(resolve=>{posting=resolve;}),postGate=new Promise<void>(resolve=>{allowPost=resolve;});
  resumedClient.request=async(method,path,body,signal)=>{if(path==='/v1/submit'){posting();await postGate;}return send(method,path,body,signal);};
  const saving=store.submit(attempt.workspace);void saving.catch(()=>{});await postStarted;writeFileSync(join(attempt.workspace,'notes.txt'),'concurrent edit');
  const synchronizing=store.sync(attempt.workspace);await new Promise(resolve=>setTimeout(resolve,50));allowPost();
  assert.equal((await saving).revision,1,'background sync must not invalidate an in-flight submission');await synchronizing;
  assert.equal((await resumedClient.request('GET','/v1/mirror')).revision,2);
  engine.closeLab('desktop');await store.refresh(attempt.workspace);
  writeFileSync(join(attempt.workspace,'notes.txt'),'too late');await assert.rejects(store.sync(attempt.workspace),/409/);
  assert.equal((await store.view(attempt.workspace)).state,'closed');
 }finally{store.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));engine.close();rmSync(root,{recursive:true,force:true});}
});
