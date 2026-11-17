import assert from 'node:assert/strict';
import test from 'node:test';
import {browserCheckInputHash} from '../src/browser-checks.ts';
import {executeBrowserLease, createBrowserWorkerClient} from '../src/browser-queue.ts';
import type {BrowserCheckLease, BrowserCheckResult} from '@factoryze/protocol';

const input = {schema:1 as const,kind:'public_checks' as const,jobId:'a'.repeat(24),attemptId:'b'.repeat(24),revision:0,
  archiveHash:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),minimumPython:'3.11',files:[{path:'main.py',content:''}],publicChecks:[{path:'tests/test_main.py',content:'def test_ok(): pass\n'}]};
const lease:BrowserCheckLease = {leaseToken:'e'.repeat(64),leaseExpiresAt:'2026-11-07T06:00:00.000Z',job:{...input,inputHash:browserCheckInputHash(input)}};
function result(status:'completed'|'cancelled'='completed'):BrowserCheckResult{return {schema:1,kind:'public_checks',jobId:input.jobId,attemptId:input.attemptId,revision:0,inputHash:lease.job.inputHash,
  status,trust:'practice',rewardEligible:false,passed:status==='completed'?1:0,total:status==='completed'?1:0,
  checks:status==='completed'?[{name:'tests/test_main.py::test_ok',passed:true,outcome:'passed'}]:[],...(status==='cancelled'?{failure:'cancelled' as const}:{}),
  provenance:{executor:'docker',image:input.image,runner:'factoryze-browser-public-v1',python:'3.13.18',checkTimeoutMs:5000,runTimeoutMs:60000}};}

test('leased worker posts only bounded worker credentials and the matching result after execution',async()=>{
 const requests:any[]=[];
 await executeBrowserLease({lease,workerId:'worker-unit-one',request:async(path,body)=>{requests.push({path,body});return {ok:true};},check:async()=>result()});
 assert.equal(requests.length,1);assert.match(requests[0].path,/\/finish$/);assert.equal(requests[0].body.leaseToken,lease.leaseToken);
 assert.equal(requests[0].body.result.rewardEligible,false);assert.equal(requests[0].body.result.revision,0);
});
test('lease loss aborts active execution, waits for cleanup and submits cancellation without swallowing cleanup failures',async()=>{
 let cleaned=false,finished=false;
 await executeBrowserLease({lease,workerId:'worker-unit-one',heartbeatMs:1,
 request:async(path,body:any)=>{if(path.endsWith('/heartbeat'))throw Error('lease lost');assert.ok(cleaned);assert.equal(body.result.status,'cancelled');finished=true;return {ok:true};},
 check:async(_job,signal)=>{await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));cleaned=true;return result('cancelled');}});
 assert.ok(finished);
});
test('worker result delivery retries the same result after a lost response',async()=>{
 let calls=0;const results:unknown[]=[];
 await executeBrowserLease({lease,workerId:'worker-unit-one',request:async(_path,body:any)=>{calls++;results.push(body.result);if(calls===1)throw Error('lost response');return {ok:true};},check:async()=>result()});
 assert.equal(calls,2);assert.deepEqual(results[0],results[1]);
});
test('private client refuses insecure remote URLs, malformed tokens and unexpected redirect responses',async()=>{
 assert.throws(()=>createBrowserWorkerClient('http://example.test','a'.repeat(64)),/configuration/i);
 assert.throws(()=>createBrowserWorkerClient('http://127.0.0.1:8092','short'),/configuration/i);
 const request=createBrowserWorkerClient('http://127.0.0.1:8092','a'.repeat(64),async(url,options)=>{
  assert.equal(new URL(String(url)).pathname,'/worker/checks/lease');assert.equal(options?.redirect,'error');
  assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer '+'a'.repeat(64));
  return new Response('{"lease":null}',{status:200});
 });
 assert.deepEqual(await request('/worker/checks/lease',{workerId:'worker-unit-one',image:input.image}),{lease:null});
});
