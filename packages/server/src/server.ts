import { createServer, type Server } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LabError, type LabEngine } from '@factoryze/engine/lab';
import type { ServerIdentity } from './identity.ts';
import type { LabRuntime } from '@factoryze/engine/lab-runtime';
import type { Reconciliation } from '@factoryze/protocol';

export function createLabServer(engine: LabEngine, identity: ServerIdentity, options:{runtime?:LabRuntime;grader?:Parameters<LabEngine['gradeQueued']>[0];packageIndexURL?:string}={}): Server & {disposeLab():Promise<void>} {
  if(options.packageIndexURL){const index=new URL(options.packageIndexURL);if(index.protocol!=='http:'||index.hostname!=='127.0.0.1')throw Error('Lab wheelhouse must be the server-owned loopback index');}
  let grading:Promise<unknown>|undefined,stopping=false;
  const scheduleGrade=()=>{if(options.grader&&!grading&&!stopping)grading=engine.gradeQueued(options.grader).finally(()=>{grading=undefined;});};
  const attempts = new Map<string, { until: number; count: number }>();
  const ownerHash = createHash('sha256').update(identity.operatorToken).digest();
  const server = createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2',
    requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      const path = request.url ?? '';
      if (request.headers.origin) throw new LabError(403, 'Use the configured desktop lab client');
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? '';
      if(request.method==='GET'&&path.startsWith('/v1/packages/')){
        engine.student(token);if(!options.packageIndexURL)throw new LabError(503,'Lab wheelhouse is not configured');
        const resource=decodeURIComponent(path.slice('/v1/packages'.length));
        if(!/^\/(?:simple\/(?:[a-z0-9-]+\/)?|wheels\/[A-Za-z0-9_.+!-]+\.whl)$/.test(resource))throw new LabError(404,'Package not found');
        const result=await fetch(new URL(resource,new URL(options.packageIndexURL).origin),{redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!result.ok){await result.body?.cancel();throw new LabError(result.status,'Package not found');}
        const chunks:Uint8Array[]=[];let bytes=0;
        for await(const chunk of result.body??[]){bytes+=chunk.length;if(bytes>16777216)throw new LabError(413,'Lab package exceeds the size limit');chunks.push(chunk);}
        response.writeHead(200,{'content-type':result.headers.get('content-type')??'application/octet-stream','cache-control':'no-store'}).end(Buffer.concat(chunks));return;
      }
      if (path.startsWith('/v1/admin/')) {
        const hash = createHash('sha256').update(token).digest();
        if (!token || !timingSafeEqual(hash, ownerHash)) throw new LabError(401, 'Instructor authorization required');
      }
      if (path === '/v1/join') {
        const ip = request.socket.remoteAddress ?? 'unknown', now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        let bucket = attempts.get(ip);
        if (!bucket) {
          if (attempts.size >= 1024) throw new LabError(429, 'Lab join rate limit reached');
          bucket = { until: now + 60_000, count: 0 }; attempts.set(ip, bucket);
        }
        if (bucket.count >= 20) throw new LabError(429, 'Too many failed join attempts; retry in one minute');
      }
      let body: unknown;
      if (request.method === 'POST') {
        if (request.headers['content-type'] !== 'application/json') throw new LabError(415, 'Send application/json');
        const chunks: Buffer[] = []; let size = 0;
        if(path!=='/v1/join'&&!path.startsWith('/v1/admin/')&&path!=='/v1/health')engine.student(token);
        for await (const chunk of request) { size += chunk.length; if (size > (path==='/v1/mirror'?6_000_000:100_000)) throw new LabError(413, 'Lab request is too large'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LabError(400, 'Invalid JSON request'); }
      }
      if (request.method === 'GET' && path === '/v1/health') send(200, { protocol: 1, status: 'ready', inference: !!options.runtime, grading: !!options.grader,packages:!!options.packageIndexURL });
      else if (request.method === 'POST' && path === '/v1/join') send(200, engine.join(body));
      else if (request.method === 'GET' && path === '/v1/me') send(200, engine.student(token));
      else if(request.method==='GET'&&path==='/v1/task')send(200,engine.task(token));
      else if(request.method==='GET'&&path==='/v1/mirror')send(200,engine.mirror(token));
      else if(request.method==='POST'&&path==='/v1/mirror')send(200,engine.sync(token,body));
      else if(request.method==='POST'&&path==='/v1/submit'){send(200,engine.submit(token,body));scheduleGrade();}
      else if(request.method==='GET'&&path==='/v1/submissions')send(200,{submissions:engine.submissions(token)});
      else if(request.method==='GET'&&path==='/v1/reports')send(200,{reports:engine.releasedReports(token)});
      else if(request.method==='GET'&&path==='/v1/prompts'){const context=engine.access(token);send(200,{prompts:context.store.promptUsage(context.workspace,context.id)});}
      else if(request.method==='POST'&&path==='/v1/client-events'){engine.recordClientEvent(token,body);send(200,{saved:true});}
      else if(path.startsWith('/v1/agent/')){
        if(!options.runtime)throw new LabError(503,'Lab model inference is not configured');
        if(request.method!=='POST')throw new LabError(404,'Lab endpoint not found');
        if(path==='/v1/agent/start')send(200,await options.runtime.start(token,body));
        else if(path==='/v1/agent/prompt')send(200,options.runtime.prompt(token,body));
        else if(path==='/v1/agent/poll')send(200,options.runtime.poll(token,body));
        else if(path==='/v1/agent/result'){options.runtime.result(token,body);send(200,{saved:true});}
        else if(path==='/v1/agent/stop'){await options.runtime.stop(token);send(200,{stopped:true});}
        else throw new LabError(404,'Lab endpoint not found');
      }
      else if (request.method === 'POST' && path === '/v1/admin/labs') send(201, engine.create(body));
      else {
        const student=path.match(/^\/v1\/admin\/labs\/([a-z][a-z0-9-]*)\/students\/([A-Za-z0-9._-]+)\/(reset|reconcile)$/);
        if(student&&request.method==='POST'){
          await options.runtime?.stopStudent(student[1]!,student[2]!);
          if(student[3]==='reset')send(200,engine.resetStudent(student[1]!,student[2]!));
          else {engine.reconcileStudent(student[1]!,student[2]!,body as Reconciliation);send(200,{saved:true});}return;
        }
        const lab = path.match(/^\/v1\/admin\/labs\/([a-z][a-z0-9-]*)(\/close|\/export|\/release|\/grade|\/grading|\/integrity)?$/);
        if (lab && request.method === 'GET' && !lab[2]) send(200, engine.overview(lab[1]!));
        else if (lab && request.method === 'POST' && lab[2] === '/close'){await options.runtime?.stopStudent(lab[1]!);send(200, engine.closeLab(lab[1]!));scheduleGrade();}
        else if (lab && request.method === 'GET' && lab[2] === '/export') send(200, { csv: engine.exportCsv(lab[1]!) });
        else if(lab&&request.method==='POST'&&lab[2]==='/release')send(200,engine.release(lab[1]!));
        else if(lab&&request.method==='POST'&&lab[2]==='/grade'){if(!options.grader)throw new LabError(503,'Isolated grading is not configured');const retried=engine.retryGrades(lab[1]!);scheduleGrade();send(202,{queued:true,retried});}
        else if(lab&&request.method==='GET'&&lab[2]==='/integrity')send(200,{students:engine.integrity(lab[1]!)});
        else if(lab&&request.method==='GET'&&lab[2]==='/grading')send(200,engine.gradingStatus(lab[1]!));
        else throw new LabError(404, 'Lab endpoint not found');
      }
    } catch (error) {
      if(request.url==='/v1/join'){const bucket=attempts.get(request.socket.remoteAddress??'unknown');if(bucket)bucket.count++;}
      if (!response.headersSent && !response.destroyed) send(error instanceof LabError ? error.status : error instanceof Error&&error.name==='ZodError'?400:409,
        { error: error instanceof LabError ? error.message : 'The lab request conflicts with the current state or contains invalid data. Reconnect and retry.' });
    }
  });
  const expiry = setInterval(() => {engine.closeExpired();void options.runtime?.sweep();scheduleGrade();}, 1000); expiry.unref();
  server.on('close', () => clearInterval(expiry));
  return Object.assign(server,{disposeLab:async()=>{stopping=true;clearInterval(expiry);await options.runtime?.close();await grading;}});
}
