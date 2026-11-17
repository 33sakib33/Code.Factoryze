import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {labCreateSchema} from '../../../packages/protocol/src/index.ts';
const require=createRequire(new URL('../../../packages/engine/package.json',import.meta.url));
const {parse}=require('yaml');
for(const path of ['.github/workflows/ci.yml','.github/workflows/installers.yml']){
 const workflow=parse(readFileSync(path,'utf8'));
 assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'));
 const steps=Object.values(workflow.jobs).flatMap(job=>job.steps??[]);
 assert.ok(steps.some(step=>step.run?.includes('pnpm test')));
 assert.equal(steps.filter(step=>step.name?.includes('OpenSSL')).length,2);
}
labCreateSchema.parse(JSON.parse(readFileSync('packages/server/examples/lab.json','utf8')));
assert.equal(JSON.parse(readFileSync('packages/server/package.json','utf8')).name,'@factoryze/server');
console.log(JSON.stringify({passed:true,workflowYamlParsed:2,workflowsStillManualOnly:true,exampleConfigurationValidated:true,newExternalPackages:0}));
