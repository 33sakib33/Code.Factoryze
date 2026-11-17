import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimServerLock} from '../src/server-lock.ts';

test('server state lock refuses a live owner, reclaims stale state and releases only its own marker',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-state-lock-')),path=join(root,'server.lock');
 try{
  const release=claimServerLock(root);assert.throws(()=>claimServerLock(root),/already served/);release();assert.equal(existsSync(path),false);
  // Windows and Unix reject this PID as nonexistent; do not signal arbitrary processes.
  writeFileSync(path,JSON.stringify({pid:2147483647,id:'stale'}));const second=claimServerLock(root);
  writeFileSync(path,JSON.stringify({pid:process.pid,id:'replacement'}));second();assert.equal(existsSync(path),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
