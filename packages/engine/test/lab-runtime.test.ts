import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LabEngine } from '../src/lab.ts';
import { LabRuntime } from '../src/lab-runtime.ts';

test('server agent dispatches tools to the student, meters provider usage and deduplicates prompts/results', async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-runtime-')),engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
 let calls=0;
 const runtime=new LabRuntime(engine,{api:'openai-chat',providerHost:'provider.invalid',model:'synthetic',contextWindow:32768,maxOutputTokens:1024,provider:{async send(request){
  calls++;assert.equal(JSON.parse(request.body).temperature,0);
  const delta=calls===1?{tool_calls:[{index:0,id:'call_read',type:'function',function:{name:'read',arguments:JSON.stringify({filePath:'README.md'})}}]}:{content:'Done'};
  return{status:200,headers:{'content-type':'text/event-stream'},body:(async function*(){yield`data: ${JSON.stringify({choices:[{delta,finish_reason:calls===1?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})}\n\ndata: [DONE]\n\n`;})()};
 }}});
 try{
  const created=engine.create({schema:1,config:{schema:1,lab:'runtime',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:100,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one','two']});
  const a=engine.join({protocol:1,lab:'runtime',code:created.code,studentId:'one',profile:'factoryze@0.1.0'}),b=engine.join({protocol:1,lab:'runtime',code:created.code,studentId:'two',profile:'factoryze@0.1.0'});
  const session=await runtime.start(a.token,{connectionId:'client-1',revision:0});
  const prompt={session:session.session,requestId:'prompt-1',revision:0,text:'Read the brief'};
  runtime.prompt(a.token,prompt);runtime.prompt(a.token,prompt);
  let tool:any,after=0,done=false;const usage:any[]=[];
  for(let i=0;i<150&&!done;i++){
   for(const event of runtime.poll(a.token,{session:session.session,after}).events){after=event.sequence;
    if(event.kind==='usage'&&!done)usage.push(event.data);
    if(event.kind==='tool'){tool=event.data;await assert.rejects(async()=>runtime.result(b.token,{session:session.session,id:tool.id,revision:0,result:'forged',approvals:[]}));
     const result={session:session.session,id:tool.id,revision:0,result:'Public brief',approvals:[]};runtime.result(a.token,result);runtime.result(a.token,result);}
    if(event.kind==='complete')done=true;
   }await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(tool);assert.equal(done,true);assert.equal(calls,2);assert.equal(engine.student(a.token).usage.weighted,24);assert.equal(engine.student(b.token).usage.weighted,0);
  // Each metered request updates the student's meter; the server's own workspace path never reaches the client.
  assert.deepEqual(usage.map(item=>item.requests),[1,2,2]);assert.deepEqual(usage.map(item=>item.weighted),[12,24,24]);
  assert.equal(usage.some(item=>'workspace' in item),false);
  assert.equal(runtime.prompt(a.token,prompt).state,'complete');assert.equal(calls,2);
  engine.closeLab('runtime');await assert.rejects(runtime.start(a.token,{connectionId:'new',revision:0}),/closed/i);
 }finally{await runtime.close();engine.close();rmSync(root,{recursive:true,force:true});}
});

test('lab provider failures give students a fixed reason and log the code for the instructor', async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-failure-')),engine=new LabEngine(root,{taskRoot:resolve('tasks/practice')});
 let reply:{status:number;failureCode?:string}={status:404,failureCode:'provider_no_route'};const logged:any[]=[];
 const runtime=new LabRuntime(engine,{api:'openai-chat',providerHost:'provider.invalid',model:'synthetic',contextWindow:32768,maxOutputTokens:1024,log:entry=>logged.push(entry),
  provider:{async send(){return{...reply,headers:{},body:(async function*(){})()} as any;}}});
 let after=0;
 const errors=async(token:string,session:string,requestId:string)=>{runtime.prompt(token,{session,requestId,revision:0,text:'Fix it'});const found:string[]=[];
  for(let i=0,done=false;i<150&&!done;i++){for(const event of runtime.poll(token,{session,after}).events){after=event.sequence;
   if(event.kind==='error')found.push((event.data as any).message);if(event.kind==='complete')done=true;}await new Promise(r=>setTimeout(r,10));}return found;};
 try{
  const created=engine.create({schema:1,config:{schema:1,lab:'failures',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:1000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one']});
  const a=engine.join({protocol:1,lab:'failures',code:created.code,studentId:'one',profile:'factoryze@0.1.0'}),session=await runtime.start(a.token,{connectionId:'c',revision:0});
  const refused=await errors(a.token,session.session,'p1');
  assert.deepEqual(refused,["The lab's model provider refused this request. Your work is saved. Tell your instructor; the server log shows the reason."]);
  assert.deepEqual(logged,[{event:'lab_agent_failed',lab:'failures',studentId:'one',code:'provider_no_route'}]);
  // Like the desktop, reconnect with a new connection after a failed turn.
  reply={status:429};after=0;const retry=await runtime.start(a.token,{connectionId:'c2',revision:0});
  assert.deepEqual(await errors(a.token,retry.session,'p2'),["The lab's model provider is busy or unavailable. Your work is saved; wait a moment and send the prompt again."]);
  assert.equal(logged.at(-1)?.code,'provider_rate_limited');
 }finally{await runtime.close();engine.close();rmSync(root,{recursive:true,force:true});}
});
