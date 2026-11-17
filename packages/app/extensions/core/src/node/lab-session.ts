import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentClient } from '../common/agent-service';
import { LabConnectionStore } from '#lab-connection';
import { HarnessTools } from '#harness-tools';
import { LabClientError } from '@factoryze/engine/lab-client';
import type { LabAgentEvent, GatewayConnection, UsageTotals } from '@factoryze/protocol';

/** A transport adapter only: the server owns the agent loop and accounting. */
export class RemoteLabSession {
  private readonly abort=new AbortController();
  private readonly connectionId=randomUUID();
  private session='';private after=0;private busy=false;private failed?:Error;
  private readonly tools=new Map<string,Promise<void>>();
  private currentUsage!:UsageTotals;
  private readonly store:LabConnectionStore;private readonly workspace:string;private readonly client:AgentClient;
  private constructor(store:LabConnectionStore,workspace:string,client:AgentClient){this.store=store;this.workspace=workspace;this.client=client;}
  static async connect(store:LabConnectionStore,workspace:string,client:AgentClient):Promise<RemoteLabSession>{
    const session=new RemoteLabSession(store,workspace,client),synced=await store.sync(workspace),remote=await store.client(workspace);
    const started=await remote.request('POST','/v1/agent/start',{connectionId:session.connectionId,revision:synced.revision});session.session=started.session;session.currentUsage=started.usage;return session;
  }
  totals():UsageTotals{return this.currentUsage;}
  private async request(path:string,body:unknown):Promise<any>{const client=await this.store.client(this.workspace);
    for(let attempt=0;;attempt++){this.abort.signal.throwIfAborted();try{return await client.request('POST',path,body,this.abort.signal);}catch(error){
      if(error instanceof LabClientError||this.abort.signal.aborted||attempt>=2)throw error;await delay(200,{},{signal:this.abort.signal});}}
  }
  async prompt(text:string):Promise<string>{
    if(this.busy)throw Error('Wait for the current prompt');this.busy=true;this.failed=undefined;
    try{const synced=await this.store.sync(this.workspace),response=await this.request('/v1/agent/prompt',{session:this.session,requestId:randomUUID(),revision:synced.revision,text});
      if(response.state==='interrupted')throw Error('That lab request was interrupted. Start a new session.');
      for(;;){if(this.failed)throw this.failed;const {events}=await this.request('/v1/agent/poll',{session:this.session,after:this.after});
        for(const event of events as LabAgentEvent[]){if(event.sequence<=this.after)continue;this.after=event.sequence;
          if(event.kind==='update')this.client.onUpdate(event.data);
          else if(event.kind==='assessment')this.client.onAssessment?.(event.data as any);
          else if(event.kind==='usage'){this.currentUsage=event.data as UsageTotals;this.client.onUsage(this.currentUsage);}
          else if(event.kind==='tool'){
            const task=event.data as any;if(!this.tools.has(task.id))this.tools.set(task.id,this.executeTool(task).catch(error=>{this.failed=error instanceof Error?error:Error('Lab tool failed');}));
          }else if(event.kind==='error')this.failed=Error((event.data as any).message??'Lab agent request failed');
          else if(event.kind==='complete'){await Promise.all(this.tools.values());if(this.failed)throw this.failed;await this.store.refresh(this.workspace).catch(()=>{});return(event.data as any).reason;}
        }
        if(response.state==='complete'&&!events.length)return'end_turn';
        await delay(100,undefined,{signal:this.abort.signal});
      }
    }finally{this.busy=false;}
  }
  private async executeTool(task:any):Promise<void>{
    const approvals:any[]=[],view=await this.store.view(this.workspace),env=await this.store.handsEnvironment(this.workspace);
    const gateway:GatewayConnection={baseURL:'http://127.0.0.1:1/v1',sessionToken:'local-hands-only',model:view.model,api:'openai-chat',contextWindow:32768,maxOutputTokens:1024,
      ...(env.PIP_INDEX_URL?{packageIndexURL:env.PIP_INDEX_URL}:{}),...(env.PIP_CONFIG_FILE?{pipConfigFile:env.PIP_CONFIG_FILE}:{})};
    const hands=new HarnessTools({cwd:this.workspace,gateway,onPermission:async params=>{const selected=await this.client.requestPermission(params),option=params.options.find(item=>item.optionId===selected);
      approvals.push({toolCallId:params.toolCall.toolCallId,kind:params.toolCall.kind,approved:option?.kind==='allow_once',outcome:option?.kind??'cancelled'});return selected;}});
    let result:string;try{result=await hands.execute(task.call,this.abort.signal);}catch(error){this.abort.signal.throwIfAborted();result=`Tool failed: ${error instanceof Error?error.message:'Request refused'}`;}
    const {revision}=await this.store.sync(this.workspace);
    await this.request('/v1/agent/result',{session:this.session,id:task.id,revision,result:result.slice(0,16000),approvals});
  }
  async stop():Promise<void>{this.abort.abort();try{const client=await this.store.client(this.workspace);await client.request('POST','/v1/agent/stop',{});}catch{/* Offline/closed server retains accounting and will expire the session. */}await Promise.all(this.tools.values());}
}
