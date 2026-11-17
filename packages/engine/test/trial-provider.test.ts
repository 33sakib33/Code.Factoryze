import assert from 'node:assert/strict';
import test from 'node:test';
import { TrialProvider } from '../src/trial-provider.ts';

test('trial transport uses short-lived authorization, unique idempotency and server output limits without retries', async () => {
 const requests: RequestInit[]=[]; let issued=0;
 const provider=new TrialProvider({baseURL:'https://trial.example/api/gateway/v1',model:'trial-coder',outputParameter:'max_completion_tokens',
  authorize:async()=>{issued++;return 'ephemeral-gateway-token';}},async(_url,init)=>{requests.push(init!);return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream','x-factoryze-request-id':'request-1'}});});
 const request={method:'POST',path:'/v1/chat/completions',body:JSON.stringify({model:'trial-coder',max_tokens:100,stream:true,messages:[{role:'user',content:'Synthetic'}]})};
 const a=await provider.send(request); for await(const _ of a.body){}
 await provider.send(request);
 assert.equal(issued,2);assert.equal(requests.length,2);
 const first=requests[0]!.headers as Record<string,string>;
 assert.equal(first.authorization,'Bearer ephemeral-gateway-token');assert.ok(first['Idempotency-Key']);
 assert.notEqual(first['Idempotency-Key'],(requests[1]!.headers as Record<string,string>)['Idempotency-Key']);
 const body=JSON.parse(requests[0]!.body as string);assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,100);
 assert.equal(a.headers['x-factoryze-request-id'],'request-1');
});
test('trial failures preserve a safe funding-specific error and never silently retry',async()=>{
 let calls=0; const p=new TrialProvider({baseURL:'https://trial.example/api/gateway/v1',model:'trial-coder',outputParameter:'max_tokens',authorize:async()=>'synthetic'},async()=>{calls++;return new Response(JSON.stringify({error:{code:'insufficient_credit',message:'private upstream detail'}}),{status:402});});
 const result=await p.send({method:'POST',path:'/v1/chat/completions',body:'{}'});
 assert.equal(result.failureCode,'trial_credit_exhausted');assert.equal(calls,1);
});

test('program exhaustion is distinct from personal credit and unsafe trial URLs are rejected',async()=>{
 const cfg={baseURL:'https://trial.example/api/gateway/v1',model:'trial',outputParameter:'max_tokens' as const,authorize:async()=>'synthetic'};
 const p=new TrialProvider(cfg,async()=>new Response(JSON.stringify({error:{code:'program_budget_exhausted',message:'private'}}),{status:402,headers:{'x-factoryze-request-id':'recorded-request'}}));
 const result=await p.send({method:'POST',path:'/v1/chat/completions',body:'{}'});assert.equal(result.failureCode,'trial_program_unavailable');assert.equal(result.headers['x-factoryze-request-id'],'recorded-request');
 assert.throws(()=>new TrialProvider({...cfg,baseURL:'http://untrusted.example/api/gateway/v1'}),/gateway address/);
});

test('trial calls carry stable task attribution and explain a daily limit',async()=>{
 const sent: RequestInit[]=[];
 const p=new TrialProvider({baseURL:'https://trial.example/api/gateway/v1',model:'trial',outputParameter:'max_tokens',taskId:'delivery-fee',attemptId:'15b95794-8ca8-4145-8616-590c1e4de286',authorize:async()=>'synthetic'},async(_url,init)=>{sent.push(init!);return new Response(JSON.stringify({error:{code:'daily_trial_limit_exhausted'}}),{status:402});});
 const result=await p.send({method:'POST',path:'/v1/chat/completions',body:'{}'});
 assert.equal((sent[0]!.headers as Record<string,string>)['X-Factoryze-Task-ID'],'delivery-fee');
 assert.equal((sent[0]!.headers as Record<string,string>)['X-Factoryze-Attempt-ID'],'15b95794-8ca8-4145-8616-590c1e4de286');
 assert.equal(result.failureCode,'trial_daily_limit_exhausted');
});
