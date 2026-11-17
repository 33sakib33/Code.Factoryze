import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { taskPackSchema, trialAccountSchema, trialModelSchema, type TaskPack, type TrialModel } from '@factoryze/protocol';

/** A task published by the service's administrators; its archive must match `sha256` exactly. */
export type HostedTask = TaskPack & { sha256: string; archiveBytes: number };
const maxHostedArchive = 20 * 1024 * 1024;

const messages: Record<string,string> = {
 invalid_or_expired_code: 'The code is incorrect or expired. Request a new code if needed.',
 rate_limited: 'Too many requests. Wait before trying again.',
 invalid_invitation: 'This invitation is invalid, expired or belongs to another account.',
 trial_already_claimed_or_revoked: 'This account has already claimed its trial or access was revoked.',
 authentication_required: 'Your trial sign-in expired. Sign in again.', access_revoked: 'Your trial access was revoked. Sign in again or contact the owner.',
 trial_unavailable: 'Trial credit is unavailable. Check enrollment, expiry and remaining credit.',
 email_login_not_configured: 'Email sign-in is not enabled on this trial service.',
 hosted_task_unavailable: 'This task is no longer published. Return to Home to see the current list.',
 hosted_task_corrupt: 'The downloaded task did not match the published version. Try again.'
};
export class TrialError extends Error { readonly code:string; constructor(code:string) { super(messages[code] ?? 'The trial service is unavailable. Try again later.'); this.code=code; } }
export function trialOrigin(value: string): string {
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||
  (url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('Trial service must use HTTPS (loopback HTTP is allowed for development).');
 return url.origin;
}
export class TrialClient {
 readonly origin: string; private readonly fetcher:typeof fetch;
 constructor(origin:string,fetcher:typeof fetch=fetch){this.origin=trialOrigin(origin);this.fetcher=fetcher;}
 async call(path: string, token?: string, body?: unknown, signal?: AbortSignal, maxBytes = 65536, method?:'GET'|'POST'|'DELETE'): Promise<Record<string,any>> {
  const res=await this.fetcher(`${this.origin}/api/desktop${path}`,{method:method??(body===undefined?'GET':'POST'),redirect:'error',
   signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]),
   headers:{'X-Factoryze-Desktop':'1',...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}).catch(()=>{throw new TrialError('service_unavailable');});
  const reader=res.body?.getReader();let raw='';let bytes=0;const decoder=new TextDecoder();
  try {if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new TrialError('service_unavailable');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
  finally {await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  let data:Record<string,any>;try{data=JSON.parse(raw);}catch{throw new TrialError('service_unavailable');}
  if(!res.ok){
   const code=typeof data.error?.code==='string'?data.error.code:'service_unavailable';
   throw new TrialError(res.status===401&&!['invalid_or_expired_code','access_revoked'].includes(code)?'authentication_required':code);
  }
  return data;
 }
 async account(token:string) {
  const r=await this.call('/account',token);
  const models:TrialModel[]=(Array.isArray(r.models)?r.models:[]).map((m:any)=>trialModelSchema.parse({id:m.id,maxInputTokens:m.maxInputTokens,maxOutputTokens:m.maxOutputTokens,outputParameter:m.outputParameter}));
  if(typeof r.inferenceEnabled!=='boolean'||typeof r.programEnabled!=='boolean'||!Number.isFinite(Date.parse(r.sessionExpiresAt)))throw new TrialError('service_unavailable');
  return {account:trialAccountSchema.parse(r.account),models,sessionExpiresAt:r.sessionExpiresAt as string,inferenceEnabled:r.inferenceEnabled,programEnabled:r.programEnabled,
   maxRequestBytes:Math.min(65536,Number(r.maxRequestBytes)||65536),maxMessages:Math.min(128,Number(r.maxMessages)||128),maxTools:Math.min(32,Number(r.maxTools)||32)};
 }
 /** Enabled hosted tasks for a signed-in account. Malformed entries are skipped rather than trusted. */
 async tasks(token:string):Promise<HostedTask[]> {
  return this.parseTasks(await this.call('/tasks',token,undefined,undefined,8_388_608));
 }
 /** Public catalog metadata is visible without a session; starting a hosted task still requires sign-in. */
 async publicTasks():Promise<HostedTask[]> {
  return this.parseTasks(await this.publicCatalog('/api/tasks',8_388_608));
 }
 async publicTasksPage(input:{query:string;topic:string;after:string;limit:number}):Promise<{tasks:HostedTask[];nextCursor:string}> {
  if(input.query.length>80||input.topic.length>40||input.after.length>100||!Number.isInteger(input.limit)||input.limit<1||input.limit>50)throw new TrialError('service_unavailable');
  const params=new URLSearchParams({limit:String(input.limit)});
  if(input.query)params.set('q',input.query);
  if(input.topic)params.set('topic',input.topic);
  if(input.after)params.set('after',input.after);
  const data=await this.publicCatalog(`/api/tasks/search?${params}`,2_097_152);
  if(!Array.isArray(data.tasks)||data.tasks.length>input.limit)throw new TrialError('service_unavailable');
  if(typeof data.nextCursor!=='string'||(data.nextCursor!==''&&!/^[a-z][a-z0-9-]{0,99}$/.test(data.nextCursor)))throw new TrialError('service_unavailable');
  return {tasks:this.parseTasks(data),nextCursor:data.nextCursor};
 }
 async publicTaskTopics():Promise<{id:string;count:number}[]> {
  const data=await this.publicCatalog('/api/tasks/topics',262_144);
  if(!Array.isArray(data.topics)||data.topics.length>1000||!data.topics.every((item:any)=>item&&
    typeof item.id==='string'&&(item.id==='__untagged'||/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item.id))&&
    Number.isSafeInteger(item.count)&&item.count>0))throw new TrialError('service_unavailable');
  return data.topics;
 }
 async publicTask(id:string):Promise<HostedTask> {
  if(!/^[a-z][a-z0-9-]{0,99}$/.test(id))throw new TrialError('hosted_task_unavailable');
  const data=await this.publicCatalog(`/api/tasks/${encodeURIComponent(id)}`,65_536);
  const item=this.parseTasks({tasks:[data]})[0];
  if(!item||item.id!==id)throw new TrialError('hosted_task_unavailable');
  return item;
 }
 private async publicCatalog(path:string,maxBytes:number):Promise<Record<string,any>> {
  const response=await this.fetcher(`${this.origin}${path}`,{redirect:'error',signal:AbortSignal.timeout(15000)}).catch(()=>{throw new TrialError('service_unavailable');});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new TrialError(response.status===404?'hosted_task_unavailable':'service_unavailable');}
  const reader=response.body?.getReader(),decoder=new TextDecoder();let raw='',bytes=0;
  try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new TrialError('service_unavailable');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
  finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  try{return JSON.parse(raw);}catch{throw new TrialError('service_unavailable');}
 }
 private parseTasks(r:Record<string,any>):HostedTask[] {
  const result:HostedTask[]=[];
  for(const item of Array.isArray(r.tasks)?r.tasks:[]){
   if(!item||typeof item!=='object')continue;
   const {sha256,archiveBytes,...pack}=item as Record<string,unknown>,parsed=taskPackSchema.safeParse(pack);
   if(parsed.success&&!parsed.data.retired&&typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256)&&Number.isSafeInteger(archiveBytes)&&(archiveBytes as number)>0&&(archiveBytes as number)<=maxHostedArchive)
    result.push({...parsed.data,sha256,archiveBytes:archiveBytes as number});
  }
  return result;
 }
 /** Downloads a hosted task's archive and writes it only if its size and SHA-256 match the catalog entry. */
 async downloadTask(token:string,task:HostedTask,destination:string,signal?:AbortSignal):Promise<void> {
  const res=await this.fetcher(`${this.origin}/api/desktop/tasks/${encodeURIComponent(task.id)}/archive`,{redirect:'error',
   signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)]),headers:{'X-Factoryze-Desktop':'1',Authorization:`Bearer ${token}`}}).catch(()=>{throw new TrialError('service_unavailable');});
  if(!res.ok){await res.body?.cancel().catch(()=>{});throw new TrialError(res.status===401?'authentication_required':res.status===404?'hosted_task_unavailable':'service_unavailable');}
  const reader=res.body?.getReader(),chunks:Uint8Array[]=[],hash=createHash('sha256');let bytes=0;
  try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>task.archiveBytes)throw new TrialError('hosted_task_corrupt');hash.update(value);chunks.push(value);}}
  finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  if(bytes!==task.archiveBytes||hash.digest('hex')!==task.sha256)throw new TrialError('hosted_task_corrupt');
  try{await writeFile(destination,Buffer.concat(chunks),{mode:0o600,flag:'wx'});}catch(error){await rm(destination,{force:true});throw error;}
 }
}
