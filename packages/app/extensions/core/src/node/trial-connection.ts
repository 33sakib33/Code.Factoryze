import { randomBytes } from 'node:crypto';
import { TrialClient, TrialError, type HostedTask } from '@factoryze/engine/trial-client';
import type { SoloSettings } from '@factoryze/engine/solo';
import { desktopResultShareInputSchema, desktopResultShareStateSchema, trialAccountViewSchema, type DesktopResultShareInput, type DesktopResultShareState, type TrialAccountView, type ModelSettingsView } from '@factoryze/protocol';

export type TrialRecord = { schema:'trial-connection@1'; origin:string; selected:boolean; sessionToken?:string; expiresAt?:string; model?:string; budgetTokens?:number; cached?:TrialAccountView };
type Storage = { read():Promise<string|null>; write(value:string):Promise<void> };
export class TrialConnectionStore {
 private pending?:{email:string;binding:string;expires:number};
 readonly client:TrialClient; private readonly storage:Storage;
 constructor(storage:Storage,origin=process.env.FACTORYZE_TRIAL_URL||'https://code.factoryze.tech',fetcher:typeof fetch=fetch) {this.storage=storage;this.client=new TrialClient(origin,fetcher);}
 private async record():Promise<TrialRecord> {
  const raw=await this.storage.read(); if(raw){try{const r=JSON.parse(raw);if(r.schema==='trial-connection@1')return r;}catch{/* Invalid keychain record contains no renderer-visible diagnostics. */}}
  return {schema:'trial-connection@1',origin:this.client.origin,selected:false};
 }
 private save(record:TrialRecord){return this.storage.write(JSON.stringify(record));}
 private async clearSession(record:TrialRecord){delete record.sessionToken;delete record.expiresAt;delete record.cached;await this.save(record);}
 async selected(){return (await this.record()).selected;}
 async useByok(){const r=await this.record();if(r.selected){r.selected=false;await this.save(r);}}
 async request(email:string):Promise<void>{
  email=email.trim().toLowerCase();this.pending=undefined;
  const binding=randomBytes(32).toString('base64url');
  await this.client.call('/auth/request-otp',undefined,{email,binding});
  this.pending={email,binding,expires:Date.now()+300000};
 }
 async verify(code:string):Promise<TrialAccountView>{
  const pending=this.pending;if(!pending||pending.expires<=Date.now())throw new Error('Request a new sign-in code.');
  const result=await this.client.call('/auth/verify-otp',undefined,{email:pending.email,binding:pending.binding,code});
  if(typeof result.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(result.sessionToken)||!Number.isFinite(Date.parse(result.expiresAt)))throw new TrialError('service_unavailable');
  const old=await this.record();const record:TrialRecord={schema:'trial-connection@1',origin:this.client.origin,selected:old.selected,model:old.origin===this.client.origin?old.model:undefined,budgetTokens:old.budgetTokens,sessionToken:result.sessionToken,expiresAt:result.expiresAt};
  try{await this.save(record);}catch(error){await this.client.call('/auth/logout',result.sessionToken,{}).catch(()=>{});throw error;}
  this.pending=undefined;return this.view();
 }
 async view():Promise<TrialAccountView>{
  const r=await this.record();
  const empty:TrialAccountView={origin:this.client.origin,selected:r.selected,signedIn:false,models:[],selectedModel:r.model,programEnabled:false,inferenceEnabled:false,maxRequestBytes:65536,maxMessages:128,maxTools:32};
  if(!r.sessionToken||r.origin!==this.client.origin)return empty;
  if(!r.expiresAt||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=Date.now()){await this.clearSession(r);return empty;}
  try{
   const data=await this.client.account(r.sessionToken);
   const view=trialAccountViewSchema.parse({...empty,...data,signedIn:true});
   await this.save({...r,cached:view});return view;
  }catch(error){if(error instanceof TrialError&&['authentication_required','access_revoked'].includes(error.code)){await this.clearSession(r);return empty;}throw error;}
 }
 async claim(code:string){const r=await this.requireSession();await this.client.call('/trial/claim',r.sessionToken,{code});return this.view();}
 async select(model:string):Promise<ModelSettingsView>{
  const view=await this.view();if(!view.signedIn)throw new Error('Sign in to your trial account first.');
  if(!view.models.some(m=>m.id===model))throw new Error('Select an available trial model.');
  const r=await this.record();r.model=model;r.selected=true;await this.save(r);return (await this.settings())!;
 }
 async preferences(budgetTokens?:number){const r=await this.record();if(!r.selected)throw new Error('Select a trial model first.');if(budgetTokens!==undefined){if(!Number.isSafeInteger(budgetTokens)||budgetTokens<1)throw new Error('Enter a positive token budget.');r.budgetTokens=budgetTokens;await this.save(r);}return (await this.settings())!;}
 async settings():Promise<ModelSettingsView|null>{
  const r=await this.record();if(!r.selected)return null;
  const v=await this.view().catch(()=>({signedIn:false,models:r.cached?.models??[],account:undefined,inferenceEnabled:false,programEnabled:false}));const m=v.models.find(m=>m.id===r.model);
  const a=v.account;const eligible=Boolean(a?.claimed&&!a.suspended&&Date.parse(a.expiresAt)>Date.now()&&a.availableMicro>0&&(!a.dailyLimitMicro||Boolean(a.dailyAvailableMicro)));
  return {schema:1,agent:'factoryze',api:'openai-chat',authentication:'trial',source:'trial',baseURL:this.client.origin+'/api/gateway/v1',model:r.model||'Choose a trial model',
   contextWindow:m?.maxInputTokens??8192,maxOutputTokens:m?.maxOutputTokens??1024,budgetTokens:r.budgetTokens??100000,modules:{judge:false,scoring:false},hasKey:v.signedIn&&eligible&&v.inferenceEnabled&&v.programEnabled&&Boolean(m)};
 }
 /** Enabled hosted catalog metadata is public; downloads still require a valid desktop session. */
 async hostedTasks():Promise<HostedTask[]>{return this.client.publicTasks();}
 async hostedTaskPage(input:{query:string;topic:string;after:string;limit:number}){return this.client.publicTasksPage(input);}
 async hostedTaskTopics(){return this.client.publicTaskTopics();}
 async hostedTask(id:string){return this.client.publicTask(id);}
 async downloadHostedTask(task:HostedTask,destination:string){const r=await this.requireSession();await this.client.downloadTask(r.sessionToken!,task,destination);}
 async resultShareStatus(reportKey:string):Promise<DesktopResultShareState>{
  if(!/^[a-f0-9]{64}$/.test(reportKey))throw new Error('Invalid saved report.');
  const r=await this.requireSession();
  return this.validateShareState(await this.client.call(`/result-shares?reportKey=${reportKey}`,r.sessionToken));
 }
 async publishResultShare(input:DesktopResultShareInput):Promise<DesktopResultShareState>{
  const r=await this.requireSession();
  return this.validateShareState(await this.client.call('/result-shares',r.sessionToken,desktopResultShareInputSchema.parse(input)));
 }
 private validateShareState(data:unknown):DesktopResultShareState{
  const state=desktopResultShareStateSchema.parse(data);
  if(state.published){const url=new URL(state.url);if(url.origin!==this.client.origin||!/^\/api\/desktop-shares\/[A-Za-z0-9_-]{43}$/.test(url.pathname)||url.search||url.hash)
   throw new TrialError('service_unavailable');}
  return state;
 }
 async revokeResultShare(id:string):Promise<void>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw new Error('Invalid public result link.');
  const r=await this.requireSession();
  desktopResultShareStateSchema.parse(await this.client.call(`/result-shares/${id}`,r.sessionToken,undefined,undefined,65536,'DELETE'));
 }
 private async requireSession(){const r=await this.record();if(!r.sessionToken||r.origin!==this.client.origin)throw new TrialError('authentication_required');if(!r.expiresAt||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=Date.now()){await this.clearSession(r);throw new TrialError('authentication_required');}return r;}
 async forEngine():Promise<SoloSettings>{
  const v=await this.view(),r=await this.requireSession(),model=v.models.find(m=>m.id===r.model),a=v.account;
  if(!v.inferenceEnabled||!v.programEnabled)throw new Error('Factoryze trials are paused. Your work is saved; try again later.');
  if(!model)throw new Error('Choose an available trial model in Model connection.');
  if(!a?.claimed||a.suspended||Date.parse(a.expiresAt)<=Date.now()||a.availableMicro<=0||Boolean(a.dailyLimitMicro&&a.dailyAvailableMicro===0))throw new Error('Trial credit or today’s sponsored limit is unavailable. Review your trial account in Model connection.');
  const token=r.sessionToken!;let cached:{token:string;expires:number}|undefined;let renewal:Promise<string>|undefined;
  const authorize=async(signal?:AbortSignal)=>{
   const current=await this.requireSession();if(!current.selected||current.sessionToken!==token||current.model!==model.id)throw new Error('Trial connection changed. Start a new agent session.');
   signal?.throwIfAborted();if(cached&&cached.expires>Date.now()+30000)return cached.token;
   if(!renewal)renewal=(async()=>{const issued=await this.client.call('/trial/token',token,{},signal);
    if(issued.basePath!=='/api/gateway/v1'||typeof issued.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(issued.token)||!Number.isFinite(Date.parse(issued.expiresAt)))throw new TrialError('service_unavailable');
    cached={token:issued.token,expires:Date.parse(issued.expiresAt)};return cached.token;
   })().finally(()=>{renewal=undefined;});return renewal;
  };
  return {agent:'factoryze',model:model.id,contextWindow:model.maxInputTokens,maxOutputTokens:model.maxOutputTokens,
   provider:{api:'openai-chat',baseURL:this.client.origin+'/api/gateway/v1',apiKey:'',authentication:'trial',
    trial:{baseURL:this.client.origin+'/api/gateway/v1',model:model.id,outputParameter:model.outputParameter,authorize},
    trialLimits:{maxInputTokens:model.maxInputTokens,maxRequestBytes:v.maxRequestBytes,maxMessages:v.maxMessages,maxTools:v.maxTools}},
   budget:{limit:r.budgetTokens??100000,weights:{input:1,output:1,cacheRead:0.1,cacheWrite:1}},modules:{judge:false,scoring:false}};
 }
 async logout():Promise<void>{const r=await this.record();try{if(r.sessionToken&&r.origin===this.client.origin)await this.client.call('/auth/logout',r.sessionToken,{});}finally{delete r.sessionToken;delete r.expiresAt;delete r.cached;this.pending=undefined;await this.save(r);}}
}
