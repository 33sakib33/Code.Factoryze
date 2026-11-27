import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron,request} from 'playwright';

// Only run against the explicit TLS-SMTP/synthetic-model fixture. Never sends real email or buys inference.
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=process.env.TRIAL_TEST_URL||'http://127.0.0.1:8093';
const mailbox=process.env.TEST_MAILBOX_TOKEN;
assert.ok(mailbox&&mailbox.length>=32,'Set the private verification inbox token.');
assert.equal(new URL(base).hostname,'127.0.0.1','The fixture must be on loopback.');
const output=resolve(repo,'dist/desktop-trial-verification');mkdirSync(output,{recursive:true});
const id=randomUUID(),root=join(output,'session-'+id),account='trial-smoke-'+id;mkdirSync(root,{recursive:true});
const email=process.env.TRIAL_TEST_EMAIL||'desktop-ui@example.test';
const api=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:'http://127.0.0.1:4321','X-Factoryze-Request':'1'}});
const status=await (await api.get('/api/trial/status')).json();assert.equal(status.verificationOnly,true,'Refusing to use a real email or inference service.');
const inbox=async(address,purpose='admin')=>{
 for(let i=0;i<100;i++){const res=await api.get(`/__verification/mailbox?purpose=${purpose}&email=${encodeURIComponent(address)}`,{headers:{Authorization:`Bearer ${mailbox}`}});if(res.status()===200)return (await res.json()).code;await new Promise(r=>setTimeout(r,100));}
 throw Error('Local SMTP message did not arrive.');
};
let app,page;let diagnostics='';const errors=[];
const keytar=createRequire(resolve(repo,'packages/app/extensions/core/package.json'))('keytar');
const launch=async()=>{
 const env={...process.env,THEIA_CONFIG_DIR:join(root,'theia'),FACTORYZE_DATA_DIR:join(root,'engine'),FACTORYZE_CREDENTIAL_ACCOUNT:account,FACTORYZE_PRACTICE_SESSIONS_DIR:join(root,'workspaces'),FACTORYZE_TRIAL_URL:base};
 for(const key of Object.keys(env))if(key==='ELECTRON_RUN_AS_NODE'||key.startsWith('FACTORYZE_PROVIDER_')||['FACTORYZE_MODEL','FACTORYZE_MODEL_API','FACTORYZE_JUDGE_ENABLED','FACTORYZE_SCORING_ENABLED','FACTORYZE_PRACTICE_TASKS_DIR'].includes(key))delete env[key];
 env.FACTORYZE_PRACTICE_TASKS_DIR=join(repo,'tasks/practice');
 const installed=process.env.FACTORYZE_SMOKE_EXECUTABLE;
 const executablePath=installed||resolve(repo,'packages/app/node_modules/electron/dist',process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron');
 const entry=join(root,'development-entry.cjs');
 if(!installed)writeFileSync(entry,`require('electron').app.setAppPath(${JSON.stringify(join(repo,'packages/app'))});process.argv.splice(1,1);require(${JSON.stringify(join(repo,'packages/app/lib/backend/electron-main.js'))});`);
 app=await _electron.launch({executablePath,args:[...(!installed?[entry]:[]),`--user-data-dir=${join(root,'electron')}`,`--electronUserData=${join(root,'electron')}`,'--no-sandbox'],env,timeout:120000});
 app.process().stdout?.on('data',b=>{diagnostics=(diagnostics+String(b)).slice(-150000);});app.process().stderr?.on('data',b=>{diagnostics=(diagnostics+String(b)).slice(-150000);});
 const watched=new Set();const started=Date.now();page=undefined;
 while(!page&&Date.now()-started<120000){
  for(const candidate of app.windows()){
   if(candidate.isClosed())continue;
   if(!watched.has(candidate)){watched.add(candidate);candidate.on('pageerror',e=>errors.push(e.message));candidate.on('console',m=>{if(m.type()==='error')diagnostics+='Renderer '+m.text()+'\n';});}
   if(await candidate.locator('.factoryze-metrics').count().catch(()=>0)){page=candidate;break;}
  }
  if(!page)await new Promise(r=>setTimeout(r,200));
 }
 if(!page){for(const [i,w]of app.windows().entries()){if(!w.isClosed()){writeFileSync(join(output,`startup-window-${i}.txt`),w.url()+'\n'+await w.locator('body').innerText().catch(()=>''));await w.screenshot({path:join(output,`startup-window-${i}.png`)}).catch(()=>{});}}throw Error('Factoryze Home did not become ready.');}
 page.setDefaultTimeout(45000);await page.locator('.theia-preload').waitFor({state:'hidden'});
 const win=await app.browserWindow(page);await win.evaluate(async w=>{if(w.isMaximized())await new Promise(r=>{w.once('unmaximize',r);w.unmaximize();});w.setContentSize(683,512);});
 await page.waitForFunction(()=>innerWidth===683&&innerHeight===512);return page;
};
// Trial preferences live in a private file; the sign-in itself stays in the system credential store.
const savedPreferences=()=>{const folder=join(root,'engine','trial-connection'),files=readdirSync(folder).filter(name=>name.endsWith('.json'));assert.equal(files.length,1);const raw=readFileSync(join(folder,files[0]),'utf8');
 assert.ok(!/[A-Za-z0-9_-]{43}/.test(raw),'preferences must not hold a sign-in');assert.ok(!raw.includes(email),'preferences must not hold the email address');return JSON.parse(raw);};
const openSettings=async()=>{await page.locator('.factoryze-metrics').getByRole('button',{name:'Settings',exact:true}).click();await page.locator('.fz-settings h1').waitFor();};
try{
 let res=await api.post('/api/admin/auth/request-otp',{data:{email:'operations@example.test'}});assert.equal(res.status(),202);
 const adminCode=await inbox('operations@example.test');res=await api.post('/api/admin/auth/verify-otp',{data:{email:'operations@example.test',code:adminCode}});assert.equal(res.status(),200);
 // An older release kept everything in one keychain entry, and macOS gives an unsigned build's entry only to that exact build.
 // This entry belongs to another program, so reading it would stop on a system dialog and this run would time out. The app must never read it.
 if(process.platform==='darwin')execFileSync('security',['add-generic-password','-s','Factoryze Trial Account','-a',account+':trial','-w',JSON.stringify({schema:'trial-connection@1',origin:base,selected:true,model:'fixture-coder'}),'-T','/usr/bin/security']);
 await launch();await openSettings();await page.getByRole('button',{name:'Connect a model',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Connect a model',exact:true});
 // Save a BYOK connection first; it must survive trial sign-in, restart and sign-out.
 await dialog.getByLabel('Base URL',{exact:true}).fill(base+'/v1');await dialog.getByLabel('API key',{exact:true}).fill('synthetic-preserved-byok');await dialog.getByLabel('Model ID',{exact:true}).fill('byok-preserved');await dialog.getByRole('button',{name:'Save connection',exact:true}).click();await dialog.waitFor({state:'detached'});
 await page.locator('.fz-settings').getByRole('button',{name:'Change',exact:true}).click();dialog=page.getByRole('dialog',{name:'Connect a model',exact:true});await dialog.getByRole('radio',{name:'Trial credits',exact:true}).click();
 await dialog.getByLabel('Email address',{exact:true}).fill(email);await page.screenshot({path:join(output,'electron-trial-signin.png')});await dialog.getByRole('button',{name:'Send sign-in code',exact:true}).click();
 const code=await inbox(email,'desktop');await dialog.getByLabel('6-digit sign-in code').fill(code==='000000'?'000001':'000000');await dialog.getByRole('button',{name:'Verify and continue'}).click();await dialog.getByRole('alert').filter({hasText:/incorrect|expired/}).waitFor();
 await dialog.getByLabel('6-digit sign-in code').fill(code);await dialog.getByRole('button',{name:'Verify and continue'}).click();
 // No code beyond the sign-in code: the account asks for credit, the owner approves it, and the open dialog picks it up.
 await dialog.getByText('No credit yet',{exact:true}).waitFor();assert.equal(await dialog.getByText(/invitation/i).count(),0);
 // The footer is the one next step, and nothing is offered that cannot be pressed.
 const footer=async expected=>{assert.deepEqual(await dialog.locator('.fz-dialog-foot button').allInnerTexts(),expected);assert.equal(await dialog.locator('button:disabled').count(),0);};
 await footer(['Close','Request credit']);await dialog.getByRole('button',{name:'Request credit',exact:true}).click();await dialog.getByText('Waiting for approval',{exact:true}).waitFor();await footer(['Check again','Close']);await page.screenshot({path:join(output,'electron-trial-waiting.png')});
 res=await api.get('/api/admin/gateway/creditRequests');assert.equal(res.status(),200);const asked=(await res.json()).items.find(item=>item.email===email);assert.ok(asked,'the request must reach the owner');
 res=await api.post(`/api/admin/gateway/accounts/${encodeURIComponent(asked.id)}`,{data:{action:'grant',creditMicro:1000000,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'Local desktop trial integration verification'}});assert.equal(res.status(),200);
 await dialog.getByRole('button',{name:'Check again',exact:true}).click();await dialog.getByText('Credit ready',{exact:true}).waitFor();await dialog.getByText('$1.00',{exact:true}).waitFor();await footer(['Cancel','Use trial credits']);await page.screenshot({path:join(output,'electron-trial-account.png')});
 await dialog.getByLabel('Trial model',{exact:true}).selectOption('fixture-coder');await dialog.getByRole('button',{name:'Use trial credits',exact:true}).click();await dialog.waitFor({state:'detached'});await page.locator('.fz-settings').getByRole('heading',{name:'Factoryze trial credits',exact:true}).waitFor();
 let preferences=savedPreferences();assert.equal(preferences.schema,'trial-connection@2');assert.equal(preferences.selected,true);assert.equal(preferences.model,'fixture-coder');assert.ok(Date.parse(preferences.expiresAt)>Date.now());
 await page.locator('.fz-settings').getByRole('button',{name:'Back',exact:true}).click();await page.locator('.fz-home').getByRole('button',{name:'Start Library fines',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.fz-check.fz-ok').waitFor({timeout:60000});await dialog.getByText(/Trial credits · fixture-coder/).waitFor();await dialog.getByRole('button',{name:'Start attempt',exact:true}).click();
 const prompt=page.getByRole('textbox',{name:'Prompt for the agent'});await prompt.waitFor({timeout:90000});await prompt.fill('DESKTOP_TRIAL_PROBE: inspect library/returns.py, make the proposed small edit and run the public tests.');await page.locator('.fz-composer button[type=submit]').click();
 await page.locator('.fz-approval').getByRole('button',{name:'Approve',exact:true}).click({timeout:60000});
 await page.locator('.fz-approval').getByRole('button',{name:'Run',exact:true}).click({timeout:60000});
 await page.locator('.fz-turn.fz-live').waitFor({state:'detached',timeout:90000});await page.getByText('Trial gateway verified. Public tests ran locally.',{exact:false}).waitFor();
 assert.equal(await page.locator('.fz-turn .fz-error').count(),0);const meterText=await page.locator('.fz-budget-text').innerText();assert.ok(Number((meterText.match(/\d[\d,]*/)||[])[0]?.replaceAll(',',''))>0,'trial calls must update the local task meter');
 await page.screenshot({path:join(output,'electron-trial-attempt.png')});
 await page.locator('.fz-tb-attempt').getByRole('button',{name:'Submit',exact:true}).click();const submission=page.getByRole('dialog');await submission.getByRole('button',{name:'Submit',exact:true}).click();await submission.waitFor({state:'detached',timeout:150000});await page.getByRole('heading',{name:'Activity and token usage',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.fz-report-view')?.getBoundingClientRect().width>=600);assert.equal(await page.locator('.fz-prompts .fz-tag, .fz-report-advice').count(),0);await page.screenshot({path:join(output,'electron-trial-report.png')});
 await app.close();app=undefined;await launch();await openSettings();await page.locator('.fz-settings').getByRole('heading',{name:'Factoryze trial credits',exact:true}).waitFor();
 await page.locator('.fz-settings').getByRole('button',{name:'Manage trial account',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Sign out',exact:true}).click();await dialog.getByLabel('Email address',{exact:true}).waitFor();preferences=savedPreferences();assert.equal(preferences.expiresAt,undefined,'signing out forgets the saved sign-in');await dialog.getByRole('radio',{name:'My API key',exact:true}).click();await dialog.getByLabel('Model ID',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Model ID',{exact:true}).inputValue(),'byok-preserved');
 await dialog.getByRole('button',{name:'Save connection',exact:true}).click();await dialog.waitFor({state:'detached'});await page.locator('.fz-settings').getByRole('heading',{name:'byok-preserved',exact:true}).waitFor();
 await page.locator('.fz-settings').getByRole('button',{name:'Forget connection',exact:true}).click();
 const requests=await (await api.get('/api/admin/gateway/requests')).json();const native=requests.items.filter(x=>x.model.id==='fixture-coder');assert.ok(native.length>=4);assert.ok(native.every(x=>x.state==='finished'&&x.outcome==='completed'&&x.costKind==='measured'));
 const result={passed:true,platform:process.platform,viewport:{width:683,height:512},smtpLocalOnly:true,modelSynthetic:true,otpSignIn:true,wrongCodeRejected:true,creditRequestApproved:true,noInvitationCode:true,footerIsNextStep:true,trialModelSelection:true,localReadEditShell:true,approvals:2,usageMetered:true,reportSaved:true,restartRetainsTrial:true,preferencesHoldNoSecret:true,otherBuildKeychainEntryNeverRead:process.platform==='darwin',byokPreserved:true,signOut:true,adminGranted:false,modelRequests:native.length,realEmailsSent:0,paidModelCalls:0,pageErrors:errors};
 assert.deepEqual(errors,[]);writeFileSync(join(output,'electron-trial-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){writeFileSync(join(output,'electron-trial-diagnostics.log'),diagnostics);await page?.screenshot({path:join(output,'electron-trial-failure.png')}).catch(()=>{});writeFileSync(join(output,'electron-trial-result.json'),JSON.stringify({passed:false,error:error.message},null,2));throw error;}
finally{await app?.close().catch(()=>{});await api.dispose();await keytar.deletePassword('Factoryze Solo Provider',account).catch(()=>{});await keytar.deletePassword('Factoryze Trial Account',account+':trial').catch(()=>{});}
