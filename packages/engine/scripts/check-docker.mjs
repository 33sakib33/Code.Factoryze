import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DockerExecutor,DockerExecutionError,runDocker} from '../src/docker-executor.ts';
import {createDockerGrader} from '../src/docker-grader.ts';
import {LabEngine} from '../src/lab.ts';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),output=join(repo,'dist/docker-grading-verification');mkdirSync(output,{recursive:true});
let root,engine,stage='docker-preflight',starts=0;
const result={date:'2026-10-29',passed:false,realDockerChecks:false,paidModelCalls:0,realEmailsSent:0,hostStudentCodeExecutions:0};
const owner='check-'+randomUUID(),docker=process.env.FACTORYZE_DOCKER_COMMAND??'docker';
const previousSentinel=process.env.FACTORYZE_DOCKER_SECRET_SENTINEL;
const command=async(args,timeoutMs=10000)=>{const reply=await runDocker(docker,{args,timeoutMs,maxOutputBytes:65536});if(reply.code)throw Error('Docker command failed; check the local Linux engine.');return reply.stdout;};
try{
 await command(['version','--format','{{json .Server}}']);
 const image=process.env.FACTORYZE_LAB_GRADER_IMAGE??readFileSync(join(repo,'dist/docker-grader-image.txt'),'utf8').trim();
 const executor=new DockerExecutor({image,owner,execute:async request=>{if(request.args.includes('start'))starts++;return runDocker(docker,request);}});
 stage='isolation-self-check';const health=await executor.initialize();result.realDockerChecks=true;result.image=image;result.python=health.python;
 const parent=realpathSync.native(tmpdir());root=mkdtempSync(join(parent,'factoryze-docker-check-'));
 const marker=join(root,'host-secret.txt');writeFileSync(marker,'host-only verification fixture');
 const paths=process.platform==='win32'?[marker,...['/run/desktop/mnt/host/','/host_mnt/','/mnt/'].map(prefix=>prefix+marker[0].toLowerCase()+marker.slice(2).replaceAll('\\','/'))]:[marker,'/host'+marker];
 process.env.FACTORYZE_DOCKER_SECRET_SENTINEL='synthetic-host-only-marker';
 const probe=await executor.run({files:[{path:'public.txt',data:Buffer.from('public fixture').toString('base64')}],hidden:[],timeoutMs:10000,argv:['python','-I','-c',`
import json, os, socket, sys
result={'uid':os.getuid(),'keyAbsent':os.environ.get('FACTORYZE_DOCKER_SECRET_SENTINEL') is None,'socketAbsent':not os.path.exists('/var/run/docker.sock'),'hostFileAbsent':all(not os.path.exists(path) for path in sys.argv[1:])}
try:
    socket.create_connection(('1.1.1.1',443),timeout=0.5).close()
    result['networkBlocked']=False
except OSError:
    result['networkBlocked']=True
for label,path in [('rootReadonly','/readonly-probe'),('inputReadonly','/submission/public.txt')]:
    try:
        with open(path,'w') as file: file.write('forbidden')
        result[label]=False
    except OSError:
        result[label]=True
print(json.dumps(result))`,...paths]});
 const policy=JSON.parse(probe.stdout);assert.equal(probe.exitCode,0);assert.equal(policy.uid,10000);for(const key of ['keyAbsent','socketAbsent','hostFileAbsent','networkBlocked','rootReadonly','inputReadonly'])assert.equal(policy[key],true,key);result.policy=policy;
 stage='timeout-output-memory-pid-checks';const beforeTimeout=starts;
 await assert.rejects(executor.run({files:[],hidden:[],argv:['python','-I','-c','while True: pass'],timeoutMs:3000}),error=>error instanceof DockerExecutionError&&error.kind==='timeout');assert.ok(starts>beforeTimeout,'timeout probe actually started');
 await assert.rejects(executor.run({files:[],hidden:[],argv:['python','-I','-c','import os; os.write(1,b"x"*131072)'],timeoutMs:10000}),error=>error instanceof DockerExecutionError&&error.kind==='output-limit');
 const memory=await executor.run({files:[],hidden:[],argv:['python','-I','-c','x=bytearray(512*1024*1024)'],timeoutMs:10000});assert.ok(memory.oomKilled||memory.exitCode!==0,'memory exhaustion is contained');
 const pid=await executor.run({files:[],hidden:[],argv:['python','-I','-c',`
import subprocess,sys,json
children=[]
try:
    for i in range(100): children.append(subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']))
except OSError:
    print(json.dumps({'limited':True,'spawned':len(children)}),flush=True)
else:
    print(json.dumps({'limited':False}),flush=True)
finally:
    for child in children: child.kill()
    for child in children: child.wait()
`],timeoutMs:10000});assert.equal(JSON.parse(pid.stdout).limited,true);result.resourceAbuseContained=true;
 stage='real-task-queue';engine=new LabEngine(join(root,'state'),{taskRoot:join(repo,'tasks/practice')});
 const {code}=engine.create({schema:1,config:{schema:1,lab:'container-check',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic-no-calls',permissions:{edit:'ask',shell:'ask'}},budget:{limit:1000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'no-provider.invalid',temperature:0,roster:['starter','fixed']});
 const enroll=studentId=>engine.join({protocol:1,lab:'container-check',code,studentId,profile:'factoryze@0.1.0'});
 const starter=enroll('starter'),fixed=enroll('fixed'),mirror=engine.mirror(fixed.token);
 const files=mirror.files.map(file=>{if(file.path!=='library/returns.py')return file;const text=Buffer.from(file.data,'base64').toString('utf8').replace('from .calendar import open_days_between','from .calendar import open_days_between\nfrom .clock import local_day').replace('returned_on = returned_at.date()','returned_on = local_day(returned_at, branch)');return{path:file.path,data:Buffer.from(text).toString('base64')};});
 engine.sync(fixed.token,{requestId:'fixed',baseRevision:0,files});engine.submit(starter.token,{requestId:'starter',revision:0});engine.submit(fixed.token,{requestId:'fixed',revision:1});engine.closeLab('container-check');
 assert.deepEqual(engine.releasedReports(fixed.token),[]);const graded=await engine.gradeQueued(createDockerGrader(executor,{python:health.python}));assert.deepEqual(graded,{graded:2,failed:0});engine.release('container-check');
 const a=engine.releasedReports(starter.token)[0],b=engine.releasedReports(fixed.token)[0];assert.ok(a.correctness.passed<a.correctness.total);assert.deepEqual(b.correctness,{passed:9,total:9});assert.match(engine.exportCsv('container-check'),new RegExp(image));
 result.correctness={starter:a.correctness,fixed:b.correctness};result.queueReleaseCsvVerified=true;
 stage='container-cleanup';const leftovers=await command(['ps','--all','--quiet','--filter',`label=org.factoryze.executor.owner=${owner}`]);assert.equal(leftovers.trim(),'');result.ownedContainersRemaining=0;
 result.passed=true;
}catch(error){result.stage=stage;result.error=error instanceof Error?error.message:'Docker verification failed';process.exitCode=1;}
finally{
 if(previousSentinel===undefined)delete process.env.FACTORYZE_DOCKER_SECRET_SENTINEL;else process.env.FACTORYZE_DOCKER_SECRET_SENTINEL=previousSentinel;
 engine?.close();if(root){const parent=realpathSync.native(tmpdir()),scope=relative(parent,root);assert.ok(scope.startsWith('factoryze-docker-check-')&&!scope.startsWith('..')&&!isAbsolute(scope));rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
 result.containersStarted=starts;writeFileSync(join(output,'checks.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
