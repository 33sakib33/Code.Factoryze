import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {DockerExecutor,DockerExecutionError,type DockerCommand} from '../src/docker-executor.ts';
const image='sha256:'+'a'.repeat(64),id='b'.repeat(64);
function fixture(){
 const calls:DockerCommand[]=[],mounts:string[]=[];let failure='',unsafe=false,unbounded=false;
 const execute=async(command:DockerCommand)=>{calls.push(command);const args=command.args,at=args.indexOf('--context'),op=args[at<0?0:at+2];let stdout='';
  if(op==='context')stdout=args.includes('show')?'default':JSON.stringify([{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]);
  else if(op==='info')stdout=JSON.stringify({OSType:'linux',SecurityOptions:['name=seccomp,profile=builtin']});
  else if(op==='image')stdout=JSON.stringify([{Id:image,Os:'linux',Config:{Labels:{'org.factoryze.grader.version':'1'}}}]);
  else if(op==='create'){mounts.push(...args.filter(x=>x.startsWith('type=bind,')));stdout=id;}
  else if(op==='start'){if(failure)throw new DockerExecutionError(failure as 'timeout','synthetic timeout');stdout=JSON.stringify({python:'3.13.0',runner:'factoryze-hidden-v1',uid:10000,capEff:'0000000000000000',noNewPrivs:'1',seccomp:'2',limits:{memory:unbounded?'max':268435456,swap:0,pids:64,cpuQuota:100000,cpuPeriod:100000}});}
  else if(op==='inspect')stdout=JSON.stringify(args.includes('{{json .State}}')?{ExitCode:0,OOMKilled:false,Running:false}:{Config:{User:'10000:10000'},HostConfig:{NetworkMode:unsafe?'host':'none',IpcMode:'none',Privileged:false,ReadonlyRootfs:true,PidsLimit:64,Memory:268435456,MemorySwap:268435456,NanoCpus:1000000000,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],LogConfig:{Type:'none'},Mounts:[{Type:'bind',Target:'/submission',ReadOnly:true},{Type:'bind',Target:'/checks',ReadOnly:true}]}});
  return {code:0,stdout,stderr:''};};
 return {calls,mounts,execute,fail:()=>{failure='timeout';},unsafe:()=>{unsafe=true;},unbounded:()=>{unbounded=true;}};
}
test('Docker executor requires immutable Linux images and a local daemon, enforces isolation and cleans only its container',async()=>{
 assert.throws(()=>new DockerExecutor({image:'python:latest',owner:'unit'}),/immutable/i);
 const f=fixture(),executor=new DockerExecutor({image,owner:'unit',execute:f.execute});await executor.initialize();
 f.calls.length=0;await executor.run({files:[{path:'x.py',data:Buffer.from('value=1').toString('base64')}],hidden:[],argv:['python','-I','/opt/factoryze/runner.py','health'],timeoutMs:1000});
 const create=f.calls.find(c=>c.args.includes('create'))!.args;
 for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--user=10000:10000','--pids-limit=64','--memory=256m','--memory-swap=256m','--cpus=1','--pull=never','--log-driver=none'])assert.ok(create.includes(flag),flag);
 assert.equal(create.some(x=>x.includes('docker.sock')||x.includes('PROVIDER_KEY')),false);
 const source=f.mounts.at(-2)!.match(/source=(.*),target=/)![1]!;assert.equal(existsSync(source),false,'owned staging is removed after execution');
 assert.ok(f.calls.some(c=>c.args.includes('rm')&&c.args.includes(id)));
 f.fail();await assert.rejects(executor.run({files:[],hidden:[],argv:['python','-c','while True: pass'],timeoutMs:50}),/timeout/);
 assert.equal(f.calls.at(-1)!.args.includes('rm'),true);
});
test('executor verifies actual container security configuration before allowing it to start',async()=>{
 const f=fixture(),executor=new DockerExecutor({image,owner:'unit',execute:f.execute});await executor.initialize();f.calls.length=0;f.unsafe();
 await assert.rejects(executor.run({files:[],hidden:[],argv:['python','-c','print(1)'],timeoutMs:1000}),/security|isolation/i);
 assert.equal(f.calls.some(c=>c.args.includes('start')),false);assert.ok(f.calls.at(-1)!.args.includes('rm'));
});
test('Docker executor fails closed when default seccomp or a local Linux engine is unavailable',async()=>{
 for(const bad of [{OSType:'windows',SecurityOptions:['name=seccomp']},{OSType:'linux',SecurityOptions:[]}]){
  const f=fixture();await assert.rejects(new DockerExecutor({image,owner:'unit',execute:async c=>c.args.includes('info')?{code:0,stdout:JSON.stringify(bad),stderr:''}:f.execute(c)}).initialize(),/Linux|seccomp/);
 }
 for(const endpoint of ['tcp://remote.invalid:2375','npipe:////remote/pipe/docker_engine']){
  const f=fixture();await assert.rejects(new DockerExecutor({image,owner:'unit',execute:async c=>c.args.includes('context')&&c.args.includes('inspect')?{code:0,stdout:JSON.stringify([{Endpoints:{docker:{Host:endpoint}}}]),stderr:''}:f.execute(c)}).initialize(),/local/i);
 }
 const unbounded=fixture();unbounded.unbounded();await assert.rejects(new DockerExecutor({image,owner:'unit',execute:unbounded.execute}).initialize(),/limits|policy/i);
});
