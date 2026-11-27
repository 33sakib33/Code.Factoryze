import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelSettingsStore } from '../src/node/model-settings.ts';
import { TrialConnectionStore } from '../src/node/trial-connection.ts';
import { isModelConfigured } from '@factoryze/protocol';

const setup={schema:1 as const,api:'openai-chat' as const,baseURL:'https://own.example/v1',model:'own-model',contextWindow:8192,maxOutputTokens:1024,budgetTokens:9000};
function fixture(){
 const values=new Map<string,string>();const credentials={getPassword:async(s:string,a:string)=>values.get(s+':'+a)??null,setPassword:async(s:string,a:string,v:string)=>{values.set(s+':'+a,v);},deletePassword:async(s:string,a:string)=>values.delete(s+':'+a)};
 const state={issued:0,paused:false,funded:true,revoked:false,offline:false,binding:'',email:'',lastToken:'',requests:[] as string[],asked:false,grantOnRequest:false,notes:[] as string[]};
 const session='s'.repeat(43);
 const fetcher:typeof fetch=async(url,init)=>{
  if(state.offline)throw new Error('synthetic network outage');
  const path=new URL(String(url)).pathname;state.requests.push(path);const headers=init?.headers as Record<string,string>;
  assert.equal(headers['X-Factoryze-Desktop'],'1');assert.equal(headers.Origin,undefined);
  const body=init?.body?JSON.parse(init.body as string):{};
  const json=(r:unknown,status=200)=>new Response(JSON.stringify(r),{status,headers:{'content-type':'application/json'}});
  if(path.endsWith('/request-otp')){state.binding=body.binding;state.email=body.email;assert.match(state.binding,/^[A-Za-z0-9_-]{43}$/);return json({message:'Requested'},202);}
  if(path.endsWith('/verify-otp')){assert.equal(body.binding,state.binding);if(body.code!=='123456')return json({error:{code:'invalid_or_expired_code',message:'private'}},401);return json({sessionToken:session,expiresAt:new Date(Date.now()+8*3600000).toISOString()});}
  assert.equal(headers.Authorization,`Bearer ${session}`);
  if(state.revoked)return json({error:{code:'authentication_required'}},401);
  if(path.endsWith('/account'))return json({account:{id:'email:synthetic',email:state.email,claimed:state.funded,suspended:false,grantedMicro:state.funded?1000000:0,spentMicro:100,reservedMicro:0,availableMicro:state.funded?999900:0,expiresAt:new Date(Date.now()+86400000).toISOString()},sessionExpiresAt:new Date(Date.now()+8*3600000).toISOString(),inferenceEnabled:true,programEnabled:!state.paused,creditRequested:state.asked,starterCreditFutureField:true,
   models:[{id:'trial-coder',object:'model',owned_by:'factoryze',maxInputTokens:32768,maxOutputTokens:1024,outputParameter:'max_tokens'}],maxRequestBytes:65536,maxMessages:128,maxTools:32});
  if(path.endsWith('/trial/token')){state.issued++;state.lastToken=String(state.issued%10).repeat(43);return json({token:state.lastToken,basePath:'/api/gateway/v1',expiresAt:new Date(Date.now()+60000).toISOString()},201);}
  if(path.endsWith('/trial/request-credit')){state.notes.push(body.note);if(state.grantOnRequest){state.funded=true;return json({status:'granted'});}state.asked=true;return json({status:'requested'});}
  if(path.endsWith('/auth/logout'))return json({ok:true});
  throw new Error('Unexpected test path');
 };
 const create=()=>new ModelSettingsStore(credentials,'test','win32',{origin:'https://trial.example',fetcher});
 return {state,values,create,store:create()};
}
test('trial signup exposes only account data, preserves BYOK and survives a desktop restart',async()=>{
 const {store,state,values,create}=fixture();await store.save({...setup,apiKey:'synthetic-own-secret'});
 await store.trial.request(' USER@example.test ');await assert.rejects(store.trial.verify('000000'),/incorrect or expired/);const view=await store.trial.verify('123456');assert.equal(view.account?.email,'user@example.test');assert.equal(view.selected,false);
 assert.ok(!JSON.stringify(view).includes('sessionToken'));assert.ok(!JSON.stringify(view).includes(state.binding));
 assert.equal((await store.load({}))?.model,'own-model');
 const selected=await store.trial.select('trial-coder');assert.equal(selected.authentication,'trial');assert.equal(isModelConfigured(selected),true);
 const restarted=create();const trial=await restarted.forEngine({});assert.equal(trial?.provider.apiKey,'');assert.equal(trial?.provider.authentication,'trial');assert.equal(trial?.modules?.judge,false);
 assert.ok([...values.values()].some(v=>v.includes('synthetic-own-secret')));
 await restarted.save({...setup,apiKey:''});assert.equal((await restarted.forEngine({}))?.provider.apiKey,'synthetic-own-secret');
 await restarted.trial.select('trial-coder');assert.equal((await restarted.load({}))?.authentication,'trial');
});
test('gateway renewal is single-flight, short-lived and never rewrites the saved BYOK key',async(t)=>{
 const {store,state}=fixture();await store.trial.request('renew@example.test');await store.trial.verify('123456');await store.trial.select('trial-coder');
 const selected=await store.forEngine({});const authorize=selected!.provider.trial!.authorize;
 const result=await Promise.all([authorize(),authorize()]);assert.equal(state.issued,1);assert.equal(result[0],result[1]);
 await authorize();assert.equal(state.issued,1);
 const now=Date.now();t.mock.method(Date,'now',()=>now+61000);await authorize();assert.equal(state.issued,2);
 t.mock.method(Date,'now',()=>now+9*3600000);await assert.rejects(authorize,/expired/i);
 assert.equal((await store.load({}))?.authentication,'trial');assert.equal(isModelConfigured(await store.load({})),false);
});
test('revocation, lack of credit and paused service never fall back to BYOK',async()=>{
 const {store,state}=fixture();await store.save({...setup,apiKey:'saved-byok'});await store.trial.request('guard@example.test');await store.trial.verify('123456');await store.trial.select('trial-coder');
 state.paused=true;await assert.rejects(store.forEngine({}),/paused/i);assert.equal(state.issued,0);
 state.paused=false;state.funded=false;await assert.rejects(store.forEngine({}),/credit/i);assert.equal(isModelConfigured(await store.load({})),false);
 state.funded=true;state.revoked=true;assert.equal((await store.load({}))?.authentication,'trial');assert.equal(isModelConfigured(await store.load({})),false);
 assert.equal((await store.loadByok({}))?.model,'own-model');
});
test('trial logout clears the device credential and keeps the saved BYOK connection',async()=>{
 const {store,values}=fixture();await store.save({...setup,apiKey:'keep-my-key'});await store.trial.request('logout@example.test');await store.trial.verify('123456');await store.trial.select('trial-coder');await store.trial.logout();
 assert.equal((await store.trial.view()).signedIn,false);assert.ok([...values.values()].every(v=>!v.includes('"sessionToken"')));assert.ok([...values.values()].some(v=>v.includes('keep-my-key')));
});

test('an unavailable trial service leaves an explicit BYOK route without selecting it automatically',async()=>{
 const {store,state}=fixture();await store.save({...setup,apiKey:'preserved-offline-key'});await store.trial.request('offline@example.test');await store.trial.verify('123456');await store.trial.select('trial-coder');state.offline=true;
 const settings=await store.load({});assert.equal(settings?.authentication,'trial');assert.equal(settings?.hasKey,false);assert.equal((await store.loadByok({}))?.model,'own-model');
 await store.save({...setup,apiKey:''});assert.equal((await store.forEngine({}))?.provider.apiKey,'preserved-offline-key');
});

test('the desktop uses the hosted trial service on code.factoryze.tech unless FACTORYZE_TRIAL_URL overrides it', () => {
  const storage = { read: async () => null, write: async () => {} }, saved = process.env.FACTORYZE_TRIAL_URL;
  try {
    delete process.env.FACTORYZE_TRIAL_URL;
    assert.equal(new TrialConnectionStore(storage).client.origin, 'https://code.factoryze.tech');
    process.env.FACTORYZE_TRIAL_URL = 'http://127.0.0.1:8091';
    assert.equal(new TrialConnectionStore(storage).client.origin, 'http://127.0.0.1:8091');
  } finally { if (saved === undefined) delete process.env.FACTORYZE_TRIAL_URL; else process.env.FACTORYZE_TRIAL_URL = saved; }
});

test('an expired desktop sign-in is removed from the credential store', async t => {
  const {store, values, state} = fixture();
  const second = fixture();
  await store.trial.request('expired@example.test');
  await store.trial.verify('123456');
  await second.store.trial.request('claim@example.test');
  await second.store.trial.verify('123456');
  assert.ok([...values.values()].some(value => value.includes('"sessionToken"')));
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 9 * 3600000);
  const callsBefore = state.requests.length;
  assert.equal((await store.trial.view()).signedIn, false);
  assert.equal(state.requests.length, callsBefore, 'expired session must not reach the service');
  assert.ok([...values.values()].every(value => !value.includes('"sessionToken"')));
  const secondCalls = second.state.requests.length;
  await assert.rejects(second.store.trial.requestCredit(), /expired/i);
  assert.equal(second.state.requests.length, secondCalls, 'expired session must not request credit');
  assert.ok([...second.values.values()].every(value => !value.includes('"sessionToken"')));
});

test('desktop result sharing uses the native account session without selecting a funded model', async () => {
 const values=new Map<string,string>(), calls:{method:string;path:string;body:string}[]=[];
 const token='s'.repeat(43), shareID='r'.repeat(43), expiresAt=new Date(Date.now()+86400000).toISOString();
 let published=false,binding='';
 const fetcher:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,method=init?.method??'GET',body=String(init?.body??'');
  calls.push({method,path,body});
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers['X-Factoryze-Desktop'],'1');assert.equal(headers.Origin,undefined);
  if(path.endsWith('/request-otp')){binding=JSON.parse(body).binding;return new Response('{}',{status:202});}
  if(path.endsWith('/verify-otp')){assert.equal(JSON.parse(body).binding,binding);return Response.json({sessionToken:token,expiresAt});}
  assert.equal(headers.Authorization,`Bearer ${token}`);
  if(path.endsWith('/account'))return Response.json({account:{id:'email:share',email:'share@example.test',claimed:false,suspended:false,grantedMicro:0,spentMicro:0,reservedMicro:0,availableMicro:0,expiresAt},
   sessionExpiresAt:expiresAt,inferenceEnabled:false,programEnabled:false,models:[],maxRequestBytes:65536,maxMessages:128,maxTools:32});
  if(method==='POST'){published=true;return Response.json({published:true,url:`https://trial.example/api/desktop-shares/${shareID}`,expiresAt});}
  if(method==='DELETE'){published=false;return Response.json({published:false});}
  return Response.json(published?{published:true,url:`https://trial.example/api/desktop-shares/${shareID}`,expiresAt}:{published:false});
 };
 const store=new TrialConnectionStore({read:async()=>values.get('session')??null,write:async value=>{values.set('session',value);}},'https://trial.example',fetcher);
 await assert.rejects(store.resultShareStatus('a'.repeat(64)),/sign-in/i);
 await store.request('share@example.test');await store.verify('123456');
 const input={reportKey:'a'.repeat(64),taskId:'delivery-rule',title:'Delivery rule',submittedAt:'2026-11-17T00:00:00.000Z',passed:2,total:3};
 assert.deepEqual(await store.resultShareStatus(input.reportKey),{published:false});
 assert.equal((await store.publishResultShare(input)).published,true);
 assert.equal((await store.resultShareStatus(input.reportKey)).published,true);
 await store.revokeResultShare(shareID);
 assert.equal((await store.resultShareStatus(input.reportKey)).published,false);
 assert.equal(calls.filter(call=>call.method==='POST'&&call.path.endsWith('/result-shares'))[0].body,JSON.stringify(input));
 assert.ok(calls.some(call=>call.method==='DELETE'));
});

test('asking for credit needs no code: it records a request, or returns credit that was already waiting', async () => {
 const {store,state}=fixture();state.funded=false;
 await store.trial.request('ask@example.test');const signedIn=await store.trial.verify('123456');
 assert.equal(signedIn.account?.claimed,false);assert.equal(signedIn.creditRequested,false);
 const waiting=await store.trial.requestCredit('  Trying the starter tasks  ');
 assert.equal(waiting.creditRequested,true);assert.equal(waiting.account?.claimed,false);assert.deepEqual(state.notes,['Trying the starter tasks']);
 assert.ok(state.requests.some(path=>path.endsWith('/api/desktop/trial/request-credit')));
 // Approval shows up on the next look at the account, with no further step.
 state.funded=true;state.asked=false;const approved=await store.trial.view();
 assert.equal(approved.account?.claimed,true);assert.equal(approved.creditRequested,false);
 const second=fixture();second.state.funded=false;second.state.grantOnRequest=true;
 await second.store.trial.request('starter@example.test');await second.store.trial.verify('123456');
 const granted=await second.store.trial.requestCredit();assert.equal(granted.account?.claimed,true);assert.equal(granted.creditRequested,false);
 const signedOut=fixture();await assert.rejects(signedOut.store.trial.requestCredit(),/sign-in expired/i);
 assert.equal(signedOut.state.requests.length,0,'a signed-out desktop must not call the service');
});
