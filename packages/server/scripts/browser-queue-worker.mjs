import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserCheckLeaseRequestSchema,browserCheckLeaseResponseSchema} from '@factoryze/protocol';
import {DockerExecutor,DockerExecutionError} from '@factoryze/engine/docker-executor';
import {createBrowserChecker} from '@factoryze/engine/browser-checks';
import {createBrowserWorkerClient,executeBrowserLease,BrowserWorkerRequestError} from '@factoryze/engine/browser-queue';
import {claimServerLock} from '../src/server-lock.ts';
import {loadWorkerTLS,workerToken,mutualTLSFetch,writeWorkerHealth} from '../../engine/src/worker-runtime.ts';

const controller=new AbortController();const stop=()=>controller.abort();process.on('SIGTERM',stop);process.on('SIGINT',stop);
let release;
const healthFile=process.env.FACTORYZE_BROWSER_WORKER_HEALTH_FILE;
try{
 if(process.env.FACTORYZE_BROWSER_CHECKS!=='1')throw Error('Disabled');
 const image=process.env.FACTORYZE_BROWSER_GRADER_IMAGE,state=process.env.FACTORYZE_BROWSER_WORKER_STATE;
 if(!state||!isAbsolute(state)||process.argv.length!==2)throw Error('Invalid state');
 const tls=loadWorkerTLS(process.env);
 const rawRequest=createBrowserWorkerClient(process.env.FACTORYZE_BROWSER_WORKER_URL??'',workerToken(process.env),tls?mutualTLSFetch(tls):fetch);
 const request=async(path,body)=>{const response=await rawRequest(path,body);if(path.endsWith('/lease'))browserCheckLeaseResponseSchema.parse(response);else if(!response||response.ok!==true)throw Error('Invalid worker acknowledgement');writeWorkerHealth(healthFile,true);return response;};
 const workerId='worker-'+randomUUID();const claim=browserCheckLeaseRequestSchema.parse({workerId,image});
 mkdirSync(state,{recursive:true,mode:0o700});const root=realpathSync.native(state);release=claimServerLock(root);
 const executor=new DockerExecutor({image,owner:'browser-'+createHash('sha256').update(root).digest('hex').slice(0,40),docker:process.env.FACTORYZE_DOCKER_COMMAND});
 const health=await executor.initialize();const checker=createBrowserChecker(executor,{python:health.python});
 process.stderr.write('Private browser check worker ready.\n');
 while(!controller.signal.aborted){
  try{
   const response=browserCheckLeaseResponseSchema.parse(await request('/worker/checks/lease',claim));
   if(response.lease){await executeBrowserLease({lease:response.lease,workerId,request,signal:controller.signal,check:async(job,signal)=>{
    const result=await checker(job,signal);
    // A cleanup failure quarantines this process. Restart reaps only its own containers.
    if(result.failure==='execution_unavailable'){process.exitCode=2;controller.abort();}
    return result;
   }});continue;}
  }catch(error){
   if(error instanceof BrowserWorkerRequestError&&[400,401,403].includes(error.status))throw error;
   if(error instanceof DockerExecutionError&&error.kind==='cleanup')throw error;
   process.stderr.write('Private check operation unavailable; no public grade or reward recorded.\n');
  }
  await sleep(2000,undefined,{signal:controller.signal}).catch(()=>{});
 }
}catch{process.stderr.write('Private browser check worker disabled, misconfigured or unavailable.\n');process.exitCode=1;}
finally{try{writeWorkerHealth(healthFile,false);}finally{release?.();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}}
