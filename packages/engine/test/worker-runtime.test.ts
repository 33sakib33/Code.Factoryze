import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkerTLS,workerToken,writeWorkerHealth,workerHealthy,mutualTLSFetch} from '../src/worker-runtime.ts';

test('worker file secrets require complete TLS configuration and never expose their contents',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-worker-config-'));
 try{const token=join(root,'token');writeFileSync(token,'a'.repeat(64)+'\n');assert.equal(workerToken({FACTORYZE_BROWSER_WORKER_TOKEN_FILE:token}),'a'.repeat(64));
 assert.throws(()=>workerToken({FACTORYZE_BROWSER_WORKER_TOKEN_FILE:token,FACTORYZE_BROWSER_WORKER_TOKEN:'b'.repeat(64)}),/configuration/i);
 assert.throws(()=>loadWorkerTLS({FACTORYZE_BROWSER_WORKER_CA_FILE:token}),/configuration/i);
 assert.throws(()=>mutualTLSFetch({ca:Buffer.from('invalid'),cert:Buffer.from('invalid'),key:Buffer.from('invalid')})('http://127.0.0.1/',{}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('worker health is atomic, bounded, private and stale after API contact stops',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-worker-health-')),path=join(root,'health.json');
 try{writeWorkerHealth(path,true,100000);assert.equal(workerHealthy(path,110000),true);assert.equal(workerHealthy(path,120001),false);writeWorkerHealth(path,false,110000);assert.equal(workerHealthy(path,110000),false);}
 finally{rmSync(root,{recursive:true,force:true});}
});
