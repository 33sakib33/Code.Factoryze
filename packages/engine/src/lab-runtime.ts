import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { labAgentStartSchema, labAgentPromptSchema, labAgentPollSchema, labAgentResultSchema,
  type LabAgentEvent, type HarnessToolCall, type GatewayConnection, type UsageTotals, gatewayErrorMessages, type GatewayErrorCode } from '@factoryze/protocol';
import { LabError, type LabEngine } from './lab.ts';
import { HarnessSession } from '#harness';
import { createGateway, type Provider } from '#gateway';
import { AccountingError } from '#usage-store';

type Context = ReturnType<LabEngine['access']>;
type Pending = {call:HarnessToolCall;resolve(value:string):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>};
type Session = {id:string;connection:string;token:string;context:Context;brain:HarnessSession;events:LabAgentEvent[];sequence:number;
  pending:Map<string,Pending>;results:Map<string,string>;gateway:ReturnType<typeof createGateway>;active?:Promise<void>;promptId?:string;closing?:Promise<void>};
export type LabRuntimeOptions = {provider:Provider;api:'openai-chat'|'anthropic-messages';providerHost:string;model?:string;contextWindow:number;maxOutputTokens:number;
  /** Instructor-facing server log; defaults to one JSON line on stderr. */
  log?:(entry:{event:'lab_agent_failed';lab:string;studentId:string;code:string})=>void};

const providerBusy=new Set<GatewayErrorCode>(['provider_rate_limited','provider_unavailable']);
/** Harness limits whose fixed wording already tells the student what to do. */
const harnessNotices=[/^Stopped after \d+ model steps\./,/^Context limit reached\./,/^Student tool approval timed out$/];
/** Map a failed lab turn to a fixed student message and a code for the instructor. Upstream text never reaches the student. */
function labFailure(error:unknown):{code:string;message:string} {
  if(error instanceof AccountingError)return{code:'accounting',message:error.message};
  const text=error instanceof Error?error.message:'';
  const code=(Object.keys(gatewayErrorMessages) as GatewayErrorCode[]).find(key=>gatewayErrorMessages[key]===text);
  if(code&&providerBusy.has(code))return{code,message:"The lab's model provider is busy or unavailable. Your work is saved; wait a moment and send the prompt again."};
  if(code)return{code,message:"The lab's model provider refused this request. Your work is saved. Tell your instructor; the server log shows the reason."};
  if(harnessNotices.some(pattern=>pattern.test(text)))return{code:'harness_limit',message:text};
  return{code:'unknown',message:'The lab agent stopped or could not complete this request. Check your connection and the recorded usage.'};
}

/** The server runs the unchanged Factoryze loop. Every tool is dispatched to the student's approved local hands. */
export class LabRuntime {
  private readonly sessions=new Map<string,Session>();
  private readonly starts=new Map<string,Promise<unknown>>();
  private readonly engine:LabEngine;
  private readonly options:LabRuntimeOptions;
  constructor(engine:LabEngine,options:LabRuntimeOptions){this.engine=engine;this.options=options;}
  private emit(session:Session,kind:LabAgentEvent['kind'],data:unknown):void {
    session.events.push({sequence:++session.sequence,kind,data});
    while(session.events.length>1000||Buffer.byteLength(JSON.stringify(session.events))>2_097_152)session.events.shift();
  }
  private session(token:string,id:string):Session {
    const context=this.engine.access(token),session=this.sessions.get(context.id);
    if(!session||session.id!==id||session.token!==token)throw new LabError(409,'Lab agent session expired; start a new session');return session;
  }
  async start(token:string,input:unknown):Promise<{session:string;usage:UsageTotals}> {
    const request=labAgentStartSchema.parse(input),context=this.engine.access(token),prior=this.starts.get(context.id);
    if(prior){await prior;return this.start(token,input);}
    const task=this.startSession(token,request);this.starts.set(context.id,task);
    try{return await task;}finally{this.starts.delete(context.id);}
  }
  private async startSession(token:string,request:{revision:number;connectionId:string}) {
    this.engine.assertOpen(token);const context=this.engine.access(token),definition=context.definition;
    if(this.engine.mirror(token).revision!==request.revision)throw new LabError(409,'Lab mirror revision conflict');
    if(definition.providerHost!==this.options.providerHost||(this.options.model&&definition.config.agent.model!==this.options.model))throw new LabError(409,'Lab model/provider does not match the server configuration');
    const current=this.sessions.get(context.id);
    if(current&&current.connection===request.connectionId&&current.token===token)return {session:current.id,usage:context.store.totals(context.account_id)};
    if(current)await this.stopSession(current);
    const id=randomUUID(),gatewayToken=randomBytes(32).toString('hex');
    const session={} as Session;
    const gateway=createGateway(this.options.provider,{accounting:{store:context.store,accountId:context.account_id,token:gatewayToken,
      workspace:context.workspace,sessionId:id,model:definition.config.agent.model,api:this.options.api,onUsage:()=>this.emit(session,'usage',context.store.totals(context.account_id))}});
    await new Promise<void>((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
    const address=gateway.address();if(!address||typeof address==='string')throw Error('Lab task gateway did not start');
    const connection:GatewayConnection={baseURL:`http://127.0.0.1:${address.port}/v1`,sessionToken:gatewayToken,model:definition.config.agent.model,
      api:this.options.api,contextWindow:this.options.contextWindow,maxOutputTokens:this.options.maxOutputTokens,temperature:0};
    const brain=new HarnessSession({gateway:connection,temperature:0,checkBudget:()=>{
      this.engine.assertOpen(token);const usage=context.store.totals(context.account_id);
      if(usage.status==='incomplete')throw new AccountingError('Lab token accounting is incomplete; ask the instructor to reconcile it',409);
      if(usage.status==='exhausted')throw new AccountingError('Lab token budget exhausted',402);
    },onUpdate:update=>{
      this.emit(session,'update',update);
      if(update.sessionUpdate!=='agent_message_chunk')context.store.appendEvent(context.workspace,context.account_id,id,'acp_update@1',
        {sessionUpdate:update.sessionUpdate,toolCallId:update.toolCallId,kind:update.kind,status:update.status,...(session.promptId?{promptId:session.promptId}:{})});
    },execute:(call,signal)=>new Promise<string>((resolve,reject)=>{
      const ticket=randomUUID(),timer=setTimeout(()=>{session.pending.delete(ticket);reject(Error('Student tool approval timed out'));},300_000);
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);};
      const aborted=()=>{session.pending.delete(ticket);cleanup();reject(Error('Lab agent stopped'));};
      signal.addEventListener('abort',aborted,{once:true});
      session.pending.set(ticket,{call,timer,resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});
      this.emit(session,'tool',{id:ticket,call});
    })});
    Object.assign(session,{id,connection:request.connectionId,token,context,brain,events:[],sequence:0,pending:new Map(),results:new Map(),gateway});
    this.sessions.set(context.id,session);
    context.store.appendEvent(context.workspace,context.account_id,id,'session_started@1',{judge:false,scoring:false,pin:{profile:definition.config.agent.profile,
      model:definition.config.agent.model,providerHost:definition.providerHost,temperature:0,os:process.platform}});
    await brain.start();return {session:id,usage:context.store.totals(context.account_id)};
  }
  prompt(token:string,input:unknown):{state:string} {
    const request=labAgentPromptSchema.parse(input),session=this.session(token,request.session),context=session.context;
    this.engine.assertOpen(token);
    if(this.engine.mirror(token).revision!==request.revision)throw new LabError(409,'Lab mirror revision conflict');
    if(session.active&&session.promptId!==request.requestId)throw new LabError(409,'Wait for the current prompt');
    const state=this.engine.artifacts.operation(context.id,request.requestId,request.text);
    if(state!=='new')return {state};
    session.promptId=request.requestId;
    const log=(type:string,data:Record<string,unknown>)=>context.store.appendEvent(context.workspace,context.account_id,session.id,type,{promptId:request.requestId,...data});
    log('prompt_started@1',{characters:request.text.length,hash:createHash('sha256').update(request.text).digest('hex')});
    this.emit(session,'assessment',{promptId:request.requestId,model:context.definition.config.agent.model,status:'off',acceptedEdit:false});
    session.active=(async()=>{
      let reason='failed';
      try {reason=await session.brain.prompt(request.text);if(reason==='end_turn')context.store.recordTurn(context.account_id,context.workspace);}
      catch(error) {const failure=labFailure(error);this.emit(session,'error',{message:failure.message});
        const entry={event:'lab_agent_failed' as const,lab:context.lab_id,studentId:context.student_id,code:failure.code};
        try{(this.options.log??(value=>console.error(JSON.stringify(value))))(entry);}catch{/* Logging never affects the turn. */}}
      finally {log('prompt_ended@1',{reason});this.engine.artifacts.complete(context.id,request.requestId);this.emit(session,'usage',context.store.totals(context.account_id));
        this.emit(session,'complete',{reason});session.active=undefined;session.promptId=undefined;}
    })();
    return {state:'running'};
  }
  poll(token:string,input:unknown):{events:LabAgentEvent[]} {
    const request=labAgentPollSchema.parse(input),session=this.session(token,request.session);
    if(session.events.length&&request.after<session.events[0]!.sequence-1)throw new LabError(409,'Lab event history expired; start a new session');
    return {events:session.events.filter(event=>event.sequence>request.after).slice(0,100)};
  }
  result(token:string,input:unknown):void {
    const request=labAgentResultSchema.parse(input),session=this.session(token,request.session);this.engine.assertOpen(token);
    const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),prior=session.results.get(request.id);
    if(prior){if(prior!==hash)throw new LabError(409,'Tool result replay conflict');return;}
    const pending=session.pending.get(request.id);if(!pending)throw new LabError(409,'Tool request is not pending');
    if(this.engine.mirror(token).revision!==request.revision)throw new LabError(409,'Lab mirror revision conflict');
    for(const approval of request.approvals){
      if(approval.toolCallId!==pending.call.id||!['edit','write','shell'].includes(pending.call.name)||approval.kind!==(pending.call.name==='shell'?'execute':'edit'))throw new LabError(400,'Invalid tool approval metadata');
      session.context.store.appendEvent(session.context.workspace,session.context.account_id,session.id,'permission_decision@1',{...approval,promptId:session.promptId,source:'untrusted-client'});
    }
    session.results.set(request.id,hash);if(session.results.size>512)session.results.delete(session.results.keys().next().value!);
    session.pending.delete(request.id);pending.resolve(request.result);
  }
  async stop(token:string):Promise<void>{const context=this.engine.access(token),session=this.sessions.get(context.id);if(session)await this.stopSession(session);}
  async stopStudent(lab:string,studentId?:string):Promise<void>{await Promise.all([...this.sessions.values()].filter(session=>session.context.lab_id===lab&&(!studentId||session.context.student_id===studentId)).map(session=>this.stopSession(session)));}
  private stopSession(session:Session):Promise<void>{return session.closing??=(async()=>{
    session.brain.stop();for(const pending of session.pending.values())pending.reject(Error('Lab agent stopped'));session.pending.clear();
    session.gateway.closeAllConnections();await new Promise<void>(resolve=>session.gateway.close(()=>resolve()));
    await session.active;await session.context.store.exclusive(session.context.account_id,async()=>{});this.sessions.delete(session.context.id);
  })();}
  async sweep():Promise<void>{for(const session of [...this.sessions.values()]){try{this.engine.assertOpen(session.token);}catch{await this.stopSession(session);}}}
  async close():Promise<void>{await Promise.all([...this.sessions.values()].map(session=>this.stopSession(session)));}
}
