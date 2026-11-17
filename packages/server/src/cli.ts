import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LabEngine } from '@factoryze/engine/lab';
import { initializeServer, loadIdentity } from './identity.ts';
import { createLabServer } from './server.ts';
import { LabClient } from './client.ts';
import { LabRuntime } from '@factoryze/engine/lab-runtime';
import { HttpProvider } from '@factoryze/engine/provider';
import { fileURLToPath } from 'node:url';
import { claimServerLock } from './server-lock.ts';
import { startPackageIndex } from '@factoryze/engine/package-index';
import {DockerExecutor,DockerExecutionError} from '@factoryze/engine/docker-executor';
import {createDockerGrader} from '@factoryze/engine/docker-grader';
import {createHash} from 'node:crypto';

const help = `Factoryze lab pilot (draft; Docker grading is opt-in)
  pnpm factoryze server init --data DIR --url https://SERVER:9443 [--openssl PATH]
  pnpm factoryze server serve --data DIR [--host 127.0.0.1] [--tasks TASK_ROOT]
  pnpm factoryze lab create --data DIR --config lab.json
  pnpm factoryze lab watch LAB --data DIR [--once]
  pnpm factoryze lab close LAB --data DIR
  pnpm factoryze lab export LAB --data DIR [--out usage.csv]
  pnpm factoryze lab release LAB --data DIR
  pnpm factoryze lab grade LAB --data DIR
  pnpm factoryze lab grades LAB --data DIR
  pnpm factoryze lab integrity LAB --data DIR
  pnpm factoryze lab reset LAB --student STUDENT --data DIR
  pnpm factoryze lab reconcile LAB --student STUDENT --record reconciliation.json --data DIR
Distribute only DIR/client.json. Protect the entire server state directory.
Use --host 0.0.0.0 explicitly to accept LAN connections.
Docker grading: FACTORYZE_LAB_GRADING=1 and FACTORYZE_LAB_GRADER_IMAGE=sha256:IMAGE_ID.
Requires a running local Linux engine and the built Factoryze grader image; no native fallback.`;

async function main(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help')) { console.log(help); return; }
  const [group, command, ...rest] = args;
  const flags: Record<string, string> = {}, positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (!key.startsWith('--')) { positional.push(key); continue; }
    if (key === '--once') { flags.once = 'true'; continue; }
    if (!['--data', '--url', '--host', '--config', '--openssl', '--out','--tasks','--student','--record'].includes(key) || !rest[i + 1] || rest[i + 1]!.startsWith('--'))
      throw Error('Unknown option or missing value; use --help');
    flags[key.slice(2)] = rest[++i]!;
  }
  const directory = resolve(flags.data ?? '.factoryze-lab');
  if (group === 'server' && command === 'init') {
    if (!flags.url) throw Error('Server init requires --url https://SERVER:PORT');
    const connection = initializeServer(directory, flags.url, flags.openssl);
    console.log(JSON.stringify({ clientConfig: join(directory, 'client.json'), fingerprint: connection.fingerprint, baseURL: connection.baseURL }));
    return;
  }
  const identity = loadIdentity(directory);
  if (group === 'server' && command === 'serve') {
    const releaseLock=claimServerLock(directory);
    let engine:LabEngine|undefined,server:ReturnType<typeof createLabServer>|undefined,index:Awaited<ReturnType<typeof startPackageIndex>>|undefined;
    try{
    engine = new LabEngine(directory,{taskRoot:flags.tasks?resolve(flags.tasks):fileURLToPath(new URL('../../../tasks/practice',import.meta.url))});
    let runtime:LabRuntime|undefined;
    if(process.env.FACTORYZE_LAB_INFERENCE==='1'){
      const baseURL=process.env.FACTORYZE_LAB_PROVIDER_URL,apiKey=process.env.FACTORYZE_LAB_PROVIDER_KEY,model=process.env.FACTORYZE_LAB_MODEL;
      const api=process.env.FACTORYZE_LAB_MODEL_API??'openai-chat',contextWindow=Number(process.env.FACTORYZE_LAB_CONTEXT_WINDOW??32768),maxOutputTokens=Number(process.env.FACTORYZE_LAB_MAX_OUTPUT_TOKENS??1024);
      if(!baseURL||!apiKey||!model||!['openai-chat','anthropic-messages'].includes(api)||!Number.isSafeInteger(contextWindow)||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||contextWindow<=maxOutputTokens)throw Error('Invalid private lab provider configuration');
      runtime=new LabRuntime(engine,{provider:new HttpProvider({baseURL,apiKey,api:api as 'openai-chat'|'anthropic-messages'}),providerHost:new URL(baseURL).hostname,model,api:api as 'openai-chat'|'anthropic-messages',contextWindow,maxOutputTokens});
    }
    let grader:ReturnType<typeof createDockerGrader>|undefined;
    if(process.env.FACTORYZE_LAB_GRADING==='1'){
      const executor=new DockerExecutor({image:process.env.FACTORYZE_LAB_GRADER_IMAGE??'',owner:createHash('sha256').update(directory).digest('hex'),
        ...(process.env.FACTORYZE_DOCKER_COMMAND?{docker:process.env.FACTORYZE_DOCKER_COMMAND}:{})});
      const health=await executor.initialize();grader=createDockerGrader(executor,{python:health.python});
    }
    index=await startPackageIndex(join(directory,'wheels'));
    const activeServer=server = createLabServer(engine, identity,{runtime,grader,packageIndexURL:index.url});
      await new Promise<void>((accept, reject) => { activeServer.once('error', reject); activeServer.listen(Number(new URL(identity.connection.baseURL).port || 443), flags.host ?? '127.0.0.1', accept); });
      console.log(JSON.stringify({ status: 'listening', baseURL: identity.connection.baseURL, bind: flags.host ?? '127.0.0.1', inference: !!runtime, grading: !!grader }));
      await new Promise<void>(accept => { process.once('SIGINT', accept); process.once('SIGTERM', accept); });
    } finally {
      if(server){const current=server;current.closeAllConnections();await new Promise<void>(accept=>current.close(()=>accept()));await current.disposeLab();}
      await index?.close();engine?.close();releaseLock();
    }
    return;
  }
  if (group !== 'lab') throw Error('Unknown command; use --help');
  const client = new LabClient(identity.connection, identity.operatorToken);
  if (command === 'create') {
    if (!flags.config) throw Error('Lab create requires --config lab.json');
    console.log(JSON.stringify(await client.request('POST', '/v1/admin/labs', JSON.parse(readFileSync(resolve(flags.config), 'utf8')))));
    return;
  }
  const lab = positional[0];
  if (positional.length !== 1 || !lab || !/^[a-z][a-z0-9-]*$/.test(lab)) throw Error('Provide one lab identifier');
  const path = `/v1/admin/labs/${lab}`;
  if (command === 'close') console.log(JSON.stringify(await client.request('POST', `${path}/close`, {})));
  else if(command==='release'||command==='grade')console.log(JSON.stringify(await client.request('POST',`${path}/${command}`,{})));
  else if(command==='integrity')console.log(JSON.stringify(await client.request('GET',`${path}/integrity`)));
  else if(command==='grades')console.log(JSON.stringify(await client.request('GET',`${path}/grading`)));
  else if(command==='reset'||command==='reconcile'){
    if(!flags.student||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(flags.student))throw Error('Provide --student STUDENT');
    const body=command==='reconcile'?(flags.record?JSON.parse(readFileSync(resolve(flags.record),'utf8')):(()=>{throw Error('Provide --record reconciliation.json');})()):{};
    const result=await client.request('POST',`${path}/students/${flags.student}/${command}`,body);console.log(JSON.stringify(result));
  }
  else if (command === 'export') {
    const { csv } = await client.request('GET', `${path}/export`);
    if (flags.out) writeFileSync(resolve(flags.out), csv, { flag: 'wx', mode: 0o600 });
    else process.stdout.write(csv);
  } else if (command === 'watch') {
    do {
      console.log(JSON.stringify(await client.request('GET', path)));
      if (flags.once) break;
      await delay(2000);
    } while (true);
  } else throw Error('Unknown lab command; use --help');
}
main(process.argv.slice(2)).catch(error => { console.error(error instanceof DockerExecutionError?error.message:'Lab command failed. Check arguments, private server identity, connectivity and lab state; use --help.'); process.exitCode = 1; });
