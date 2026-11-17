import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabEngine } from '@factoryze/engine/lab';
import { startPackageIndex } from '@factoryze/engine/package-index';
import { initializeServer, loadIdentity } from '../src/identity.ts';
import { createLabServer } from '../src/server.ts';
import { LabClient } from '../src/client.ts';

test('lab package downloads require a student session and serve only the curated wheelhouse',async()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-lab-packages-'));mkdirSync(join(root,'wheels'));writeFileSync(join(root,'wheels','example_pkg-1.0-py3-none-any.whl'),'synthetic wheel bytes');
 const index=await startPackageIndex(join(root,'wheels')),engine=new LabEngine(join(root,'state'));initializeServer(join(root,'identity'),'https://localhost:9443');
 const identity=loadIdentity(join(root,'identity')),server=createLabServer(engine,identity,{packageIndexURL:index.url});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');const connection={...identity.connection,baseURL:`https://localhost:${address.port}`};
 const {code}=engine.create({schema:1,config:{schema:1,lab:'packages',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'synthetic',permissions:{edit:'ask',shell:'ask'}},budget:{limit:10,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'provider.invalid',temperature:0,roster:['one']});
 const joined=engine.join({protocol:1,lab:'packages',code,studentId:'one',profile:'factoryze@0.1.0'}),student=new LabClient(connection,joined.token),anonymous=new LabClient(connection);
 try{
  const page=await student.resource('/v1/packages/simple/');assert.match(page.body.toString(),/example-pkg/);
  const wheel=await student.resource('/v1/packages/wheels/example_pkg-1.0-py3-none-any.whl');assert.equal(wheel.body.toString(),'synthetic wheel bytes');
  await assert.rejects(anonymous.resource('/v1/packages/simple/'),/401/);
  await assert.rejects(student.resource('/v1/admin/labs/packages'));
  await assert.rejects(student.resource('/v1/packages/wheels/missing.whl'),/404/);
 }finally{student.close();anonymous.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));engine.close();await index.close();rmSync(root,{recursive:true,force:true});}
});
