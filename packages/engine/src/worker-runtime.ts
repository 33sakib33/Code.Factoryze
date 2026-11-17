import {readFileSync,openSync,closeSync,fstatSync,writeFileSync,renameSync} from 'node:fs';
import {request as httpsRequest} from 'node:https';
import {isAbsolute} from 'node:path';

function file(path:string):Buffer{
 const fd=openSync(path,'r');try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw Error('Invalid worker configuration');return readFileSync(fd);}finally{closeSync(fd);}
}
export function workerToken(env:NodeJS.ProcessEnv):string{
 const path=env.FACTORYZE_BROWSER_WORKER_TOKEN_FILE,value=env.FACTORYZE_BROWSER_WORKER_TOKEN;
 if(path&&value)throw Error('Conflicting worker configuration');
 const token=path?file(path).toString('utf8').replace(/\r?\n$/,''):value??'';
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid worker configuration');return token;
}
export function loadWorkerTLS(env:NodeJS.ProcessEnv):{ca:Buffer;cert:Buffer;key:Buffer}|undefined{
 const paths=[env.FACTORYZE_BROWSER_WORKER_CA_FILE,env.FACTORYZE_BROWSER_WORKER_CERT_FILE,env.FACTORYZE_BROWSER_WORKER_KEY_FILE];
 if(paths.every(path=>!path))return undefined;if(paths.some(path=>!path))throw Error('Incomplete worker TLS configuration');
 return {ca:file(paths[0]!),cert:file(paths[1]!),key:file(paths[2]!)};
}
/** Native HTTPS transport for private mutual TLS. No redirects or insecure TLS override. */
export function mutualTLSFetch(tls:{ca:Buffer;cert:Buffer;key:Buffer}):typeof fetch{
 return (input,init)=>{
  const url=new URL(String(input));if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid mutual TLS configuration');
  return new Promise<Response>((resolve,reject)=>{
   const request=httpsRequest(url,{method:init?.method??'POST',headers:init?.headers as Record<string,string>,ca:tls.ca,cert:tls.cert,key:tls.key,
    rejectUnauthorized:true,signal:init?.signal??AbortSignal.timeout(5000),timeout:5000},reply=>{
    const chunks:Buffer[]=[];let size=0;
    reply.on('data',(data:Buffer)=>{size+=data.length;if(size>3*1024*1024)request.destroy(Error('Private response limit exceeded'));else chunks.push(data);});
    reply.on('error',reject);reply.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:reply.statusCode??500})));
   });request.on('timeout',()=>request.destroy(Error('Private request timed out')));request.on('error',reject);request.end(init?.body as string|undefined);
  });
 };
}
export function writeWorkerHealth(path:string|undefined,ready:boolean,at=Date.now()):void{
 if(!path)return;if(!isAbsolute(path))throw Error('Invalid health configuration');const temporary=path+'.'+process.pid+'.tmp';
 writeFileSync(temporary,JSON.stringify({pid:process.pid,ready,at}),{mode:0o600});renameSync(temporary,path);
}
export function workerHealthy(path:string,now=Date.now()):boolean{
 try{const value=JSON.parse(file(path).toString('utf8'));if(value.ready!==true||!Number.isSafeInteger(value.at)||value.at>now||now-value.at>15000||!Number.isSafeInteger(value.pid)||value.pid<1)return false;process.kill(value.pid,0);return true;}catch{return false;}
}
