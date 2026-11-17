import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,rmdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanupWindowsInstaller} from './installer-cleanup.mjs';

function fixture(){const root=mkdtempSync(join(tmpdir(),'factoryze-installer-smoke-'));mkdirSync(join(root,'installed'));writeFileSync(join(root,'installed/Uninstall Factoryze.exe'),'test placeholder');writeFileSync(join(root,'installed/Factoryze.exe'),'test placeholder');return root;}
test('Windows smoke waits for in-place NSIS uninstall before removing its owned directory',()=>{
 const root=fixture();let completed=false;
 try {cleanupWindowsInstaller(root,{run:(file,args,options)=>{
  assert.equal(file,join(root,'installed/Uninstall Factoryze.exe'));
  assert.deepEqual(args,['/S',`_?=${join(root,'installed')}`]);
  assert.equal(options.windowsVerbatimArguments,true);assert.equal(options.argv0,`"${file}"`);
  completed=true;
 },remove:(target,options)=>{assert.equal(completed,true,'Uninstall must finish before recursive cleanup');assert.equal(target,root);rmSync(target,options);}});assert.equal(existsSync(root),false);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('failed uninstall is reported and preserves the install for diagnosis',()=>{
 const root=fixture(),failure=new Error('simulated uninstall failure');let removed=false;
 try {assert.throws(()=>cleanupWindowsInstaller(root,{run:()=>{throw failure;},remove:()=>{removed=true;}}),error=>error===failure);assert.equal(removed,false);assert.equal(existsSync(join(root,'installed/Factoryze.exe')),true);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('cleanup refuses an unrelated temporary directory before invoking any operation',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-unrelated-'));let called=false;
 try{assert.throws(()=>cleanupWindowsInstaller(root,{run:()=>{called=true;},remove:()=>{called=true;}}),/owned.*temporary/i);assert.equal(called,false);assert.equal(existsSync(root),true);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('an installed executable without an uninstaller is an explicit cleanup failure',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-installer-smoke-'));mkdirSync(join(root,'installed'));writeFileSync(join(root,'installed/Factoryze.exe'),'placeholder');
 try{assert.throws(()=>cleanupWindowsInstaller(root),/uninstaller.*missing/i);assert.equal(existsSync(root),true);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('cleanup removes an owned directory when setup never installed an app',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-installer-smoke-'));cleanupWindowsInstaller(root);assert.equal(existsSync(root),false);
});
test('cleanup permits a canonical temporary-parent alias without following a linked root',()=>{
 const parent=mkdtempSync(join(tmpdir(),'factoryze-cleanup-parent-'));const actual=join(parent,'actual'),alias=join(parent,'alias');mkdirSync(actual);symlinkSync(actual,alias,process.platform==='win32'?'junction':'dir');
 const keys=['TEMP','TMP','TMPDIR'],previous=keys.map(key=>process.env[key]);
 try{for(const key of keys)process.env[key]=alias;const root=mkdtempSync(join(tmpdir(),'factoryze-installer-smoke-'));cleanupWindowsInstaller(root);assert.equal(existsSync(root),false);}
 finally{for(const [i,key]of keys.entries())if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];rmSync(parent,{recursive:true,force:true});}
});
test('a linked smoke root cannot redirect cleanup into a different directory',()=>{
 const root=mkdtempSync(join(tmpdir(),'factoryze-installer-smoke-')),victim=mkdtempSync(join(tmpdir(),'factoryze-cleanup-victim-'));writeFileSync(join(victim,'keep'),'retained');rmdirSync(root);symlinkSync(victim,root,process.platform==='win32'?'junction':'dir');
 try{assert.throws(()=>cleanupWindowsInstaller(root),/temporary directory.*not a link/i);assert.equal(existsSync(join(victim,'keep')),true);}
 finally{rmSync(root,{recursive:true,force:true});rmSync(victim,{recursive:true,force:true});}
});
