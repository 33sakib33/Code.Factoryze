import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {LabEngine} from '@factoryze/engine/lab';
import {LabRuntime} from '@factoryze/engine/lab-runtime';
import {LabConnectionStore} from '../../app/extensions/core/src/node/lab-connection.ts';
import {AgentBackendService} from '../../app/extensions/core/src/node/agent-backend-service.ts';
import {initializeServer,loadIdentity} from '../src/identity.ts';
import {createLabServer} from '../src/server.ts';

// Functional classroom load only. This process cannot call a live provider or execute a server-side grader.
const root=mkdtempSync(join(tmpdir(),'factoryze-classroom-load-')),started=performance.now(),stores=[],services=[];
const engine=new LabEngine(join(root,'state'),{taskRoot:resolve('tasks/practice')});let calls=0,server;
const runtime=new LabRuntime(engine,{api:'openai-chat',providerHost:'provider.invalid',model:'synthetic-load',contextWindow:32768,maxOutputTokens:1024,provider:{async send(request){
 const body=JSON.parse(request.body);assert.equal(body.model,'synthetic-load');assert.equal(body.temperature,0);calls++;
 const complete=body.messages.some(message=>message.role==='tool');
 const delta=complete?{content:'Brief read.'}:{tool_calls:[{index:0,id:'read_brief',type:'function',function:{name:'read',arguments:'{"filePath":"README.md"}'}}]};
 return{status:200,headers:{'content-type':'text/event-stream'},body:(async function*(){yield`data: ${JSON.stringify({choices:[{delta,finish_reason:complete?'stop':'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:20}})}\n\ndata: [DONE]\n\n`;})()};
}}});
try{
 initializeServer(join(root,'identity'),'https://localhost:9443');const identity=loadIdentity(join(root,'identity'));
 server=createLabServer(engine,identity,{runtime});await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
 const address=server.address();assert.ok(address&&typeof address!=='string');const connection={...identity.connection,baseURL:`https://localhost:${address.port}`};
 const roster=Array.from({length:60},(_,i)=>`student-${String(i+1).padStart(2,'0')}`),{code}=engine.create({schema:1,config:{schema:1,lab:'load-60',task:'library-fines',timeLimitMinutes:60,
  agent:{profile:'factoryze@0.1.0',model:'synthetic-load',permissions:{edit:'ask',shell:'ask'}},budget:{limit:10000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster});
 const enrolled=performance.now();
 const results=await Promise.all(roster.map(async(studentId,index)=>{
  const values=new Map(),store=new LabConnectionStore({get:async id=>values.get(id)??null,set:async(id,value)=>{values.set(id,value);},delete:async id=>{values.delete(id);}},
   {directory:join(root,studentId,'client'),sessionsRoot:join(root,studentId,'attempts'),prepare:async()=>{},environment:async()=>({}),monitor:false});stores.push(store);
  const attempt=await store.join({connection,lab:'load-60',studentId,code});writeFileSync(join(attempt.workspace,'student.txt'),studentId);
  const service=new AgentBackendService({lab:store,settings:async()=>{throw Error('Personal provider credentials must not be loaded');}});services.push(service);
  let weighted=0;service.setClient({onUpdate:()=>{},onUsage:usage=>{weighted=usage.weighted;},requestPermission:async()=>{throw Error('The read-only load scenario must not request privileged tools');}});
  await service.start(attempt.workspace);assert.equal(await service.prompt('Read README.md and summarize the brief.'),'end_turn');assert.equal(weighted,240);
  const submission=await store.submit(attempt.workspace);assert.equal(submission.state,'queued');await service.stop();
  return{studentId,weighted,snapshotHash:submission.snapshotHash};
 }));
 assert.equal(calls,120);assert.equal(new Set(results.map(row=>row.snapshotHash)).size,60);
 engine.closeLab('load-60');const overview=engine.overview('load-60');assert.equal(overview.students.filter(row=>row.joined).length,60);
 assert.ok(overview.students.every(row=>row.usage?.weighted===240));assert.throws(()=>engine.release('load-60'),/grading/i);
 const receipt={date:'2026-10-29',passed:true,clients:60,joined:60,completedPrompts:60,syntheticModelRequests:calls,readToolRoundTrips:60,
  immutableSubmissions:60,distinctSnapshotHashes:60,totalWeightedTokens:results.reduce((sum,row)=>sum+row.weighted,0),crossStudentBudgetLeak:false,
  closedLabRejectsReleaseUntilGraded:true,gradingExecuted:false,paidModelCalls:0,realMachines:0,
  elapsedMs:Math.round(performance.now()-started),clientWorkElapsedMs:Math.round(performance.now()-enrolled),
  scope:'Single-host functional load with real TLS, desktop backend stores, unchanged server harness, real local read tools and SQLite. No provider-throughput or classroom hardware capacity claim.'};
 const output=resolve(process.argv[2]??'dist/lab-load-result.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(receipt));
}finally{
 await Promise.allSettled(services.map(service=>service.stop()));for(const store of stores)store.dispose();await runtime.close();
 if(server){await server.disposeLab();server.closeAllConnections();await new Promise(accept=>server.close(accept));}engine.close();rmSync(root,{recursive:true,force:true});
}
