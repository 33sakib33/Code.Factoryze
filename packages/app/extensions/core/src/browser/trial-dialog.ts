import type { ModelSettingsView, TrialAccountView } from '@factoryze/protocol';
import type { TaskService } from '../common/task-service';
import { button, el, errorText, modal } from './dom';
import { trialCreditState } from './trial-credit';

export function connectionTabs(selected:'byok'|'trial',change:(mode:'byok'|'trial')=>void):HTMLElement {
 const tabs=el('div',{class:'fz-segmented fz-connection-tabs',role:'radiogroup',aria:{label:'Model connection'}});
 for(const [mode,label]of [['byok','My API key'],['trial','Trial credits']] as const){const b=button(label,()=>{if(mode!==selected)change(mode);});b.setAttribute('role','radio');b.setAttribute('aria-checked',String(selected===mode));tabs.append(b);}
 return tabs;
}
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(value/1000000);
const field=(label:string,control:HTMLElement)=>{control.setAttribute('aria-label',label);return el('label',{class:'fz-field'},el('span',{text:label}),control);};
const input=(type='text')=>el('input',{class:'fz-input',type});
export function trialConnectionDialog(service:TaskService,byok:()=>void,saved:(view:ModelSettingsView)=>void):void {
 const m=modal('Connect a model',{wide:true});
 const content=el('div',{class:'fz-trial-content'}),error=el('p',{class:'fz-error',role:'alert'}),status=el('p',{class:'fz-status',role:'status'});
 const tabs=connectionTabs('trial',()=>{m.close();byok();});m.body.append(tabs,content,status,error);
 let view:TrialAccountView|undefined,busy=false,closed=false,email='',codeStep=false,resendAt=0;
 let resend:HTMLButtonElement|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 // Approval can arrive while this dialog is open: look again whenever the window regains focus.
 const refocus=()=>{if(view?.signedIn&&!trialCreditState(view).canUse)void run(async()=>{view=await service.trialAccount();render();});};
 window.addEventListener('focus',refocus);
 void m.closed.then(()=>{closed=true;clearTimeout(timer);window.removeEventListener('focus',refocus);content.querySelectorAll('input').forEach(i=>i.value='');});
 async function run(action:()=>Promise<void>){if(busy||closed)return;busy=true;error.textContent='';status.textContent='';m.dialog.setAttribute('aria-busy','true');
  for(const b of Array.from(m.dialog.querySelectorAll<HTMLButtonElement>('button')))b.disabled=true;
  try{await action();}catch(e){if(!closed){error.textContent=errorText(e);if(!view)content.replaceChildren(el('p',{class:'fz-help',text:'Your trial account could not be reached. You can try again or use your own API key.'}),button('Try again',()=>void run(async()=>{view=await service.trialAccount();render();}),{small:true}));}}
  finally{busy=false;m.dialog.removeAttribute('aria-busy');if(!closed){for(const b of Array.from(m.dialog.querySelectorAll<HTMLButtonElement>('button')))b.disabled=b.dataset.unavailable==='true';countdown();}}
 }
 function countdown(){clearTimeout(timer);if(!resend||closed)return;const remaining=Math.max(0,Math.ceil((resendAt-Date.now())/1000));resend.disabled=busy||remaining>0;resend.textContent=remaining?`Send a new code (${remaining}s)`:'Send a new code';if(remaining)timer=setTimeout(countdown,1000);}
 function footer(primary?:HTMLButtonElement){m.foot.replaceChildren(button('Cancel',()=>m.close()),...(primary?[primary]:[]));}
 function render(){if(closed)return;resend=undefined;
  if(!view?.signedIn){
   const form=el('form'),control=input(codeStep?'text':'email');control.required=true;
   const title=el('h3',{text:codeStep?'Check your email':'Sign in to Factoryze'});
   const intro=el('p',{class:'fz-lead',text:codeStep?`Enter the code sent to ${email}. It expires in five minutes.`:'New here? Your first verified code creates your account. No API key is needed.'});
   if(codeStep){control.inputMode='numeric';control.pattern='[0-9]{6}';control.maxLength=6;control.minLength=6;control.autocomplete='one-time-code';}
   else{control.value=email;control.autocomplete='email';control.maxLength=254;}
   form.append(field(codeStep?'6-digit sign-in code':'Email address',control));
   const submit=async()=>{if(!form.reportValidity())return;await run(async()=>{
    if(codeStep){view=await service.trialVerifyCode(control.value);control.value='';if(view.selected)window.dispatchEvent(new Event('factoryze-connection-changed'));window.dispatchEvent(new Event('factoryze-settings-changed'));}
    else{email=control.value.trim().toLowerCase();await service.trialRequestCode(email);codeStep=true;resendAt=Date.now()+60000;}
    render();
   });};
   form.addEventListener('submit',e=>{e.preventDefault();void submit();});
   const primary=button(codeStep?'Verify and continue':'Send sign-in code',()=>void submit(),{kind:'primary'});
   content.replaceChildren(title,intro,form);
   if(codeStep){resend=button('Send a new code',()=>void run(async()=>{await service.trialRequestCode(email);resendAt=Date.now()+60000;status.textContent='A new code has been requested.';}),{kind:'link'});
    content.append(el('div',{class:'fz-actions'},resend,button('Use another email',()=>{codeStep=false;error.textContent='';render();},{kind:'link'})));}
   content.append(el('p',{class:'fz-help',text:'Credit is attached to your email, so there is no other code to enter. If none is waiting, you can ask for some after signing in.'}));footer(primary);countdown();control.focus();return;
  }
  const a=view.account!;const credit=trialCreditState(view);
  const facts=el('dl',{class:'fz-kv'},el('dt',{text:'Available credit'}),el('dd',{text:money(a.availableMicro)}),el('dt',{text:'Trial status'}),el('dd',{text:credit.label}));
  if(a.dailyLimitMicro)facts.append(el('dt',{text:'Available today'}),el('dd',{text:money(a.dailyAvailableMicro??0)}),el('dt',{text:'Daily reset'}),el('dd',{text:a.dailyResetAt?new Date(a.dailyResetAt).toLocaleString():'00:00 UTC'}));
  if(a.claimed)facts.append(el('dt',{text:'Expires'}),el('dd',{text:new Date(a.expiresAt).toLocaleString()}));
  const account=el('div',{class:'fz-card'},el('div',{class:'fz-row-between'},el('h3',{text:a.email}),button('Sign out',()=>void run(async()=>{try{await service.trialSignOut();}finally{view=await service.trialAccount();codeStep=false;window.dispatchEvent(new Event('factoryze-connection-changed'));window.dispatchEvent(new Event('factoryze-settings-changed'));render();}}),{kind:'quiet',small:true})),facts);
  if(a.reservedMicro>0)account.append(el('p',{class:'fz-help',text:`${money(a.reservedMicro)} is reserved for requests whose final cost is pending.`}));
  const select=el('select',{class:'fz-input'});select.setAttribute('aria-label','Trial model');
  for(const model of view.models){const option=el('option',{text:model.id});option.value=model.id;select.append(option);}
  select.value=view.selectedModel&&view.models.some(x=>x.id===view!.selectedModel)?view.selectedModel:view.models[0]?.id??'';
  const limits=el('p',{class:'fz-help'});const updateLimits=()=>{const model=view!.models.find(x=>x.id===select.value);limits.textContent=model?`Service input ceiling: ${model.maxInputTokens.toLocaleString()} · Maximum reply: ${model.maxOutputTokens.toLocaleString()} tokens.`:'No trial models are available yet.';};select.addEventListener('change',updateLimits);updateLimits();
  // One plain sentence about where the credit stands, and at most one thing to do about it.
  const next=el('div',{class:credit.kind==='ready'?'fz-help':'fz-callout'},el('p',{text:credit.message}));
  if(credit.request)next.append(button(credit.request,()=>void run(async()=>{view=await service.trialRequestCredit();const after=trialCreditState(view);status.textContent=after.canUse||after.kind==='paused'?'Credit added. You can start now.':'Request sent. The project owner will review it.';if(view.selected)window.dispatchEvent(new Event('factoryze-settings-changed'));render();}),{kind:'primary',small:true}));
  if(credit.kind==='waiting')next.append(button('Check again',()=>void run(async()=>{view=await service.trialAccount();if(!trialCreditState(view).canUse)status.textContent='Not approved yet.';render();}),{kind:'link'}));
  // Without usable credit the next step comes first and there is no model to choose yet.
  const choosing=credit.kind==='ready'||credit.kind==='paused'||credit.kind==='daily';
  if(choosing)content.replaceChildren(el('p',{class:'fz-lead',text:'Use the project’s allowance for model requests. Your tools, approvals and task token budget stay on this computer.'}),account,next,field('Trial model',select),limits,el('p',{class:'fz-help',text:'Trial credit is shared across attempts. Each attempt also keeps its own token limit. Factoryze will not switch to your API key automatically.'}));
  else content.replaceChildren(next,account);
  const use=button('Use trial credits',()=>void run(async()=>{const settings=await service.trialSelect(select.value);window.dispatchEvent(new Event('factoryze-connection-changed'));window.dispatchEvent(new Event('factoryze-settings-changed'));saved(settings);m.close();}),{kind:'primary'});
  if(!credit.canUse){use.disabled=true;use.dataset.unavailable='true';}footer(use);
 }
 content.append(el('p',{class:'fz-help',text:'Checking your trial account…'}));footer();void run(async()=>{view=await service.trialAccount();render();});
}
