import { request as httpsRequest, Agent } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { labClientConfigSchema, labJoinResponseSchema, labStudentStateSchema,
  type LabClientConfig, type LabJoinRequest, type LabJoinResponse, type LabStudentState } from '@factoryze/protocol';
const certificateFingerprint=(pem:string)=>createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
export class LabClientError extends Error { readonly status:number;constructor(status:number,message:string){super(message);this.status=status;} }

/** Node-side client for the future desktop backend. Certificate/host checks stay enabled. */
export class LabClient {
  readonly connection: LabClientConfig;
  private readonly token?: string;
  private readonly agent:Agent;
  constructor(input: unknown, token?: string) {
    this.connection = labClientConfigSchema.parse(input); this.token = token;
    if (certificateFingerprint(this.connection.certificate) !== this.connection.fingerprint) throw Error('Lab certificate fingerprint does not match the configured pin');
    this.agent=new Agent({keepAlive:true,maxSockets:4,ca:this.connection.certificate,minVersion:'TLSv1.2',rejectUnauthorized:true,
      checkServerIdentity:(host,cert)=>checkServerIdentity(host,cert)??(cert.fingerprint256?.replaceAll(':','').toLowerCase()===this.connection.fingerprint?undefined:Error('Lab server certificate pin mismatch'))});
  }
  async request(method: 'GET' | 'POST', path: string, body?: unknown, signal?:AbortSignal): Promise<any> {
    if (!path.startsWith('/v1/') || path.includes('?') || path.includes('#')) throw Error('Invalid lab API path');
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(path, this.connection.baseURL), { method, agent: this.agent, minVersion: 'TLSv1.2',signal,
        ca: this.connection.certificate, rejectUnauthorized: true,
        checkServerIdentity: (host, cert) => checkServerIdentity(host, cert) ??
          (cert.fingerprint256?.replaceAll(':', '').toLowerCase() === this.connection.fingerprint ? undefined : Error('Lab server certificate pin mismatch')),
        headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) }
      }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8388608) { response.destroy(Error('Lab response is too large')); return; } chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => {
          let value: any;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(Error('Invalid lab server response')); return; }
          if ((response.statusCode ?? 500) >= 400) reject(new LabClientError(response.statusCode??500,`Lab request failed (${response.statusCode}): ${value.error ?? 'Request refused'}`));
          else resolve(value);
        });
      });
      request.on('error', reject); request.setTimeout(10_000, () => request.destroy(Error('Lab request timed out')));
      request.end(payload);
    });
  }
  async join(input: LabJoinRequest): Promise<LabJoinResponse> { return labJoinResponseSchema.parse(await this.request('POST', '/v1/join', input)); }
  async student(): Promise<LabStudentState> { return labStudentStateSchema.parse(await this.request('GET', '/v1/me')); }
  async resource(path:string):Promise<{body:Buffer;contentType:string}>{
    if(!path.startsWith('/v1/packages/')||path.includes('?')||path.includes('#'))throw Error('Invalid lab package path');
    return new Promise((resolve,reject)=>{const request=httpsRequest(new URL(path,this.connection.baseURL),{agent:this.agent,headers:{...(this.token?{authorization:`Bearer ${this.token}`}:{})}},response=>{
      if(response.statusCode!==200){response.resume();reject(new LabClientError(response.statusCode??500,`Lab package request failed (${response.statusCode})`));return;}
      const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16777216){response.destroy(Error('Lab package exceeds the size limit'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve({body:Buffer.concat(chunks),contentType:String(response.headers['content-type']??'application/octet-stream')}));
    });request.setTimeout(10000,()=>request.destroy(Error('Lab package request timed out')));request.on('error',reject);request.end();});
  }
  close():void{this.agent.destroy();}
}
