import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(repo,'dist/desktop-trial-verification');await mkdir(out,{recursive:true});
const require=createRequire(resolve(repo,'packages/app/package.json'));const {build}=require('esbuild');
const bundle=await build({stdin:{contents:`
import {trialConnectionDialog} from './packages/app/extensions/core/src/browser/trial-dialog';
let signedIn=false,claimed=false,requested=false;window.approve=()=>{claimed=true;requested=false;};let view=()=>({origin:'https://trial.example',signedIn,selected:false,selectedModel:'trial-coder',creditRequested:requested,account:signedIn?{id:'email:test',email:'tester@example.test',claimed,suspended:false,grantedMicro:claimed?1000000:0,spentMicro:0,reservedMicro:0,availableMicro:claimed?1000000:0,dailyLimitMicro:50000,dailySpentMicro:10000,dailyReservedMicro:0,dailyAvailableMicro:40000,dailyResetAt:'2099-01-02T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'}:undefined,models:[{id:'trial-coder',maxInputTokens:32768,maxOutputTokens:1024,outputParameter:'max_tokens'}],programEnabled:true,inferenceEnabled:true,maxRequestBytes:65536,maxMessages:128,maxTools:32});
const service={trialAccount:async()=>{if(window.failAccount)throw Error('The trial service is unavailable.');return view();},trialRequestCode:async()=>{},trialVerifyCode:async(code)=>{if(code!=='123456')throw Error('The code is incorrect or expired.');signedIn=true;return view();},trialRequestCredit:async()=>{requested=true;return view();},trialSelect:async()=>({schema:1,model:'trial-coder'}),trialSignOut:async()=>{signedIn=false;}};
window.openTrial=()=>trialConnectionDialog(service,()=>{window.byokSelected=true;},()=>{window.trialSelected=true;});
document.querySelector('button').addEventListener('click',()=>window.openTrial());
`,resolveDir:repo,loader:'ts'},bundle:true,write:false,format:'iife',target:'es2022'});
const css=await readFile(resolve(repo,'packages/app/extensions/core/src/browser/style/factoryze.css'),'utf8');
const coreRequire=createRequire(resolve(repo,'packages/app/extensions/core/package.json'));
const fonts=await Promise.all([400,600,700].map(async weight=>`@font-face{font-family:'Atkinson Hyperlegible Next';font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(coreRequire.resolve(`@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-${weight}-normal.woff2`))).toString('base64')})}`));
const html=`<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Factoryze trial dialog verification</title><style>${fonts.join('')}${css}*{box-sizing:border-box}body{font:14px/1.5 var(--fz-ui);background:var(--fz-page);color:var(--fz-text)}button{font:inherit}</style></head><body><main><h1>Factoryze</h1><button class="fz-btn">Connect a model</button></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const file=resolve(out,'trial-dialog.html');await writeFile(file,html);
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [width,height,dark]of [[1280,800,false],[683,512,false],[390,720,false],[683,512,true]]){
  await page.setViewportSize({width,height});await page.goto(pathToFileURL(file).href);if(dark)await page.evaluate(()=>document.body.classList.add('theia-dark'));
  await page.getByRole('button',{name:'Connect a model',exact:true}).click();await page.getByLabel('Email address',{exact:true}).fill('tester@example.test');await page.screenshot({path:resolve(out,`trial-signin-${width}-${dark?'dark':'light'}.png`)});
  await page.getByRole('button',{name:'Send sign-in code',exact:true}).click();assert.equal(await page.getByRole('button',{name:/Send a new code/}).isDisabled(),true);await page.getByLabel('6-digit sign-in code').fill('000000');await page.getByRole('button',{name:'Verify and continue'}).click();await page.getByText('The code is incorrect or expired.').waitFor();
  await page.getByLabel('6-digit sign-in code').fill('123456');await page.getByRole('button',{name:'Verify and continue'}).click();await page.getByText('No credit yet',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Use trial credits',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('dialog').getByText(/invitation/i).count(),0,'no invitation code is ever asked for');
  {const dialogBox=await page.getByRole('dialog').boundingBox(),requestBox=await page.getByRole('button',{name:'Request credit',exact:true}).boundingBox();assert.ok(dialogBox&&requestBox&&requestBox.y+requestBox.height<=dialogBox.y+dialogBox.height&&requestBox.y>=dialogBox.y,'the one next step must be visible without scrolling');}
  await page.screenshot({path:resolve(out,`trial-no-credit-${width}-${dark?'dark':'light'}.png`)});
  await page.getByRole('button',{name:'Request credit',exact:true}).click();await page.getByText('Waiting for approval',{exact:true}).waitFor();await page.getByText('Request sent. The project owner will review it.').waitFor();assert.equal(await page.getByRole('button',{name:'Request credit',exact:true}).count(),0);
  await page.screenshot({path:resolve(out,`trial-waiting-${width}-${dark?'dark':'light'}.png`)});
  await page.getByRole('button',{name:'Check again',exact:true}).click();await page.getByText('Not approved yet.').waitFor();await page.evaluate(()=>window.approve());await page.getByRole('button',{name:'Check again',exact:true}).click();await page.getByText('Credit ready',{exact:true}).waitFor();await page.getByText('$1.00',{exact:true}).waitFor();await page.getByText('$0.04',{exact:true}).waitFor();
  await page.screenshot({path:resolve(out,`trial-account-${width}-${dark?'dark':'light'}.png`)});
  const box=await page.getByRole('dialog').boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'dialog must fit viewport');
  await page.getByRole('button',{name:'Use trial credits',exact:true}).click();assert.equal(await page.evaluate(()=>window.trialSelected),true);
  await page.getByRole('button',{name:'Connect a model',exact:true}).click();await page.getByRole('radio',{name:'My API key',exact:true}).click();assert.equal(await page.evaluate(()=>window.byokSelected),true);
 }
 await page.goto(pathToFileURL(file).href);await page.evaluate(()=>{window.failAccount=true;});await page.getByRole('button',{name:'Connect a model',exact:true}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await page.getByRole('radio',{name:'My API key'}).isEnabled(),true);await page.evaluate(()=>{window.failAccount=false;});await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByLabel('Email address',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('button',{name:'Connect a model',exact:true}).evaluate(b=>b===document.activeElement),true);
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'dialog-checks.json'),JSON.stringify({passed:true,widths:[1280,683,390],themes:['light','dark'],signup:true,invalidCode:true,resendCooldown:true,requestCredit:true,approvalAppears:true,noInvitationCode:true,dailyAllowance:true,modelSelection:true,byokChoice:true,offlineRecovery:true,escapeAndFocusReturn:true,dialogFits:true,pageErrors:errors},null,2));console.log('Trial dialog checks passed at desktop, compact and phone widths in light/dark.');
}finally{await browser.close();}
