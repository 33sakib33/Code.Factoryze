import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { LabClient, LabClientError } from '@factoryze/engine/lab-client';
import { captureLabFiles, labFilesHash, materializeLabFiles } from '@factoryze/engine/lab-files';
import { preparePythonEnvironment } from '@factoryze/engine/python';
import { runPracticeTests } from '@factoryze/engine/grader';
import { getSoloEngine } from '@factoryze/engine/solo';
import { factoryzeDataDir } from '@factoryze/engine/data-dir';
import { FACTORYZE_PROFILE } from '@factoryze/engine/harness';
import { pinPythonIndex } from '@factoryze/engine/package-index';
import { labDesktopJoinSchema, labTaskBundleSchema, practiceReportSchema, type LabClientConfig, type LabStudentState, type TaskPack,
  type PracticeWorkspace, type PracticeReport, type LabSync, type LabSubmission, type LabClientEvent, type LabDesktopStatus, type AttemptSummary, type ReportSummary } from '@factoryze/protocol';

export type LabSecrets={get(id:string):Promise<string|null>;set(id:string,value:string):Promise<void>;delete(id:string):Promise<void>};
type Saved={schema:1;id:string;connection:LabClientConfig;lab:string;studentId:string;workspace:string;startedAt:string;task?:TaskPack;state:LabStudentState;
  revision:number;hash:string;pending?:LabSync;pendingSubmit?:{requestId:string;revision:number};events:LabClientEvent[];reports:PracticeReport[];submissions:LabSubmission[];offline:boolean;inference:boolean;grading:boolean;packages?:boolean};
type Secret={binding:string;token?:string};
export class LabConnectionStore {
  private readonly directory:string;
  private readonly secrets:LabSecrets;
  private readonly clients=new Map<string,{token:string;client:LabClient}>();
  private readonly queues=new Map<string,Promise<unknown>>();
  private readonly monitors=new Map<string,{watcher?:FSWatcher;timer:ReturnType<typeof setInterval>;busy:boolean}>();
  private readonly packageProxies=new Map<string,Promise<{url:string;server:Server}>>();
  private readonly prepare:(workspace:string,task:TaskPack)=>Promise<void>;
  private readonly sessionsRoot:string;
  private readonly autoSync:boolean;
  readonly environment:()=>Promise<Record<string,string>>;
  constructor(secrets:LabSecrets,options:{directory?:string;sessionsRoot?:string;prepare?:(workspace:string,task:TaskPack)=>Promise<void>;monitor?:boolean;environment?:()=>Promise<Record<string,string>>}={}){
    this.secrets=secrets;this.directory=options.directory??join(factoryzeDataDir(),'lab-client');
    this.sessionsRoot=options.sessionsRoot??process.env.FACTORYZE_LAB_SESSIONS_DIR??join(homedir(),'Factoryze Labs');
    this.autoSync=options.monitor!==false;
    this.environment=options.environment??(()=>getSoloEngine().environment());
    this.prepare=options.prepare??(async(workspace,task)=>{if(!existsSync(join(workspace,'.venv','pyvenv.cfg')))await preparePythonEnvironment(workspace,task.minimumPython);});
  }
  private records():Saved[]{
    if(!existsSync(this.directory))return[];
    return readdirSync(this.directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).flatMap(name=>{
      try{const saved=JSON.parse(readFileSync(join(this.directory,name),'utf8'))as Saved;
        if(saved.schema!==1||`${saved.id}.json`!==name||!saved.workspace||!saved.connection||!Array.isArray(saved.events))return[];return[saved];}catch{return[];}
    });
  }
  private save(record:Saved):void{mkdirSync(this.directory,{recursive:true,mode:0o700});const path=join(this.directory,`${record.id}.json`),scratch=path+'.new';
    writeFileSync(scratch,JSON.stringify(record),{mode:0o600});renameSync(scratch,path);}
  private canonical(workspace:string):string{try{return realpathSync.native(workspace);}catch{return resolve(workspace);}}
  private record(workspace:string):Saved{const path=this.canonical(workspace),record=this.records().find(item=>item.workspace===path);if(!record)throw Error('This is not a joined lab attempt');return record;}
  has(workspace:string):boolean{return this.records().some(record=>record.workspace===this.canonical(workspace));}
  private async secret(record:Saved):Promise<Secret>{const raw=await this.secrets.get(record.id);if(!raw)throw Error('Lab session is missing. Ask the instructor for a recovery token.');return JSON.parse(raw);}
  async client(workspace:string):Promise<LabClient>{return this.forRecord(this.record(workspace));}
  private async forRecord(record:Saved):Promise<LabClient>{const secret=await this.secret(record);if(!secret.token)throw Error('Finish joining the lab first');
    const current=this.clients.get(record.id);if(current?.token===secret.token)return current.client;current?.client.close();
    const client=new LabClient(record.connection,secret.token);this.clients.set(record.id,{token:secret.token,client});return client;}
  async join(input:unknown):Promise<PracticeWorkspace>{
    const value=labDesktopJoinSchema.parse(input);let record=this.records().find(item=>item.connection.fingerprint===value.connection.fingerprint&&item.connection.baseURL===value.connection.baseURL&&item.lab===value.lab&&item.studentId===value.studentId);
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const ticket=join(this.directory,`join-${createHash('sha256').update(JSON.stringify([value.connection.baseURL,value.connection.fingerprint,value.lab,value.studentId])).digest('hex')}.json`);
    const savedTicket=existsSync(ticket)?JSON.parse(readFileSync(ticket,'utf8')):undefined;
    const id=record?.id??(savedTicket&&/^[a-f0-9-]{36}$/.test(savedTicket.id)?savedTicket.id:randomUUID());
    const existingSecret=await this.secrets.get(id);let secret:Secret=existingSecret?JSON.parse(existingSecret):{binding:randomBytes(32).toString('base64url')};
    if(value.recoveryToken){const probe=new LabClient(value.connection,value.recoveryToken);try{const state=await probe.student();if(state.lab!==value.lab||state.studentId!==value.studentId)throw Error('Recovery token belongs to a different lab or student');}finally{probe.close();}secret.token=value.recoveryToken;}
    await this.secrets.set(id,JSON.stringify(secret));
    writeFileSync(ticket,JSON.stringify({id}),{mode:0o600});
    if(!secret.token){
      const client=new LabClient(value.connection);
      try{const joined=await client.join({protocol:1,lab:value.lab,code:value.code,studentId:value.studentId,profile:FACTORYZE_PROFILE,binding:secret.binding});
        secret.token=joined.token;await this.secrets.set(id,JSON.stringify(secret));
        if(!record){mkdirSync(this.sessionsRoot,{recursive:true});const workspace=this.canonical(mkdtempSync(join(this.sessionsRoot,`${value.lab}-`)));
          record={schema:1,id,connection:value.connection,lab:value.lab,studentId:value.studentId,workspace,startedAt:new Date().toISOString(),state:joined.state,
            revision:0,hash:'',events:[],reports:[],submissions:[],offline:false,inference:false,grading:false};this.save(record);}
      }finally{client.close();}
    }
    if(!record){
      const client=new LabClient(value.connection,secret.token);let state:LabStudentState;try{state=await client.student();}finally{client.close();}
      if(state.lab!==value.lab||state.studentId!==value.studentId)throw Error('Recovery token belongs to a different lab or student');
      mkdirSync(this.sessionsRoot,{recursive:true});const workspace=this.canonical(mkdtempSync(join(this.sessionsRoot,`${value.lab}-`)));
      record={schema:1,id,connection:value.connection,lab:value.lab,studentId:value.studentId,workspace,startedAt:new Date().toISOString(),state,revision:0,hash:'',events:[],reports:[],submissions:[],offline:false,inference:false,grading:false};this.save(record);
    }
    await this.secrets.set(id,JSON.stringify(secret));const client=await this.forRecord(record),state=await client.student();
    if(state.lab!==record.lab||state.studentId!==record.studentId)throw Error('Lab identity does not match');record.state=state;
    if(!record.task){const bundle=labTaskBundleSchema.parse(await client.request('GET','/v1/task'));record.task=bundle.task;
      if(readdirSync(record.workspace).length===0)materializeLabFiles(record.workspace,bundle.files);
      const mirror=await client.request('GET','/v1/mirror');record.revision=mirror.revision;record.hash=mirror.hash;this.save(record);}
    await this.prepare(record.workspace,record.task!);await this.refresh(record.workspace);await this.handsEnvironment(record.workspace);
    if(existsSync(ticket))unlinkSync(ticket);this.monitor(record.workspace);return this.workspaceInfo(record.workspace);
  }
  async refresh(workspace:string):Promise<LabDesktopStatus>{const record=this.record(workspace);
    try{const client=await this.forRecord(record);record.state=await client.student();const health=await client.request('GET','/v1/health');
      record.inference=health.inference===true;record.grading=health.grading===true;record.packages=health.packages===true;record.reports=(await client.request('GET','/v1/reports')).reports.map((report:unknown)=>practiceReportSchema.parse(report));
      record.submissions=(await client.request('GET','/v1/submissions')).submissions;record.offline=false;
    }catch(error){const latest=this.record(workspace);latest.offline=true;this.save(latest);throw error;}
    const latest=this.record(workspace);Object.assign(latest,{state:record.state,inference:record.inference,grading:record.grading,packages:record.packages,reports:record.reports,submissions:record.submissions,offline:false});this.save(latest);return this.status(latest);
  }
  private status(record:Saved):LabDesktopStatus{return{lab:record.lab,studentId:record.studentId,model:record.state.model,state:record.state.state,closesAt:record.state.closesAt,
    offline:record.offline,inference:record.inference,grading:record.grading,usage:record.state.usage,submissions:record.submissions};}
  async view(workspace:string):Promise<LabDesktopStatus>{await this.refresh(workspace).catch(()=>{});return this.status(this.record(workspace));}
  async ready(workspace:string):Promise<boolean>{const status=await this.refresh(workspace);return status.state==='open'&&status.inference&&!status.offline;}
  async workspaceInfo(workspace:string):Promise<PracticeWorkspace>{const record=this.record(workspace);if(!record.task)throw Error('Lab task setup is incomplete. Join again to finish setup.');this.monitor(workspace);
    return{workspace:record.workspace,task:record.task,budgetTokens:record.state.usage.budgetLimit,usage:[record.state.usage],lab:{id:record.lab,studentId:record.studentId,state:record.state.state,closesAt:record.state.closesAt,model:record.state.model}};}
  private async exclusive<T>(id:string,work:()=>Promise<T>):Promise<T>{const prior=this.queues.get(id)??Promise.resolve();let release!:()=>void;const next=new Promise<void>(resolve=>{release=resolve;});this.queues.set(id,next);await prior.catch(()=>{});
    try{return await work();}finally{release();if(this.queues.get(id)===next)this.queues.delete(id);}}
  async sync(workspace:string):Promise<{revision:number;hash:string}>{return this.exclusive(this.record(workspace).id,()=>this.syncLocked(workspace));}
  private async syncLocked(workspace:string):Promise<{revision:number;hash:string}>{
    const client=await this.forRecord(this.record(workspace)),record=this.record(workspace);
    if(record.pending){const ack=await client.request('POST','/v1/mirror',record.pending);const latest=this.record(workspace);latest.revision=ack.revision;latest.hash=ack.hash;delete latest.pending;this.save(latest);Object.assign(record,latest);}
    const files=captureLabFiles(record.workspace),hash=labFilesHash(files);
    if(hash===record.hash)return {revision:record.revision,hash};
    record.pending={requestId:randomUUID(),baseRevision:record.revision,files};this.save(record);
    const ack=await client.request('POST','/v1/mirror',record.pending);const latest=this.record(workspace);latest.revision=ack.revision;latest.hash=ack.hash;delete latest.pending;latest.offline=false;this.save(latest);return ack;
  }
  async submit(workspace:string):Promise<LabSubmission>{const initial=this.record(workspace);return this.exclusive(initial.id,async()=>{
    if(!this.record(workspace).pendingSubmit){const {revision}=await this.syncLocked(workspace),record=this.record(workspace);
      record.pendingSubmit={requestId:randomUUID(),revision};this.save(record);}
    const record=this.record(workspace),client=await this.forRecord(record);
    const result=await client.request('POST','/v1/submit',record.pendingSubmit);
    const latest=this.record(workspace);delete latest.pendingSubmit;
    latest.submissions=[...latest.submissions.filter(item=>item.id!==result.id),result].sort((a,b)=>a.number-b.number);this.save(latest);
    await this.refresh(workspace).catch(()=>{});return result as LabSubmission;
  });}
  async prompts(workspace:string){const client=await this.client(workspace);return(await client.request('GET','/v1/prompts')).prompts;}
  async runTests(workspace:string){const record=this.record(workspace);await this.prepare(record.workspace,record.task!);
    const python=join(record.workspace,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');return runPracticeTests(record.workspace,python);}
  queueEvent(workspace:string,kind:'paste'|'focus_lost',count:number):void{const record=this.record(workspace);if(record.events.length>=500)return;
    record.events.push({id:randomUUID(),kind,count:Math.max(0,Math.min(1000000,Math.floor(count))),at:new Date().toISOString()});this.save(record);}
  private async flushEvents(workspace:string):Promise<void>{const record=this.record(workspace),client=await this.forRecord(record);
    for(const event of record.events.slice(0,50))await client.request('POST','/v1/client-events',event);
    // Preserve events appended while network calls were in flight.
    const latest=this.record(workspace),sent=new Set(record.events.slice(0,50).map(event=>event.id));latest.events=latest.events.filter(event=>!sent.has(event.id));this.save(latest);
  }
  async handsEnvironment(workspace:string):Promise<Record<string,string>>{
    const record=this.record(workspace),base=await this.environment();let url=base.PIP_INDEX_URL;
    if(record.packages){let pending=this.packageProxies.get(record.id);if(!pending){pending=this.packageProxy(workspace);this.packageProxies.set(record.id,pending);pending.catch(()=>this.packageProxies.delete(record.id));}url=(await pending).url;}
    if(!url)return base;return pinPythonIndex(record.workspace,url,join(this.directory,`${record.id}.pip.ini`));
  }
  private async packageProxy(workspace:string):Promise<{url:string;server:Server}>{
    const prefix='/'+randomBytes(24).toString('hex'),server=createServer(async(request,response)=>{try{
      if(request.method!=='GET'||!request.url?.startsWith(prefix+'/')){response.writeHead(404).end();return;}
      const client=await this.client(workspace),result=await client.resource('/v1/packages'+request.url.slice(prefix.length));
      const body=result.contentType.includes('text/html')?Buffer.from(result.body.toString('utf8').replaceAll('href="/wheels/',`href="${prefix}/wheels/`)):result.body;
      response.writeHead(200,{'content-type':result.contentType,'cache-control':'no-store'}).end(body);
    }catch{response.writeHead(502).end('The lab package service is unavailable. No public-index fallback is enabled.');}});
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Lab package proxy did not start');
    return{server,url:`http://127.0.0.1:${address.port}${prefix}/simple/`};
  }
  private monitor(workspace:string):void{if(!this.autoSync)return;const record=this.record(workspace);if(this.monitors.has(record.id))return;
    const monitor:{watcher?:FSWatcher;timer:ReturnType<typeof setInterval>;busy:boolean}={timer:undefined as any,busy:false};
    const tick=async()=>{if(monitor.busy)return;monitor.busy=true;try{const status=await this.refresh(workspace);if(status.state==='open')await this.sync(workspace);await this.flushEvents(workspace);}catch{/* Saved files/events remain queued; the agent never falls back to another funding source. */}finally{monitor.busy=false;}};
    try{monitor.watcher=watch(workspace,{recursive:true},(_event,path)=>{if(path&&!/(?:^|[/\\])(?:\.venv|__pycache__|\.git)(?:[/\\]|$)/.test(String(path)))void tick();});}catch{/* Periodic sync remains available when native watchers are unavailable. */}
    monitor.timer=setInterval(()=>void tick(),2000);monitor.timer.unref();monitor.watcher?.unref();this.monitors.set(record.id,monitor);
  }
  attempts():AttemptSummary[]{return this.records().filter(record=>record.task).map(record=>({workspace:record.workspace,taskId:record.task!.id,title:`${record.task!.title} · ${record.lab}`,attempt:1,lab:record.lab,
    startedAt:record.startedAt,lastActivityAt:record.startedAt,weighted:record.state.usage.weighted,budgetLimit:record.state.usage.budgetLimit,status:record.state.usage.status,
    submissions:record.submissions.length,...(record.reports.length?{latest:{...record.reports.at(-1)!.correctness,submittedAt:record.reports.at(-1)!.submittedAt}}:{})}));}
  reportSummaries():ReportSummary[]{return this.records().flatMap(record=>record.reports.map((report,index)=>({workspace:record.workspace,taskId:report.taskId,title:`${record.task?.title??report.taskId} · ${record.lab}`,attempt:1,
    submission:index+1,submissions:record.reports.length,submittedAt:report.submittedAt,passed:report.correctness.passed,total:report.correctness.total,weighted:report.workspaceUsage?.reduce((sum,row)=>sum+row.weighted,0)??report.usage.reduce((sum,row)=>sum+row.weighted,0),score:null})));}
  report(workspace:string,submission:number):PracticeReport{const report=this.record(workspace).reports[submission-1];if(!report)throw Error('The instructor has not released that lab report yet');return report;}
  async refreshAll():Promise<void>{await Promise.allSettled(this.records().filter(record=>record.task).map(record=>this.refresh(record.workspace)));}
  dispose():void{for(const monitor of this.monitors.values()){clearInterval(monitor.timer);monitor.watcher?.close();}this.monitors.clear();for(const pending of this.packageProxies.values())void pending.then(({server})=>{server.closeAllConnections();server.close();}).catch(()=>{});this.packageProxies.clear();for(const entry of this.clients.values())entry.client.close();this.clients.clear();}
}
