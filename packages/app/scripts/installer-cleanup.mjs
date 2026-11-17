import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';

/** Remove only the direct temporary child created by the installed-smoke wrapper. */
export function cleanupWindowsInstaller(root,{run=execFileSync,remove=rmSync}={}) {
 const equal=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 const absolute=resolve(root);
 const canonicalTemporary=realpathSync.native(tmpdir());
 if(!isAbsolute(root)||!equal(realpathSync.native(dirname(absolute)),canonicalTemporary)||
    !/^factoryze-installer-smoke-[A-Za-z0-9_-]+$/.test(basename(absolute)))
  throw Error('Cleanup requires an owned installer-smoke temporary directory');
 if(!existsSync(absolute))return {uninstallAttempted:false,rootRemoved:true};
 const info=lstatSync(absolute);
 if(!info.isDirectory()||info.isSymbolicLink()||!equal(realpathSync.native(absolute),join(canonicalTemporary,basename(absolute))))
  throw Error('Cleanup requires an owned installer-smoke temporary directory, not a link');
 const installed=join(absolute,'installed'),uninstaller=join(installed,'Uninstall Factoryze.exe');
 let uninstallAttempted=false;
 if(existsSync(installed)&&lstatSync(installed).isSymbolicLink())throw Error('Installed-smoke directory must not be a link');
 if(existsSync(uninstaller)){
  // NSIS otherwise starts a temporary copy and exits before uninstall finishes.
  // Its final _?= path consumes the remainder verbatim, including spaces.
  // https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.2
  run(uninstaller,['/S',`_?=${installed}`],{timeout:60000,windowsHide:true,
   windowsVerbatimArguments:true,argv0:`"${uninstaller}"`,cwd:dirname(absolute)});
  uninstallAttempted=true;
 }else if(existsSync(join(installed,'Factoryze.exe'))){
  throw Error(`Installed app uninstaller is missing; preserved smoke directory: ${absolute}`);
 }
 remove(absolute,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 if(existsSync(absolute))throw Error('Installed-smoke temporary directory remains after cleanup');
 return {uninstallAttempted,rootRemoved:true};
}
