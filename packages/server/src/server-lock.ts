import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** One process owns a server state directory; startup must not mutate another server's active jobs. */
export function claimServerLock(directory:string):()=>void {
 const root=realpathSync.native(directory),path=join(root,'server.lock'),id=randomUUID();
 if(existsSync(path)){
  if(lstatSync(path).isSymbolicLink())throw Error('Invalid server lock');
  const previous=JSON.parse(readFileSync(path,'utf8'));
  if(!Number.isSafeInteger(previous.pid)||previous.pid<=0)throw Error('Invalid server lock');
  try{process.kill(previous.pid,0);throw Error('This lab state is already served by another process');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  unlinkSync(path);
 }
 writeFileSync(path,JSON.stringify({pid:process.pid,id}),{flag:'wx',mode:0o600});
 return()=>{if(existsSync(path)&&!lstatSync(path).isSymbolicLink()){
  const current=JSON.parse(readFileSync(path,'utf8'));if(current.pid===process.pid&&current.id===id)unlinkSync(path);
 }};
}
