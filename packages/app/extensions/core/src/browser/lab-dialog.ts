import { labClientConfigSchema, type LabClientConfig } from '@factoryze/protocol';
import type { TaskService } from '../common/task-service';
import { button, el, errorText, modal } from './dom';
import { labAgentNotice } from './flow-model';

export function joinLabDialog(service:TaskService,open:(workspace:string)=>Promise<void>):void {
  const m=modal('Join a lab'),form=el('form'),error=el('p',{class:'fz-error',role:'alert'}),status=el('p',{class:'fz-help',role:'status'});
  const file=el('input',{class:'fz-input',type:'file'});file.accept='.json,application/json';file.setAttribute('aria-label','Lab configuration');
  const lab=el('input',{class:'fz-input'}),student=el('input',{class:'fz-input'}),code=el('input',{class:'fz-input',type:'password'}),mode=el('select',{class:'fz-input'});
  for(const [value,label]of [['join','Join code'],['recover','Recovery token']]){const option=el('option',{text:label});option.value=value!;mode.append(option);}
  mode.setAttribute('aria-label','Sign-in method');lab.setAttribute('aria-label','Lab ID');student.setAttribute('aria-label','Student ID');code.setAttribute('aria-label','Join code or recovery token');
  lab.required=student.required=code.required=true;lab.maxLength=student.maxLength=64;lab.pattern='[a-z][a-z0-9-]*';student.pattern='[A-Za-z0-9][A-Za-z0-9._-]*';code.maxLength=43;code.autocomplete='off';
  let config:LabClientConfig|undefined,busy=false,closed=false;
  file.addEventListener('change',()=>{void(async()=>{try{const selected=file.files?.[0];if(!selected||selected.size>20000)throw Error('Choose the client.json file supplied by lab IT.');
    config=labClientConfigSchema.parse(JSON.parse(await selected.text()));status.textContent=`Server: ${config.baseURL}`;error.textContent='';}catch{config=undefined;error.textContent='Choose a valid lab client configuration. It must contain the pinned public certificate.';}})();});
  const field=(label:string,control:HTMLElement)=>el('label',{class:'fz-field'},el('span',{text:label}),control);
  form.append(field('Lab configuration from your instructor',file),field('Lab ID',lab),field('Student ID',student),field('Sign-in method',mode),field('Join code or recovery token',code));
  m.body.append(el('p',{class:'fz-lead',text:'Join your classroom using the configuration and code from your instructor. No personal API key is needed.'}),form,
    el('p',{class:'fz-help',text:'Your task files and usage sync to the lab server. Paste and focus changes are recorded as flags; clipboard contents are not saved.'}),status,error);
  const submit=async()=>{if(busy||closed||!form.reportValidity())return;if(!config){error.textContent='Choose the lab configuration first.';return;}
    busy=true;join.disabled=true;error.textContent='';status.textContent='Joining the lab and preparing Python…';
    try{const result=await service.joinLab({connection:config,lab:lab.value.trim(),studentId:student.value.trim(),code:mode.value==='join'?code.value.trim():'',
      ...(mode.value==='recover'?{recoveryToken:code.value.trim()}:{} )});if(!closed){m.close();await open(result.workspace);}}
    catch(e){if(!closed){error.textContent=errorText(e);status.textContent='Your existing connection and work are kept.';}}
    finally{busy=false;join.disabled=false;}};
  const join=button('Join lab',()=>void submit(),{kind:'primary'});form.addEventListener('submit',event=>{event.preventDefault();void submit();});
  m.foot.append(button('Cancel',()=>m.close()),join);
  void m.closed.then(()=>{closed=true;for(const input of [lab,student,code])input.value='';file.value='';config=undefined;});
}

export async function labStatusDialog(service:TaskService,workspace:string):Promise<void>{
  const m=modal('Lab connection'),content=el('div'),error=el('p',{class:'fz-error',role:'alert'});m.body.append(content,error);
  const render=async()=>{try{const status=await service.labStatus(workspace);if(!status)throw Error('This attempt is not connected to a lab.');
    content.replaceChildren(el('h3',{text:`${status.lab} · ${status.offline?'Offline':status.state==='closed'?'Closed':'Open'}`}),
      el('dl',{class:'fz-kv'},el('dt',{text:'Student'}),el('dd',{text:status.studentId}),el('dt',{text:'Pinned model'}),el('dd',{text:status.model}),
        el('dt',{text:'Token budget'}),el('dd',{text:`${status.usage.weighted.toLocaleString()} / ${status.usage.budgetLimit.toLocaleString()}`}),
        el('dt',{text:'Deadline'}),el('dd',{text:new Date(status.closesAt).toLocaleString()})),
      el('p',{class:'fz-help',text:status.state==='closed'?'The lab is closed. Saved server snapshots are fixed; local edits no longer update them.':status.offline?'You can keep editing locally. Reconnect before using the agent or submitting.':'The instructor controls the model and budget. Edits and commands still need your approval.'}),
      ...(status.state==='open'&&!status.offline&&!status.inference?[el('p',{class:'fz-help',text:labAgentNotice(status).text})]:[]),
      ...(!status.grading?[el('p',{class:'fz-help',text:'Server grading is not enabled. Submissions remain queued until isolated grading is configured.'})]:[]),
      el('p',{class:'fz-help',text:`Checked at ${new Date().toLocaleTimeString()}.`}));
    error.textContent='';}catch(e){error.textContent=errorText(e);}};
  m.foot.append(button('Reconnect',()=>void render()),button('Close',()=>m.close(),{kind:'primary'}));await render();
}
