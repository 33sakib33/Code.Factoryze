import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,chmod,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import type {LabFile} from '@factoryze/protocol';
import {materializeLabFiles,validateLabFiles} from './lab-files.ts';

export type DockerCommand={args:string[];timeoutMs:number;maxOutputBytes:number;signal?:AbortSignal};
export type DockerResult={code:number;stdout:string;stderr:string};
export class DockerExecutionError extends Error {
  readonly kind:'configuration'|'unavailable'|'timeout'|'output-limit'|'cleanup';
  constructor(kind:DockerExecutionError['kind'],message:string){super(message);this.kind=kind;}
}
const immutableImage=/^sha256:[a-f0-9]{64}$/;
const safeId=/^[a-f0-9]{64}$/;
const containerLabel='org.factoryze.executor.owner';

/** Trusted server code only. No Docker options, host paths or credentials come from submissions. */
export class DockerExecutor {
  readonly image:string;
  private readonly owner:string;
  private readonly execute:(command:DockerCommand)=>Promise<DockerResult>;
  private context='';
  private ready=false;
  constructor(options:{image:string;owner:string;docker?:string;execute?:(command:DockerCommand)=>Promise<DockerResult>}){
    if(!immutableImage.test(options.image))throw new DockerExecutionError('configuration','Use the immutable local sha256 image ID from the grading image build.');
    if(!/^[a-z0-9-]{1,64}$/.test(options.owner))throw new DockerExecutionError('configuration','Invalid Docker executor owner.');
    this.image=options.image;this.owner=options.owner;this.execute=options.execute??(command=>runDocker(options.docker??'docker',command));
  }
  private async call(args:string[],timeoutMs=10000,signal?:AbortSignal,allowFailure=false):Promise<DockerResult>{
    const result=await this.execute({args:[...(this.context?['--context',this.context]:[]),...args],timeoutMs,maxOutputBytes:65536,...(signal?{signal}:{})});
    if(result.code&&!allowFailure)throw new DockerExecutionError('unavailable','Docker command failed. Check the local Linux engine and grading image.');
    return result;
  }
  async initialize():Promise<{python:string;runner:string}>{
    this.ready=false;
    const context=(await this.call(['context','show'])).stdout.trim();
    if(!/^[A-Za-z0-9_.-]{1,100}$/.test(context))throw new DockerExecutionError('configuration','Invalid Docker context.');
    const metadata=JSON.parse((await this.call(['context','inspect',context])).stdout);
    const endpoint=metadata[0]?.Endpoints?.docker?.Host;
    if(typeof endpoint!=='string'||!(/^unix:\/\/\//.test(endpoint)||/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint)))throw new DockerExecutionError('configuration','Grading requires a local Unix socket or Windows named-pipe Docker engine.');
    this.context=context;
    const info=JSON.parse((await this.call(['info','--format','{{json .}}'])).stdout);
    if(info.OSType!=='linux'||!Array.isArray(info.SecurityOptions)||!info.SecurityOptions.some((value:unknown)=>typeof value==='string'&&value.includes('name=seccomp')&&!value.includes('unconfined')))
      throw new DockerExecutionError('configuration','Grading requires Linux containers with Docker default seccomp enabled.');
    const image=JSON.parse((await this.call(['image','inspect',this.image])).stdout)[0];
    if(image?.Id!==this.image||image.Os!=='linux'||image.Config?.Labels?.['org.factoryze.grader.version']!=='1')
      throw new DockerExecutionError('configuration','Build and pin the Factoryze grading image before enabling grading.');
    // The CLI holds its server-state lock before initialization. Reap only this owner's interrupted jobs.
    const orphans=(await this.call(['ps','--all','--quiet','--no-trunc','--filter',`label=${containerLabel}=${this.owner}`])).stdout.trim().split(/\s+/).filter(Boolean);
    for(const id of orphans){if(!safeId.test(id))throw new DockerExecutionError('configuration','Docker returned an invalid container ID.');await this.call(['rm','--force','--volumes',id]);}
    this.ready=true;
    try{
      const health=await this.run({files:[],hidden:[],argv:['python','-I','/opt/factoryze/runner.py','health'],timeoutMs:10000});
      if(health.exitCode!==0||health.oomKilled)throw new DockerExecutionError('configuration','Grader self-check failed. Check the built image and cgroup-v2 Docker resource controls.');
      let result:any;try{result=JSON.parse(health.stdout);}catch{throw new DockerExecutionError('configuration','Grader self-check returned invalid output. Rebuild the trusted grading image.');}
      if(result.runner!=='factoryze-hidden-v1'||typeof result.python!=='string')throw new DockerExecutionError('configuration','Grader self-check returned an incompatible runner.');
      const limits=result.limits;
      if(result.uid!==10000||!/^0+$/.test(result.capEff??'')||result.noNewPrivs!=='1'||result.seccomp!=='2'||
        !limits||!Number.isInteger(limits.memory)||limits.memory<=0||limits.memory>268435456||limits.swap!==0||!Number.isInteger(limits.pids)||limits.pids<1||limits.pids>64||
        !(limits.cpuQuota>0&&limits.cpuPeriod>0&&limits.cpuQuota/limits.cpuPeriod<=1))
        throw new DockerExecutionError('configuration','Container policy/limits are not enforced. A cgroup-v2 Linux engine with memory, swap, PID and CPU controls is required.');
      return result;
    }catch(error){this.ready=false;throw error;}
  }
  async run(input:{files:LabFile[];hidden:LabFile[];argv:string[];timeoutMs:number;signal?:AbortSignal}):Promise<{stdout:string;exitCode:number;oomKilled:boolean}>{
    if(!this.ready)throw new DockerExecutionError('unavailable','Initialize the Docker executor before running a check.');
    if(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>120000||!input.argv.length||input.argv.some(arg=>arg.includes('\0')))
      throw new DockerExecutionError('configuration','Invalid container command or time limit.');
    const files=validateLabFiles(input.files),hidden=validateLabFiles(input.hidden);
    const parent=await realpath(tmpdir()),root=await mkdtemp(join(parent,'factoryze-container-'));
    const name='factoryze-check-'+randomUUID(),deadline=Date.now()+input.timeoutMs;
    let created=false,id:string|undefined;
    const remaining=()=>{input.signal?.throwIfAborted();const value=deadline-Date.now();if(value<=0)throw new DockerExecutionError('timeout','Container check timed out.');return value;};
    try{
      if(root.includes(',')||root.includes('"'))throw new DockerExecutionError('configuration','Use a temporary directory without commas or quotes for Docker grading.');
      for(const [folder,entries]of [['submission',files],['checks',hidden]]as const){
        const directory=join(root,folder);await mkdir(directory,{mode:0o755});materializeLabFiles(directory,entries);
        for(const file of entries){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)await chmod(join(directory,...parts.slice(0,i)),0o755);await chmod(join(directory,file.path),0o444);}
        await chmod(directory,0o755);
      }
      const source=(path:string)=>process.platform==='win32'?path.replaceAll('\\','/'):path;
      const args=['create',`--name=${name}`,`--label=${containerLabel}=${this.owner}`,'--pull=never','--network=none','--ipc=none',
        '--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--user=10000:10000',
        '--cpus=1','--memory=256m','--memory-swap=256m','--pids-limit=64','--ulimit=nofile=64:64','--ulimit=fsize=16777216:16777216',
        '--log-driver=none','--init','--workdir=/work','--hostname=factoryze-check',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777','--tmpfs=/work:rw,noexec,nosuid,nodev,size=64m,mode=1777',
        '--env=PYTHONHASHSEED=0','--env=PYTHONDONTWRITEBYTECODE=1','--env=TZ=UTC',
        '--mount',`type=bind,source=${source(join(root,'submission'))},target=/submission,readonly`,
        '--mount',`type=bind,source=${source(join(root,'checks'))},target=/checks,readonly`,this.image,...input.argv];
      // Mark before create: even an interrupted create can have reached the daemon.
      created=true;id=(await this.call(args,remaining(),input.signal)).stdout.trim();
      if(!safeId.test(id))throw new DockerExecutionError('unavailable','Docker did not return a valid container ID.');
      const container=JSON.parse((await this.call(['inspect','--format','{{json .}}',id],remaining(),input.signal)).stdout),config=container.HostConfig;
      if(container.Config?.User!=='10000:10000'||!config||config.NetworkMode!=='none'||config.IpcMode!=='none'||config.Privileged||!config.ReadonlyRootfs||
        config.PidsLimit!==64||config.Memory!==268435456||config.MemorySwap!==268435456||config.NanoCpus!==1000000000||config.LogConfig?.Type!=='none'||
        !config.CapDrop?.includes('ALL')||!config.SecurityOpt?.some((value:string)=>/^no-new-privileges(?::true)?$/.test(value))||
        config.Binds?.length||config.Devices?.length||config.DeviceRequests?.length||config.Mounts?.length!==2||
        !['/submission','/checks'].every(target=>config.Mounts.some((mount:any)=>mount.Type==='bind'&&mount.Target===target&&mount.ReadOnly===true)))
        throw new DockerExecutionError('configuration','Docker container security configuration does not match the required isolation policy.');
      const result=await this.call(['start','--attach',id],remaining(),input.signal,true);
      const state=JSON.parse((await this.call(['inspect','--format','{{json .State}}',id],Math.min(2000,remaining()),input.signal)).stdout);
      if(state.Running||!Number.isInteger(state.ExitCode))throw new DockerExecutionError('unavailable','The container did not finish with a valid state.');
      return {stdout:result.stdout,exitCode:state.ExitCode,oomKilled:state.OOMKilled===true};
    }finally{
      try{if(created)await this.call(['rm','--force','--volumes',id&&safeId.test(id)?id:name],5000);}
      catch{throw new DockerExecutionError('cleanup','Docker cleanup failed. Restore the engine and restart this server to reap its interrupted containers.');}
      finally{
        const scoped=relative(parent,root);
        if(!scoped||scoped.startsWith('..')||isAbsolute(scoped)||!scoped.startsWith('factoryze-container-'))throw new DockerExecutionError('cleanup','Invalid grading staging cleanup target.');
        await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
      }
    }
  }
}

export function runDocker(executable:string,command:DockerCommand):Promise<DockerResult>{
  return new Promise((resolve,reject)=>{
    const env:NodeJS.ProcessEnv={};
    for(const key of ['PATH','Path','HOME','USERPROFILE','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','TEMP','TMP','DOCKER_CONFIG','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CERT_PATH','DOCKER_TLS_VERIFY'])if(process.env[key])env[key]=process.env[key];
    let failure:Error|undefined,total=0;const out:Buffer[]=[],err:Buffer[]=[];
    const child=spawn(executable,command.args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stop=(error:Error)=>{failure??=error;child.kill('SIGKILL');};
    const abort=()=>stop(new DockerExecutionError('unavailable','Docker operation cancelled.'));
    command.signal?.addEventListener('abort',abort,{once:true});if(command.signal?.aborted)abort();
    const timer=setTimeout(()=>stop(new DockerExecutionError('timeout','Docker operation timed out.')),command.timeoutMs);
    const collect=(chunks:Buffer[],data:Buffer)=>{total+=data.length;if(total>command.maxOutputBytes)stop(new DockerExecutionError('output-limit','Container output exceeded 64 KiB.'));else chunks.push(data);};
    child.stdout.on('data',data=>collect(out,data));child.stderr.on('data',data=>collect(err,data));
    child.on('error',()=>{failure??=new DockerExecutionError('unavailable','Docker could not start. Install Docker and start a local Linux engine.');});
    child.on('close',code=>{clearTimeout(timer);command.signal?.removeEventListener('abort',abort);if(failure)reject(failure);else resolve({code:code??1,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
  });
}
