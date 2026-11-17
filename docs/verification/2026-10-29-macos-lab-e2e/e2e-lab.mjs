// Scratch end-to-end check (not committed): real CLI lab server with Docker grading,
// real desktop app driven by Playwright, no model inference and no paid calls.
// Usage: node dist/e2e/e2e-lab.mjs STATE_DIR LAB_ID JOIN_CODE
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const appRequire=createRequire(join(repo,'packages/app/package.json'));
const {_electron}=appRequire('playwright');
const keytar=createRequire(join(repo,'packages/app/extensions/core/package.json'))('keytar');
const [state,lab,code]=process.argv.slice(2);assert.ok(state&&lab&&code,'STATE_DIR LAB_ID JOIN_CODE');
const output=join(repo,'dist/e2e-lab-verification');mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(output,'session-')),account='e2e-lab-'+randomUUID(),errors=[],steps=[];
const log=(m,extra)=>{const e={t:new Date().toISOString(),step:m,...(extra?{detail:extra}:{})};steps.push(e);console.log(JSON.stringify(e));};
const instructor=(...args)=>{const out=execFileSync('pnpm',['-s','factoryze','lab',...args,'--data',state],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']});return out.trim();};
const shot=name=>page.screenshot({path:join(output,name)});
let app,page,diagnostics='';

const launch=async()=>{
 const env={...process.env,THEIA_CONFIG_DIR:join(root,'theia'),FACTORYZE_DATA_DIR:join(root,'engine'),FACTORYZE_CREDENTIAL_ACCOUNT:account,
  FACTORYZE_PRACTICE_SESSIONS_DIR:join(root,'practice'),FACTORYZE_LAB_SESSIONS_DIR:join(root,'labs'),FACTORYZE_PRACTICE_TASKS_DIR:join(repo,'tasks/practice')};
 for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||key.startsWith('FACTORYZE_PROVIDER_')||key.startsWith('FACTORYZE_LAB_')&&key!=='FACTORYZE_LAB_SESSIONS_DIR'||['FACTORYZE_MODEL','FACTORYZE_MODEL_API','FACTORYZE_JUDGE_ENABLED','FACTORYZE_SCORING_ENABLED'].includes(key))delete env[key];
 const executablePath=resolve(repo,'packages/app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
 const entry=join(root,'development-entry.cjs');writeFileSync(entry,`require('electron').app.setAppPath(${JSON.stringify(join(repo,'packages/app'))});process.argv.splice(1,1);require(${JSON.stringify(join(repo,'packages/app/lib/backend/electron-main.js'))});`);
 app=await _electron.launch({executablePath,args:[entry,`--user-data-dir=${join(root,'electron')}`,`--electronUserData=${join(root,'electron')}`,'--no-sandbox'],env,timeout:120000});
 for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',b=>{diagnostics=(diagnostics+String(b)).slice(-150000);});
 const watched=new Set();page=undefined;const started=Date.now();
 while(!page&&Date.now()-started<120000){for(const candidate of app.windows()){
  if(candidate.isClosed())continue;if(!watched.has(candidate)){watched.add(candidate);candidate.on('pageerror',e=>errors.push(e.message));}
  if(await candidate.locator('.factoryze-metrics').count().catch(()=>0)){page=candidate;break;}
 }if(!page)await new Promise(r=>setTimeout(r,200));}
 assert.ok(page,'Home became ready');page.setDefaultTimeout(60000);await page.locator('.theia-preload').waitFor({state:'hidden'});
 const win=await app.browserWindow(page);await win.evaluate(async w=>{if(w.isMaximized())await new Promise(r=>{w.once('unmaximize',r);w.unmaximize();});w.setContentSize(1100,800);});
};
const find=(dir,name)=>{for(const entry of readdirSync(dir)){const p=join(dir,entry);const s=statSync(p);if(s.isDirectory()&&!['.venv','__pycache__'].includes(entry)){const r=find(p,name);if(r)return r;}else if(entry===name&&p.endsWith(join('library',name)))return p;}};
const submit=async n=>{
 await page.locator('.fz-tb-attempt').getByRole('button',{name:'Submit',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Submit',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Lab submission saved',exact:true});await dialog.waitFor({timeout:120000});await dialog.getByText(`Submission ${n} is saved on the lab server.`,{exact:true}).waitFor();
 await shot(`submission-${n}.png`);await dialog.getByRole('button',{name:'Back to attempt',exact:true}).click();
};
const waitGraded=async count=>{for(let i=0;i<180;i++){const g=JSON.parse(instructor('grades',lab));const jobs=g.submissions;
 if(jobs.length>=count&&jobs.every(j=>j.state==='graded'||j.state==='failed'))return g;await new Promise(r=>setTimeout(r,1000));}
 return JSON.parse(instructor('grades',lab));};
const result={passed:false,platform:process.platform,realCliServer:true,dockerGrading:true,inference:false,paidModelCalls:0,realEmailsSent:0};
try{
 const before=readFileSync(join(repo,'tasks/practice/library-fines/workspace/library/returns.py'),'utf8');
 const fixed=before.replace('from .calendar import open_days_between','from .calendar import open_days_between\nfrom .clock import local_day').replace('returned_on = returned_at.date()','returned_on = local_day(returned_at, branch)');
 assert.notEqual(before,fixed,'reference fix applies');
 await launch();log('Home ready');
 await page.getByRole('button',{name:'Join a lab',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Join a lab',exact:true});
 await dialog.getByLabel('Lab configuration',{exact:true}).setInputFiles(join(state,'client.json'));await dialog.getByRole('status').getByText(/Server:/).waitFor();
 await dialog.getByLabel('Lab ID',{exact:true}).fill(lab);await dialog.getByLabel('Student ID',{exact:true}).fill('s001');await dialog.getByLabel('Join code or recovery token',{exact:true}).fill(code);
 await shot('join.png');await dialog.getByRole('button',{name:'Join lab',exact:true}).click();
 await Promise.race([page.locator('.fz-tb-attempt').waitFor({timeout:240000}),dialog.getByRole('alert').filter({hasText:/\S/}).waitFor({timeout:240000}).then(async()=>{throw Error(await dialog.getByRole('alert').innerText());})]);
 log('Lab joined and Python prepared');
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Settings',exact:true}).click();dialog=page.getByRole('dialog',{name:'Lab connection',exact:true});await dialog.waitFor();
 result.labSettingsText=(await dialog.innerText()).replace(/\s+/g,' ').slice(0,600);await shot('lab-settings.png');await dialog.getByRole('button',{name:'Close',exact:true}).last().click();
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Run tests',exact:true}).click();await page.getByText(/5 of 5|5\/5|5 passed/).first().waitFor({timeout:120000});log('Public tests pass on starter');
 await submit(1);log('Submission 1 (unchanged starter) saved');
 const target=find(join(root,'labs'),'returns.py');assert.ok(target,'student workspace located');writeFileSync(target,fixed);log('Student fix written to workspace',{file:target.slice(root.length)});
 await new Promise(r=>setTimeout(r,4000));
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Run tests',exact:true}).click();await page.getByText(/5 of 5|5\/5|5 passed/).first().waitFor({timeout:120000});
 await submit(2);log('Submission 2 (fixed) saved');
 result.gradesBeforeClose=await waitGraded(2);log('Graded before close',{states:result.gradesBeforeClose.submissions.map(s=>s.state)});
 result.close=JSON.parse(instructor('close',lab));log('Lab closed');
 await new Promise(r=>setTimeout(r,3000));result.gradesAfterClose=await waitGraded(2);log('Grades after close',{states:result.gradesAfterClose.submissions.map(s=>s.state)});
 result.release=JSON.parse(instructor('release',lab));log('Released');
 const csvPath=join(output,`results-${Date.now()}.csv`);instructor('export',lab,'--out',csvPath);result.csv=readFileSync(csvPath,'utf8');log('CSV exported');
 await page.locator('.factoryze-metrics').getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Refresh lab results',exact:true}).click();
 await page.getByRole('row',{name:/Open the report for Library fines/}).first().waitFor();await shot('home-results.png');
 result.practiceTaskStates=await page.locator('.fz-state').allInnerTexts();
 result.resultRows=(await page.getByRole('row',{name:/Open the report for Library fines/}).allInnerTexts()).map(t=>t.replace(/\s+/g,' '));
 await page.getByRole('row',{name:/Open the report for Library fines/}).first().click();await page.getByText(/released by your instructor/).waitFor();
 await shot('released-report.png');result.reportText=(await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0,2500);
 const all=page.getByRole('button',{name:/View all \d+ checks/});if(await all.count()){await all.first().click();const d=page.getByRole('dialog',{name:'Hidden-check details'});await d.waitFor();result.checkDetails=(await d.innerText()).replace(/\s+/g,' ').slice(0,2500);await shot('check-details.png');await page.getByRole('button',{name:'Close details',exact:true}).click();}
 result.pageErrors=errors;result.passed=true;log('Done');
}catch(error){result.error=String(error.stack??error);writeFileSync(join(output,'diagnostics.log'),diagnostics);await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});
 if(page)writeFileSync(join(output,'failure.txt'),await page.locator('body').innerText().catch(()=>''));process.exitCode=1;
}finally{
 result.steps=steps;writeFileSync(join(output,'e2e-result.json'),JSON.stringify(result,null,2)+'\n');
 await app?.close().catch(()=>{});
 const clientDirectory=join(root,'engine','lab-client',createHash('sha256').update(account).digest('hex').slice(0,16));
 if(existsSync(clientDirectory))for(const name of readdirSync(clientDirectory))if(/^(?:[a-f0-9-]{36}|join-[a-f0-9]{64})\.json$/.test(name)){
  const id=JSON.parse(readFileSync(join(clientDirectory,name),'utf8')).id;await keytar.deletePassword('Factoryze Lab Sessions',`${account}:${id}`).catch(()=>{});}
}
