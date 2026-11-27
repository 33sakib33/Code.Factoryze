import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {LabEngine} from '../../engine/src/lab.ts';
import {LabRuntime} from '../../engine/src/lab-runtime.ts';
import {initializeServer,loadIdentity} from '../../server/src/identity.ts';
import {createLabServer} from '../../server/src/server.ts';

// Native desktop, real TLS/SQLite/local hands, synthetic provider and explicit synthetic grading verdict.
// No live email, provider credentials, paid calls or server-side execution of student code.
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=resolve(repo,'dist/desktop-lab-verification');mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(output,'session-')),account='lab-ui-'+randomUUID(),errors=[];
const keytar=createRequire(resolve(repo,'packages/app/extensions/core/package.json'))('keytar');
const engine=new LabEngine(join(root,'state'),{taskRoot:join(repo,'tasks/practice')});
initializeServer(join(root,'identity'),'https://localhost:9443');const identity=loadIdentity(join(root,'identity'));
const before=readFileSync(join(repo,'tasks/practice/library-fines/workspace/library/returns.py'),'utf8');
const fixed=before.replace('from .calendar import open_days_between','from .calendar import open_days_between\nfrom .clock import local_day').replace('returned_on = returned_at.date()','returned_on = local_day(returned_at, branch)');
let calls=0,app,page,diagnostics='',completed=false;
// A keychain item created by Node can prompt when the signed macOS app reads it.
// Solo smoke covers macOS model credentials; preserve this cross-app check on Windows/Linux.
const byokPreseeded=process.platform!=='darwin';
const runtime=new LabRuntime(engine,{api:'openai-chat',providerHost:'synthetic.invalid',model:'lab-fixture',contextWindow:32768,maxOutputTokens:2048,provider:{async send(){
 const tool=[{name:'read',arguments:{filePath:'library/returns.py'}},{name:'write',arguments:{filePath:'library/returns.py',content:fixed}},
  {name:'shell',arguments:{command:'python -m unittest discover -s tests'}}][calls++];
 const delta=tool?{tool_calls:[{index:0,id:`lab-tool-${calls}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:'Lab fixture finished. Public checks ran locally.'};
 return{status:200,headers:{'content-type':'text/event-stream'},body:(async function*(){yield`data: ${JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})}\n\ndata: [DONE]\n\n`;})()};
}}});
const server=createLabServer(engine,identity,{runtime});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const config={...identity.connection,baseURL:`https://localhost:${server.address().port}`};const configPath=join(root,'client.json');writeFileSync(configPath,JSON.stringify(config));
const {code}=engine.create({schema:1,config:{schema:1,lab:'ui-pilot',task:'library-fines',timeLimitMinutes:60,agent:{profile:'factoryze@0.1.0',model:'lab-fixture',permissions:{edit:'ask',shell:'ask'}},budget:{limit:25000,weights:{input:1,output:1,cacheRead:.1,cacheWrite:1}}},providerHost:'synthetic.invalid',temperature:0,roster:['student-01']});
const launch=async()=>{
 const env={...process.env,THEIA_CONFIG_DIR:join(root,'theia'),FACTORYZE_DATA_DIR:join(root,'engine'),FACTORYZE_CREDENTIAL_ACCOUNT:account,
  FACTORYZE_PRACTICE_SESSIONS_DIR:join(root,'practice'),FACTORYZE_LAB_SESSIONS_DIR:join(root,'labs')};
 for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||key.startsWith('FACTORYZE_PROVIDER_')||key.startsWith('FACTORYZE_LAB_PROVIDER_')||['FACTORYZE_MODEL','FACTORYZE_MODEL_API','FACTORYZE_JUDGE_ENABLED','FACTORYZE_SCORING_ENABLED','FACTORYZE_LAB_INFERENCE'].includes(key))delete env[key];
 env.FACTORYZE_PRACTICE_TASKS_DIR=join(repo,'tasks/practice');
 const installed=process.env.FACTORYZE_SMOKE_EXECUTABLE;
 const executablePath=installed||resolve(repo,'packages/app/node_modules/electron/dist',process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron');
 const entry=join(root,'development-entry.cjs');if(!installed)writeFileSync(entry,`require('electron').app.setAppPath(${JSON.stringify(join(repo,'packages/app'))});process.argv.splice(1,1);require(${JSON.stringify(join(repo,'packages/app/lib/backend/electron-main.js'))});`);
 app=await _electron.launch({executablePath,args:[...(!installed?[entry]:[]),`--user-data-dir=${join(root,'electron')}`,`--electronUserData=${join(root,'electron')}`,'--no-sandbox'],env,timeout:120000});
 for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',b=>{diagnostics=(diagnostics+String(b)).slice(-150000);});
 const watched=new Set();page=undefined;const started=Date.now();
 while(!page&&Date.now()-started<120000){for(const candidate of app.windows()){
  if(candidate.isClosed())continue;if(!watched.has(candidate)){watched.add(candidate);candidate.on('pageerror',e=>errors.push(e.message));}
  if(await candidate.locator('.factoryze-metrics').count().catch(()=>0)){page=candidate;break;}
 }if(!page)await new Promise(r=>setTimeout(r,200));}
 assert.ok(page,'Home became ready');page.setDefaultTimeout(60000);await page.locator('.theia-preload').waitFor({state:'hidden'});
 const win=await app.browserWindow(page);await win.evaluate(async w=>{if(w.isMaximized())await new Promise(r=>{w.once('unmaximize',r);w.unmaximize();});w.setContentSize(900,700);});
};
const clientDirectory=join(root,'engine','lab-client',createHash('sha256').update(account).digest('hex').slice(0,16));
try{
 if(byokPreseeded)await keytar.setPassword('Factoryze Solo Provider',account,'preserved-lab-test-key');
 await launch();console.log('Home ready');
 // A window too narrow for Home's two columns keeps the lab behind the "Your progress" tab.
 {const tab=page.locator('.fz-home-tab',{hasText:'Your progress'});if(await tab.isVisible())await tab.click();}
 await page.getByRole('button',{name:'Join a lab',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Join a lab',exact:true});
 await dialog.getByLabel('Lab configuration',{exact:true}).setInputFiles(configPath);await dialog.getByRole('status').getByText(/Server:/).waitFor();
 await dialog.getByLabel('Lab ID',{exact:true}).fill('ui-pilot');await dialog.getByLabel('Student ID',{exact:true}).fill('student-01');await dialog.getByLabel('Join code or recovery token',{exact:true}).fill(code);
 await page.screenshot({path:join(output,'join.png')});await dialog.getByRole('button',{name:'Join lab',exact:true}).click();
 const prompt=page.getByRole('textbox',{name:'Prompt for the agent'});await Promise.race([prompt.waitFor({timeout:180000}),dialog.getByRole('alert').filter({hasText:/\S/}).waitFor({timeout:180000}).then(async()=>{throw Error(await dialog.getByRole('alert').innerText());})]);console.log('Lab joined and Python prepared');
 await prompt.fill('Inspect returns.py, use branch-local dates, and run public tests.');await page.locator('.fz-composer button[type=submit]').click();
 await page.locator('.fz-approval').getByRole('button',{name:'Approve',exact:true}).click();await page.locator('.fz-approval').getByRole('button',{name:'Run',exact:true}).click();
 await page.locator('.fz-turn.fz-live').waitFor({state:'detached',timeout:90000});await page.getByText('Lab fixture finished. Public checks ran locally.',{exact:false}).waitFor();
 assert.equal(await page.locator('.fz-turn .fz-error').count(),0);assert.equal(calls,4);assert.match(await page.locator('.fz-budget-text').innerText(),/48/);console.log('Approved local tools and metering passed');
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Run tests',exact:true}).click();await page.getByText(/5 of 5|5\/5|5 passed/).first().waitFor();
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Settings',exact:true}).click();dialog=page.getByRole('dialog',{name:'Lab connection',exact:true});await dialog.getByText('lab-fixture',{exact:true}).waitFor();
 assert.equal(await dialog.getByRole('textbox').count(),0);await dialog.getByText('Server grading is not enabled.',{exact:false}).waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).last().click();
 await page.screenshot({path:join(output,'attempt.png')});await page.locator('.fz-tb-attempt').getByRole('button',{name:'Submit',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Submit',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Lab submission saved',exact:true});await dialog.waitFor();await dialog.getByText('Submission 1 is saved on the lab server.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Back to attempt',exact:true}).click();
 assert.equal(engine.overview('ui-pilot').students[0].usage.weighted,48);if(byokPreseeded)assert.equal(await keytar.getPassword('Factoryze Solo Provider',account),'preserved-lab-test-key');console.log('Submission saved; restarting');
 await app.close();app=undefined;await launch();await page.locator('.fz-home').waitFor();assert.equal(await page.locator('.fz-composer:visible').count(),0);
 await page.getByRole('button',{name:/Continue Library fines/}).click();await page.getByRole('textbox',{name:'Prompt for the agent'}).waitFor();assert.equal(calls,4);
 // Explicit fixture verdict tests release/rendering only. It never executes the private tests.
 await runtime.stopStudent('ui-pilot');engine.closeLab('ui-pilot');await engine.gradeQueued(async()=>({passed:9,total:9,checks:Array.from({length:9},(_,i)=>({name:`Synthetic fixture check ${i+1}`,passed:true}))}));engine.release('ui-pilot');
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Home',exact:true}).click();{const tab=page.locator('.fz-home-tab',{hasText:'Your progress'});await page.locator('.fz-home').waitFor();if(await tab.isVisible())await tab.click();}await page.getByRole('button',{name:'Refresh lab results',exact:true}).click();
 await page.getByRole('row',{name:/Open the report for Library fines/}).first().click();await page.getByText(/released by your instructor/).waitFor();await page.getByRole('heading',{name:'Activity and token usage',exact:true}).waitFor();
 assert.equal(await page.locator('.fz-prompts .fz-tag, .fz-report-advice').count(),0);assert.equal(await page.getByRole('button',{name:'New attempt',exact:true}).count(),0);await page.screenshot({path:join(output,'released-report.png')});
 await page.getByRole('button',{name:'View all 9 checks',exact:true}).click();await page.getByRole('dialog',{name:'Hidden-check details'}).getByText('Synthetic fixture check 9',{exact:true}).waitFor();await page.getByRole('button',{name:'Close details',exact:true}).click();
 assert.deepEqual(errors,[]);completed=true;
 const result={passed:true,platform:process.platform,installed:!!process.env.FACTORYZE_SMOKE_EXECUTABLE,viewport:{width:900,height:700},pinnedTLS:true,joinLab:true,pythonPrepared:true,serverBrainLocalHands:true,
  modelRequests:calls,approvals:2,weightedTokens:48,publicChecks:5,submissionSaved:true,restartToHome:true,sessionResumed:true,readonlyLabSettings:true,byokPreserved:byokPreseeded?true:null,instructorReleaseRendered:true,
  gradingVerdictSynthetic:true,checkDetailsModal:true,serverStudentCodeExecutions:0,suggestionsAndPromptScoresAbsent:true,paidModelCalls:0,realEmailsSent:0,pageErrors:errors};
 writeFileSync(join(output,'electron-lab-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){writeFileSync(join(output,'diagnostics.log'),diagnostics);await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});
 if(page)writeFileSync(join(output,'failure.txt'),await page.locator('body').innerText().catch(()=>''));writeFileSync(join(output,'electron-lab-result.json'),JSON.stringify({passed:false,error:String(error.message)},null,2));throw error;
}finally{
 await app?.close().catch(()=>{});await server.disposeLab();server.closeAllConnections();await new Promise(r=>server.close(r));engine.close();
 if(existsSync(clientDirectory)){for(const name of readdirSync(clientDirectory))if(/^(?:[a-f0-9-]{36}|join-[a-f0-9]{64})\.json$/.test(name)){
  const id=JSON.parse(readFileSync(join(clientDirectory,name),'utf8')).id;await keytar.deletePassword('Factoryze Lab Sessions',`${account}:${id}`);}}
 if(byokPreseeded)await keytar.deletePassword('Factoryze Solo Provider',account);
 if(completed){const scoped=relative(output,root);assert.ok(scoped&&!scoped.startsWith('..')&&!isAbsolute(scoped));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
