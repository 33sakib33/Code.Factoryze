import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),dist=join(repo,'dist');mkdirSync(dist,{recursive:true});
const output=join(dist,`docker-grader-image-${randomUUID()}.txt`),docker=process.env.FACTORYZE_DOCKER_COMMAND??'docker';
try{
 execFileSync(docker,['build','--pull','--network=none','--tag','factoryze-grader:1','--iidfile',output,join(repo,'packages/engine/docker')],{stdio:'inherit',windowsHide:true,timeout:300000});
 const image=readFileSync(output,'utf8').trim();if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Invalid image ID');
 writeFileSync(join(dist,'docker-grader-image.txt'),image+'\n');console.log(`Built immutable grader image: ${image}\nSet FACTORYZE_LAB_GRADER_IMAGE to this ID before enabling grading.`);
}catch{console.error('Grader image build failed. Install/start a local Linux Docker engine, then rerun pnpm docker:build. No native fallback was used.');process.exitCode=1;}
