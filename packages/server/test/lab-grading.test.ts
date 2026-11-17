import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {LabEngine} from '@factoryze/engine/lab';
import {createDockerGrader} from '@factoryze/engine/docker-grader';
import {DockerExecutionError} from '@factoryze/engine/docker-executor';
import {LabClient} from '../src/client.ts';
import {initializeServer,loadIdentity} from '../src/identity.ts';
import {createLabServer} from '../src/server.ts';

test('HTTPS grading queue keeps results private, restricts retry/status/release and exports immutable image provenance',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-grading-api-')),engine=new LabEngine(join(root,'state'),{taskRoot:resolve('tasks/practice')});
 initializeServer(join(root,'identity'),'https://localhost:9443');const identity=loadIdentity(join(root,'identity'));let unavailable=true;
 const grader=createDockerGrader({image:'sha256:'+'a'.repeat(64),run:async input=>{
  if(unavailable)throw new DockerExecutionError('unavailable','synthetic daemon failure');
  return {stdout:input.argv.includes('discover')?'{"checks":[{"file":"test_library.py","name":"test_fixture"}]}':'{"passed":true}',exitCode:0,oomKilled:false};
 }},{python:'3.13.0'});
 const server=createLabServer(engine,identity,{grader});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const connection={...identity.connection,baseURL:`https://localhost:${address.port}`},operator=new LabClient(connection,identity.operatorToken),anonymous=new LabClient(connection);let student:LabClient|undefined;
 try{
  const {code}=await operator.request('POST','/v1/admin/labs',{schema:1,config:{schema:1,lab:'grading',task:'library-fines',timeLimitMinutes:60,
   agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:1000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one']});
  const joined=await anonymous.join({protocol:1,lab:'grading',code,studentId:'one',profile:'factoryze@0.1.0'});student=new LabClient(connection,joined.token);
  await student.request('POST','/v1/submit',{requestId:'submission',revision:0});
  const waitFor=async(state:string)=>{for(let i=0;i<100;i++){const status=await operator.request('GET','/v1/admin/labs/grading/grading');if(status.submissions[0]?.state===state)return status;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Queue did not reach '+state);};
  await waitFor('failed');await assert.rejects(student.request('GET','/v1/admin/labs/grading/grading'),/401/);await assert.rejects(student.request('POST','/v1/admin/labs/grading/grade',{}),/401/);
  assert.deepEqual((await student.request('GET','/v1/reports')).reports,[]);unavailable=false;
  assert.equal((await operator.request('POST','/v1/admin/labs/grading/grade',{})).retried,1);const status=await waitFor('graded');assert.equal(status.submissions[0].provenance.executor,'docker');
  assert.equal(JSON.stringify(status).includes('files'),false);assert.deepEqual((await student.request('GET','/v1/reports')).reports,[]);
  await operator.request('POST','/v1/admin/labs/grading/close',{});await operator.request('POST','/v1/admin/labs/grading/release',{});
  assert.equal((await student.request('GET','/v1/reports')).reports[0].correctness.passed,1);assert.match((await operator.request('GET','/v1/admin/labs/grading/export')).csv,/sha256:aaaa/);
 }finally{operator.close();anonymous.close();student?.close();await server.disposeLab();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));engine.close();rmSync(root,{recursive:true,force:true});}
});
