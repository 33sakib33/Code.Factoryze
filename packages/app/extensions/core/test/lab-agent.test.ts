import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LabEngine } from '@factoryze/engine/lab';
import { LabRuntime } from '@factoryze/engine/lab-runtime';
import { LabConnectionStore } from '../src/node/lab-connection.ts';
import { AgentBackendService } from '../src/node/agent-backend-service.ts';
import { initializeServer, loadIdentity } from '../../../../server/src/identity.ts';
import { createLabServer } from '../../../../server/src/server.ts';

test('real desktop backend uses the server brain and existing approved hands without loading BYOK settings',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-agent-')),engine=new LabEngine(join(root,'state'),{taskRoot:resolve('tasks/practice')});
 initializeServer(join(root,'identity'),'https://localhost:9443');const identity=loadIdentity(join(root,'identity'));let calls=0,settingsRead=0;
 const runtime=new LabRuntime(engine,{api:'openai-chat',providerHost:'provider.invalid',model:'synthetic',contextWindow:32768,maxOutputTokens:1024,provider:{async send(){
  const tool=[{name:'read',arguments:{filePath:'README.md'}},{name:'write',arguments:{filePath:'notes.txt',content:'approved lab edit'}},
    {name:'shell',arguments:{command:process.platform==='win32'?"Write-Output 'LAB_APPROVAL'":"printf LAB_APPROVAL"}}][calls++];
  const delta=tool?{tool_calls:[{index:0,id:`tool-${calls}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:'Done.'};
  return{status:200,headers:{'content-type':'text/event-stream'},body:(async function*(){yield`data: ${JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})}\n\ndata: [DONE]\n\n`;})()};
 }}});
 const server=createLabServer(engine,identity,{runtime});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const values=new Map<string,string>(),store=new LabConnectionStore({get:async id=>values.get(id)??null,set:async(id,value)=>{values.set(id,value);},delete:async id=>{values.delete(id);}},
  {directory:join(root,'client'),sessionsRoot:join(root,'attempts'),prepare:async()=>{},environment:async()=>({}),monitor:false});
 const service=new AgentBackendService({lab:store,settings:async()=>{settingsRead++;throw Error('Must not load personal credentials for a lab');}});
 let approvals=0,reported=0,updates=0;
 service.setClient({onUsage:usage=>{reported=usage.weighted;},onUpdate:()=>{updates++;},requestPermission:async input=>{approvals++;return(input as any).options.find((option:any)=>option.kind==='allow_once').optionId;}});
 try{
  const {code}=engine.create({schema:1,config:{schema:1,lab:'agent',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:25000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one']});
  const attempt=await store.join({connection:{...identity.connection,baseURL:`https://localhost:${address.port}`},lab:'agent',studentId:'one',code});
  await service.start(attempt.workspace);assert.equal(await service.prompt('Read the brief, write a note and print the approval marker.'),'end_turn');
  assert.equal(readFileSync(join(attempt.workspace,'notes.txt'),'utf8'),'approved lab edit');assert.equal(approvals,2);assert.ok(updates>0);assert.equal(calls,4);assert.equal(reported,48);assert.equal(settingsRead,0);
  const receipt=await store.submit(attempt.workspace);assert.ok(receipt.snapshotHash);assert.equal(receipt.state,'queued');
  await service.stop();await store.refresh(attempt.workspace);assert.equal((await store.view(attempt.workspace)).usage.weighted,48);
  // Server closure must release an unanswered permission RPC, otherwise the prompt error cannot reach the UI.
  calls=1;let entered!:()=>void,answer!:(value:string|null)=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});service.setClient({onUsage:()=>{},onUpdate:()=>{},requestPermission:()=>{entered();return new Promise(resolve=>{answer=resolve;});}});
  await service.start(attempt.workspace);const interrupted=service.prompt('Propose another edit').then(()=>false,()=>true);await waiting;
  try{await runtime.stopStudent('agent');engine.closeLab('agent');
   assert.equal(await Promise.race([interrupted,new Promise(resolve=>setTimeout(()=>resolve('hung'),1500))]),true,'server closure must not wait for the student to answer an obsolete approval');
  }finally{answer(null);await interrupted;}
 }finally{await service.stop();store.dispose();await server.disposeLab();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));engine.close();rmSync(root,{recursive:true,force:true});}
});
