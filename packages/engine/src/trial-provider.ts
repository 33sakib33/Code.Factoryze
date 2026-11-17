import { randomUUID } from 'node:crypto';
import type { Provider } from './gateway.ts';
import type { ModelRequest, ModelResponse } from './replay.ts';
import type { GatewayErrorCode } from '@factoryze/protocol';

export type TrialTransport = { baseURL:string; model:string; outputParameter:'max_tokens'|'max_completion_tokens'; taskId?:string; attemptId?:string; authorize(signal?:AbortSignal):Promise<string> };
/** All calls still pass through the local metered gateway. No upstream provider credential reaches the desktop. */
export class TrialProvider implements Provider {
 private readonly config:TrialTransport; private readonly fetcher:typeof fetch;
 constructor(config:TrialTransport,fetcher:typeof fetch=fetch){
  const u=new URL(config.baseURL);if(u.username||u.password||u.search||u.hash||u.pathname!=='/api/gateway/v1'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Error('Invalid trial gateway address.');
  this.config=config;this.fetcher=fetcher;
 }
 async send(request:ModelRequest):Promise<ModelResponse> {
  request.signal?.throwIfAborted();
  let token:string;
  try{token=await this.config.authorize(request.signal);}catch(error){request.signal?.throwIfAborted();return {status:401,failureCode:(error as {code?:string}).code==='service_unavailable'?'trial_service_unavailable':'trial_sign_in_required',headers:{},body:(async function*(){})()};}
  request.signal?.throwIfAborted();
  const body=JSON.parse(request.body);
  if(body.model!==undefined&&body.model!==this.config.model)throw new Error('The trial model changed. Start a new agent session.');
  body.model=this.config.model;
  if(this.config.outputParameter==='max_completion_tokens'&&body.max_tokens!==undefined){body.max_completion_tokens=body.max_tokens;delete body.max_tokens;}
  const response=await this.fetcher(`${this.config.baseURL}/chat/completions`,{method:'POST',redirect:'error',
   signal:AbortSignal.any([...(request.signal?[request.signal]:[]),AbortSignal.timeout(80000)]),
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json','Idempotency-Key':randomUUID(),
    ...(this.config.taskId&&this.config.attemptId?{'X-Factoryze-Task-ID':this.config.taskId,'X-Factoryze-Attempt-ID':this.config.attemptId}:{})},body:JSON.stringify(body)});
  const empty=()=> (async function*(){})();
  if(!response.ok){
   let remoteCode='';const reader=response.body?.getReader();let raw='',bytes=0;const decoder=new TextDecoder();
   try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384)break;raw+=decoder.decode(value,{stream:true});}remoteCode=JSON.parse(raw)?.error?.code??'';}catch{/* Only known codes are used, never remote diagnostic messages. */}
   finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}

   const code:GatewayErrorCode=response.status===401?'trial_sign_in_required':response.status===402?(remoteCode==='program_budget_exhausted'?'trial_program_unavailable':remoteCode==='daily_trial_limit_exhausted'?'trial_daily_limit_exhausted':'trial_credit_exhausted'):response.status===403?(remoteCode==='model_not_allowed'?'trial_model_unavailable':'trial_unavailable'):response.status===409?'trial_request_conflict':response.status===429?'trial_rate_limited':response.status===400||response.status===413?'trial_request_limit':response.status===503?(remoteCode==='trials_paused'?'trial_paused':'trial_service_unavailable'):'provider_unavailable';
   return {status:response.status,failureCode:code,headers:response.headers.get('x-factoryze-request-id')?{'x-factoryze-request-id':response.headers.get('x-factoryze-request-id')!}:{},body:empty()};
  }
  const source=response.body;
  return {status:response.status,headers:{'content-type':response.headers.get('content-type')??'text/event-stream',
   ...(response.headers.get('x-factoryze-request-id')?{'x-factoryze-request-id':response.headers.get('x-factoryze-request-id')!}:{})},body:(async function*(){
    if(!source)throw new Error('Trial service returned an empty stream');
    const reader=source.getReader(),decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;yield decoder.decode(value,{stream:true});}const tail=decoder.decode();if(tail)yield tail;}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   })()};
 }
}
