import {browserCheckLeaseSchema,browserCheckFinishSchema,browserCheckHeartbeatSchema,
  type BrowserCheckJob,type BrowserCheckLease,type BrowserCheckResult} from '@factoryze/protocol';

export class BrowserWorkerRequestError extends Error {
  readonly status:number;
  constructor(status:number){super('Private worker request failed');this.status=status;}
}
export function createBrowserWorkerClient(baseURL:string,token:string,fetcher:typeof fetch=fetch){
  const url=new URL(baseURL);
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||
    !(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))||!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid private worker configuration');
  return async(path:string,body:unknown):Promise<unknown>=>{
    if(!/^\/worker\/checks\/(lease|[a-f0-9]{24}\/(heartbeat|finish))$/.test(path))throw Error('Invalid private worker path');
    const reply=await fetcher(new URL(path,url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    if(!reply.ok){await reply.body?.cancel();throw new BrowserWorkerRequestError(reply.status);}
    const reader=reply.body?.getReader();if(!reader)throw Error('Missing private worker response');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>3*1024*1024)throw Error('Private worker response exceeded limit');chunks.push(next.value);}}
    finally{await reader.cancel();}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  };
}

/** Keep one lease alive; lease loss must stop execution before acknowledging it. */
export async function executeBrowserLease(options:{lease:BrowserCheckLease;workerId:string;
  request:(path:string,body:unknown)=>Promise<unknown>;
  check:(job:BrowserCheckJob,signal:AbortSignal)=>Promise<BrowserCheckResult>;signal?:AbortSignal;heartbeatMs?:number}):Promise<void>{
  const lease=browserCheckLeaseSchema.parse(options.lease),controller=new AbortController();
  const identity=browserCheckHeartbeatSchema.parse({workerId:options.workerId,leaseToken:lease.leaseToken});
  const stop=()=>controller.abort();options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
  let done=false,timer:ReturnType<typeof setTimeout>|undefined,heartbeat:Promise<void>=Promise.resolve();
  const deadline=setTimeout(stop,110000);
  const beat=async()=>{try{await options.request(`/worker/checks/${lease.job.jobId}/heartbeat`,identity);}catch{stop();}
    finally{if(!done&&!controller.signal.aborted)timer=setTimeout(()=>{heartbeat=beat();},options.heartbeatMs??3000);}};
  timer=setTimeout(()=>{heartbeat=beat();},options.heartbeatMs??3000);
  let result:BrowserCheckResult;
  try{result=await options.check(lease.job,controller.signal);}
  finally{done=true;clearTimeout(timer);clearTimeout(deadline);options.signal?.removeEventListener('abort',stop);await heartbeat;}
  const body=browserCheckFinishSchema.parse({...identity,result});
  for(let attempt=0;;attempt++){
    try{await options.request(`/worker/checks/${lease.job.jobId}/finish`,body);return;}
    catch(error){if(attempt>=2||(error instanceof BrowserWorkerRequestError&&error.status<500))throw error;}
  }
}
