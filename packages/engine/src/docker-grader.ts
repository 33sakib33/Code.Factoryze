import type {HiddenCheck} from '@factoryze/protocol';
import type {GradeSnapshot,LabGradeVerdict} from './lab-artifacts.ts';
import {DockerExecutionError,type DockerExecutor} from './docker-executor.ts';

export function createDockerGrader(executor:Pick<DockerExecutor,'image'|'run'>,options:{python:string;checkTimeoutMs?:number;runTimeoutMs?:number}){
  const checkTimeoutMs=options.checkTimeoutMs??10000,runTimeoutMs=options.runTimeoutMs??120000;
  if(![checkTimeoutMs,runTimeoutMs].every(value=>Number.isSafeInteger(value)&&value>0&&value<=120000))throw Error('Invalid Docker grading limits');
  const grader=async(snapshot:GradeSnapshot):Promise<LabGradeVerdict>=>{
    const required=snapshot.task.minimumPython.split('.').map(Number),python=options.python.split('.').map(Number);
    if(python[0]!==3||!Number.isInteger(python[1])||python[0]<required[0]||(python[0]===required[0]&&python[1]<required[1]))throw Error('Grading image Python does not meet the task minimum');
    const deadline=Date.now()+runTimeoutMs;
    const run=(argv:string[],timeoutMs:number)=>executor.run({files:snapshot.files,hidden:snapshot.hidden,argv:['python','-I','/opt/factoryze/runner.py',...argv],timeoutMs});
    const discovered=await run(['discover'],Math.min(checkTimeoutMs,runTimeoutMs));
    let pending:{file:string;name:string}[];
    try{
      const data=JSON.parse(discovered.stdout),files=new Set(snapshot.hidden.map(file=>file.path)),seen=new Set<string>();
      if(discovered.exitCode||discovered.oomKilled||!Array.isArray(data.checks)||!data.checks.length||data.checks.length>200)throw Error();
      pending=data.checks.map((check:any)=>{
        const key=JSON.stringify([check.file,check.name]);
        if(typeof check.file!=='string'||!files.has(check.file)||!/(^|\/)test_[^/]+\.py$/.test(check.file)||typeof check.name!=='string'||!/^test_[A-Za-z0-9_]+$/.test(check.name)||seen.has(key))throw Error();
        seen.add(key);return {file:check.file,name:check.name};
      });
    }catch{throw Error('Invalid isolated test discovery; no grade was recorded');}
    const checks:HiddenCheck[]=[];
    for(const check of pending){
      let passed=false,message='This hidden check did not pass.';
      const remaining=deadline-Date.now();
      if(remaining<=0)message='Timed out at the grading run limit.';
      else try{
        const timeout=Math.min(checkTimeoutMs,remaining),result=await run(['check',check.file,check.name,String(Math.max(1,timeout-500))],timeout);
        try{const verdict=JSON.parse(result.stdout);passed=result.exitCode===0&&!result.oomKilled&&verdict.passed===true&&Object.keys(verdict).every(key=>['passed','message'].includes(key));}catch{/* Untrusted output cannot supply totals or pass a check. */}
        if(result.oomKilled)message='The check exceeded its memory limit.';
      }catch(error){
        if(error instanceof DockerExecutionError&&['timeout','output-limit'].includes(error.kind))message=error.kind==='timeout'?'The check timed out.':'The check exceeded its output limit.';
        else throw error; // A daemon or cleanup failure is a failed job, never a student grade.
      }
      checks.push({name:check.name,passed,...(!passed?{message}:{})});
    }
    return {passed:checks.filter(check=>check.passed).length,total:checks.length,checks,
      provenance:{executor:'docker',image:executor.image,runner:'factoryze-hidden-v1',python:options.python,checkTimeoutMs,runTimeoutMs}};
  };
  return Object.assign(grader,{image:executor.image});
}
