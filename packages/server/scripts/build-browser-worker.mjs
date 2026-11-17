import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=resolve(process.argv[2]??join(root,'dist/browser-worker'));
if(existsSync(output))throw Error('Choose a new output directory; existing artifacts are never overwritten.');
const requireBuild=createRequire(join(root,'tools/browser-worker-build/package.json'));
const {build}=requireBuild('esbuild');
const pin=JSON.parse(readFileSync(join(root,'tools/browser-worker-build/package.json'),'utf8')).dependencies;
for(const [pkg,key]of [['protocol','zod'],['engine','yaml']])if(JSON.parse(readFileSync(join(root,`packages/${pkg}/package.json`),'utf8')).dependencies[key]!==pin[key])throw Error('Worker build dependency pins differ from the source packages.');
mkdirSync(output,{recursive:true});
const aliases={'@factoryze/protocol':join(root,'packages/protocol/src/index.ts'),zod:requireBuild.resolve('zod'),yaml:requireBuild.resolve('yaml')};
for(const name of ['docker-executor','browser-checks','browser-queue'])aliases['@factoryze/engine/'+name]=join(root,`packages/engine/src/${name}.ts`);
await build({entryPoints:{'browser-worker':join(root,'packages/server/scripts/browser-queue-worker.mjs'),'browser-worker-health':join(root,'packages/server/scripts/browser-worker-health.mjs')},
 outdir:output,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',target:'node22',format:'esm',alias:aliases,legalComments:'linked',
 banner:{js:"import {createRequire as factoryzeCreateRequire} from 'node:module'; const require = factoryzeCreateRequire(import.meta.url);"}});
for(const name of ['LICENSE','NOTICE'])copyFileSync(join(root,name),join(output,name));
mkdirSync(join(output,'grader'));for(const name of ['Dockerfile','runner.py','.dockerignore'])copyFileSync(join(root,'packages/engine/docker',name),join(output,'grader',name));
const names=['browser-worker.mjs','browser-worker-health.mjs','LICENSE','NOTICE','grader/Dockerfile','grader/runner.py','grader/.dockerignore'];
for(const name of ['browser-worker.mjs.LEGAL.txt','browser-worker-health.mjs.LEGAL.txt'])if(existsSync(join(output,name)))names.push(name);
const files=Object.fromEntries(names.map(name=>[name,createHash('sha256').update(readFileSync(join(output,name))).digest('hex')]));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()!=='';
writeFileSync(join(output,'manifest.json'),JSON.stringify({schema:1,nodeMajor:22,commit,dirty,files},null,2)+'\n');
console.log('Built self-contained browser worker bundle. No credentials or desktop runtime are included.');
