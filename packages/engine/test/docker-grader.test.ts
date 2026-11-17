import assert from 'node:assert/strict';
import test from 'node:test';
import {createDockerGrader} from '../src/docker-grader.ts';
import {DockerExecutionError} from '../src/docker-executor.ts';
const snapshot={id:'submission',lab:'class',member:'one',files:[{path:'main.py',data:''}],hidden:[{path:'test_main.py',data:''}],task:{minimumPython:'3.11'}}as any;
test('isolated grader takes names only from trusted discovery, runs each check freshly and continues after a timeout',async()=>{
 const runs:any[]=[];const grader=createDockerGrader({image:'sha256:'+'a'.repeat(64),run:async input=>{runs.push(input);
  if(input.argv.includes('discover'))return{stdout:JSON.stringify({checks:[{file:'test_main.py',name:'test_a'},{file:'test_main.py',name:'test_b'}]}),exitCode:0,oomKilled:false};
  if(input.argv.includes('test_a'))throw new DockerExecutionError('timeout','synthetic timeout');
  return{stdout:JSON.stringify({passed:true}),exitCode:0,oomKilled:false};
 }},{python:'3.13.0',checkTimeoutMs:100,runTimeoutMs:1000});
 const result=await grader(snapshot);assert.equal(result.total,2);assert.equal(result.passed,1);assert.match(result.checks![0]!.message!,/timed out/i);
 assert.equal(runs.length,3);assert.ok(runs.every(run=>run.hidden===snapshot.hidden));assert.equal(result.provenance!.image,'sha256:'+'a'.repeat(64));
});
test('isolated grader refuses forged discovery, unsupported Python, malformed verdicts and infrastructure/cleanup failures',async()=>{
 const executor={image:'sha256:'+'a'.repeat(64),run:async()=>({stdout:'{"checks":[{"file":"../escape.py","name":"test_x"}]}',exitCode:0,oomKilled:false})};
 await assert.rejects(createDockerGrader(executor,{python:'3.13.0'})(snapshot),/discovery/i);
 await assert.rejects(createDockerGrader(executor,{python:'3.10.0'})(snapshot),/Python/i);
 const discovery={stdout:'{"checks":[{"file":"test_main.py","name":"test_x"}]}',exitCode:0,oomKilled:false};
 const forged=await createDockerGrader({...executor,run:async input=>input.argv.includes('discover')?discovery:{stdout:'{"passed":100,"total":100}',exitCode:0,oomKilled:false}},{python:'3.13.0'})(snapshot);
 assert.equal(forged.passed,0);assert.equal(forged.total,1);
 await assert.rejects(createDockerGrader({...executor,run:async input=>{if(input.argv.includes('discover'))return discovery;throw new DockerExecutionError('cleanup','cleanup failure');}},{python:'3.13.0'})(snapshot),/cleanup/);
});
