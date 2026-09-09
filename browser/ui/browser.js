'use strict';
const $=id=>document.getElementById(id);
let state, toastTimer, editing=false;
const el=(tag,text,cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
async function command(action,data){try{return await window.veil.command(action,data);}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
function applyTheme(s){
 for(const [key,value] of Object.entries({'--accent':s.accent,'--bg':s.background,'--text':s.text,'--font':s.font+', sans-serif','--font-size':s.fontSize+'px','--radius':s.radius+'px'}))document.documentElement.style.setProperty(key,value);
 document.body.dataset.layout=s.layout;
 $('dashboard').style.backgroundImage=s.wallpaper?`linear-gradient(${s.background}b8,${s.background}dc), url("${s.wallpaper}")`:'';
 // User-authored styles are restricted to the shell; CSP blocks remote resources.
 $('user-css').textContent=state.panel?'':s.css;
 $('clock').hidden=!s.showClock;$('notes-card').hidden=!s.showNotes;
 if(document.activeElement!==$('notes'))$('notes').value=s.notes;
 tick();
}
function tick(){
 const now=new Date(),s=state?.settings;if(!s)return;
 $('date').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
 const hour=now.getHours(),greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
 $('greeting').textContent=greeting+(s.name?', '+s.name+'.':'.');
 $('clock').textContent=now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:!s.clock24}).replace(/\s*[AP]M/i,'');
 $('clock').setAttribute('aria-label',now.toLocaleTimeString());
}
function fillSettings(){
 const f=$('settings-form'),s=state.settings;
 for(const key of ['name','accent','background','text','font','fontSize','radius','layout','css'])f.elements[key].value=s[key];
 for(const key of ['showClock','clock24','showNotes'])f.elements[key].checked=s[key];
 f.elements.shortcuts.value=s.shortcuts.map(x=>x.name+' | '+x.url).join('\n');
 const select=$('newtab-select');select.replaceChildren(new Option('Hoyahh · Material You style',''));
 for(const ext of state.extensions)if(ext.newtab)select.append(new Option(ext.name,ext.id));select.value=s.newTabExtension;
}
function render(next){
 const wasPanel=state?.panel;state=next;const active=state.tabs.find(t=>t.id===state.active);
 $('tabs').replaceChildren();for(const t of state.tabs){const wrap=el('div','','tab'+(t.id===state.active?' active':''));const button=el('button',(t.loading?'◌ ':'')+t.title,'tab-name');button.setAttribute('role','tab');button.setAttribute('aria-selected',String(t.id===state.active));button.title=t.title;button.onclick=()=>command('focus',t.id);const close=el('button','×','tab-close');close.setAttribute('aria-label','Close '+t.title);close.onclick=()=>command('close',t.id);wrap.append(button,close);$('tabs').append(wrap);}
 if(document.activeElement!==$('address'))$('address').value=active?.kind==='home'?'':active?.url||'';
 $('back').disabled=!active?.back;$('forward').disabled=!active?.forward;$('reload').textContent=active?.loading?'×':'↻';$('reload').setAttribute('aria-label',active?.loading?'Stop loading':'Reload');
 $('dashboard').hidden=state.panel||active?.kind!=='home';$('settings').hidden=!state.panel;
 $('page-error').hidden=state.panel||!active?.error;$('error-copy').textContent=active?.error||'';
 const verified=state.route.status==='verified';$('tor').textContent=verified?'Tor checked':state.route.status==='checking'?'Checking…':'Check Tor';$('tor').className='tor-button'+(verified?' verified':'');$('tor').title=state.route.message;
 $('connection-title').textContent=verified?'Connected through Tor.':state.route.status==='checking'?'Finding your route…':'Let’s connect.';$('connection-copy').textContent=state.route.message;
 applyTheme(state.settings);
 $('shortcuts').replaceChildren();for(const link of state.settings.shortcuts){const b=el('button','','shortcut');b.append(el('i',link.name.slice(0,1).toUpperCase()),el('span',link.name));b.title=link.url;b.onclick=()=>command('open',link.url);$('shortcuts').append(b);}const add=el('button','','shortcut');add.append(el('i','+'),el('span','Add shortcut'));add.onclick=()=>command('panel',true);$('shortcuts').append(add);
 if(state.panel&&(!wasPanel||!editing))fillSettings();
 $('extensions').replaceChildren();for(const ext of state.extensions){const row=el('div','','extension');row.append(el('strong',ext.name));const options=el('button','Open settings');options.onclick=()=>command('extension-page',ext.id);const remove=el('button','Remove');remove.onclick=()=>command('extension-remove',ext.id);row.append(options,remove);$('extensions').append(row);}
}
window.veil.onState(render);window.veil.onShortcut(name=>{if(name==='address'){$('address').focus();$('address').select();}});
setInterval(tick,1000);
$('new-tab').onclick=()=>command('new');$('home').onclick=()=>command('home');$('back').onclick=()=>command('back');$('forward').onclick=()=>command('forward');$('reload').onclick=()=>command(state.tabs.find(t=>t.id===state.active)?.loading?'stop':'reload');
for(const id of ['customize','edit-home'])$(id).onclick=()=>{editing=false;command('panel',true);};$('done').onclick=()=>{editing=false;command('panel',false);};
for(const id of ['tor','check-home','error-check'])$(id).onclick=()=>command('check');$('retry').onclick=()=>command('reload');
$('address-form').onsubmit=event=>{event.preventDefault();command('go',$('address').value);$('address').blur();};
$('home-search').onsubmit=event=>{event.preventDefault();if($('home-query').value.trim())command('go',$('home-query').value);};
$('notes').onchange=()=>command('settings',{...state.settings,notes:$('notes').value});
$('settings-form').oninput=()=>{editing=true;$('saved').textContent='Unsaved changes';};
$('settings-form').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,s={...state.settings};
 for(const key of ['name','accent','background','text','font','layout','css','newTabExtension'])s[key]=form.elements[key].value;
 for(const key of ['fontSize','radius'])s[key]=Number(form.elements[key].value);
 for(const key of ['showClock','clock24','showNotes'])s[key]=form.elements[key].checked;
 const lines=form.elements.shortcuts.value.split('\n').filter(x=>x.trim());
 const links=[];for(const line of lines){const separator=line.indexOf('|');if(separator<1){toast('Use name | https://website for each shortcut.');return;}const name=line.slice(0,separator).trim(),url=line.slice(separator+1).trim();try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error();}catch{toast('Check the address for '+name+'.');return;}links.push({name,url});}s.shortcuts=links;
 editing=false;await command('settings',s);$('saved').textContent='Saved on this computer';
};
const presets={mint:{accent:'#a8e6cf',background:'#101815',text:'#edf6ef'},violet:{accent:'#d6bcfa',background:'#1b1625',text:'#f5ecff'},daylight:{accent:'#93d7c0',background:'#f4f8f5',text:'#18332a'},midnight:{accent:'#afcbfa',background:'#10151e',text:'#edf2fa'}};
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{for(const [k,v]of Object.entries(presets[b.dataset.preset]))$('settings-form').elements[k].value=v;editing=true;$('saved').textContent='Save changes to apply';};
$('wallpaper').onclick=()=>command('wallpaper');$('remove-wallpaper').onclick=()=>command('settings',{...state.settings,wallpaper:''});
$('reset').onclick=()=>{editing=false;command('settings',{notes:state.settings.notes,shortcuts:state.settings.shortcuts});};
$('export').onclick=()=>command('export');$('import').onclick=()=>{editing=false;command('import');};$('load-extension').onclick=()=>command('extension-add');$('clear-data').onclick=()=>command('clear');
command('state');
