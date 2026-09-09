'use strict';
const $ = id => document.getElementById(id);
let category='general', page=1, controller=null, serial=0, submitted=null;
function node(tag, cls, text){const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;}
function clearSession(){closeReader();serial++;controller?.abort();controller=null;submitted=null;page=1;$('query').value='';$('provider-report').hidden=true;$('provider-details').replaceChildren();$('results').replaceChildren();$('results').hidden=true;$('pagination').hidden=true;$('welcome').hidden=false;document.body.classList.remove('has-results');$('status').textContent='Session cleared. No searches saved by Hoyahh.';$('status').className='';$('route-status').textContent='Connection not checked for this session.';$('query').focus();}
async function search(targetPage=1){
 const query=$('query').value.trim();if(!query){$('query').focus();return;}
 const searchState={q:query,category,time:$('time').value,safe:$('safe').value};
 if(targetPage>1 && JSON.stringify(searchState)!==JSON.stringify(submitted))targetPage=1;
 const ticket=++serial;controller?.abort();controller=new AbortController();
 document.body.classList.add('has-results');$('welcome').hidden=true;$('provider-report').hidden=true;$('provider-details').replaceChildren();$('results').replaceChildren();$('results').hidden=false;$('pagination').hidden=true;$('status').className='';$('status').textContent='Checking Tor, then searching. This can take up to 90 seconds…';
 try{
  const response=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json','X-Veil-Request':'1'},body:JSON.stringify({...searchState,page:targetPage}),signal:controller.signal,cache:'no-store',credentials:'omit'});
  const data=await response.json();if(ticket!==serial)return;if(!response.ok)throw new Error(data.error||'Search is unavailable. Try again.');
  submitted=searchState;page=targetPage;showRoute(data.route);
  for(const result of data.results){
   let url;try{url=new URL(result.url);if(!['http:','https:'].includes(url.protocol))continue;}catch{continue;}
   const article=node('article','result','');article.append(node('p','domain',url.hostname));
   const heading=node('h2','','');const titleButton=node('button','result-title',result.title||url.hostname);titleButton.type='button';titleButton.setAttribute('aria-label',`Open ${result.title||url.hostname} in Hoyahh`);titleButton.addEventListener('click',async()=>{if(window.veilDesktop){try{await window.veilDesktop.open(url.href);}catch{$('status').textContent='The browser could not open this page. Check Tor and try again.';}}else openReader(url.href);});heading.append(titleButton);article.append(heading,node('p','snippet',result.content||''));
   const actions=node('div','result-actions','');const address=document.createElement('input');address.type='text';address.readOnly=true;address.value=url.href;address.setAttribute('aria-label','Result website address');
   const copy=node('button','quiet','Copy link');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url.href);copy.textContent='Link copied';}catch{address.focus();address.select();copy.textContent='Select and copy this address';}});actions.append(address,copy);article.append(actions);
   if(result.engines?.length)article.append(node('p','sources',result.engines.join(' · ')));
   $('results').append(article);
  }
  const count=$('results').children.length;
  const counts=new Map();
  for(const result of data.results){for(const name of new Set(result.engines||[])){counts.set(name,(counts.get(name)||0)+1);}}
  $('provider-report').hidden=false;
  if(counts.size){$('provider-details').append(node('p','', 'Sources on this page: '+[...counts].map(([name,n])=>`${name} (${n})`).join(', ')+'.'));}
  else{$('provider-details').append(node('p','','No result sources on this page.'));}
  for(const failure of data.provider_failures||[]){$('provider-details').append(node('p','',`${failure.name}: ${failure.reason}`));}
  if(data.partial&&!data.provider_failures?.length){$('provider-details').append(node('p','','Some providers failed without a readable status.'));}
  $('provider-details').append(node('p','','A provider missing from this list may have no matching results or may not support the selected category or filters.'));
  $('provider-report').open=Boolean(data.partial);
  $('status').textContent=`${count} results on page ${page}.`+(data.partial?' Some providers did not respond.':'');
  if(!count)$('results').append(node('p','empty','No results on this page. Try broader words, another category, or a different time range.'));
  $('pagination').hidden=!(count||page>1);$('previous').disabled=page===1;$('next').disabled=count===0;$('page-label').textContent=`Page ${page}`;
 }catch(error){if(ticket!==serial||error.name==='AbortError')return;$('route-status').textContent='Search did not complete. Check Tor before retrying.';$('status').className='error';$('status').textContent=error.message==='Failed to fetch'?'Cannot connect. Make sure Hoyahh is running, then try again.':error.message;}
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();search();});
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(submitted)search();}));
['time','safe'].forEach(id=>$(id).addEventListener('change',()=>{if(submitted)search();}));
$('previous').addEventListener('click',()=>search(Math.max(1,page-1)));$('next').addEventListener('click',()=>search(page+1));$('clear').addEventListener('click',clearSession);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();clearSession();}else if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('query').focus();}});
window.addEventListener('pagehide',clearSession);window.addEventListener('pageshow',e=>{if(e.persisted)clearSession();});

function showRoute(route){
 if(route?.tor_verified===true){$('route-status').textContent=`Tor verified at ${new Date().toLocaleTimeString()}. Probe exit IP: ${route.probe_exit_ip}. Search exits may differ.`;}
 else{$('route-status').textContent='Tor not verified. Searches are blocked.';}
}
$('check-tor').addEventListener('click',async()=>{
 const button=$('check-tor');const ticket=serial;button.disabled=true;$('route-status').textContent='Checking through Tor…';
 try{const response=await fetch('/api/connection',{method:'POST',headers:{'X-Veil-Request':'1'},cache:'no-store',credentials:'omit'});const data=await response.json();if(ticket===serial)showRoute(data);}
 catch{if(ticket===serial)$('route-status').textContent='Cannot verify Tor. Make sure Hoyahh is running.';}
 finally{button.disabled=false;}
});

let readerController=null, readerSerial=0, readerTrail=[], readerReturnScroll=0;
function closeReader(){
 readerSerial++;readerController?.abort();readerController=null;readerTrail=[];
 const wasReading=document.body.classList.contains('reading');
 document.body.classList.remove('reading');$('reader').hidden=true;$('reader-content').replaceChildren();$('reader-address').value='';$('reader-title').textContent='Reading view';$('reader-status').textContent='';
 if(wasReading)window.scrollTo(0,readerReturnScroll);
}
async function openReader(url, record=true){
 if(!document.body.classList.contains('reading'))readerReturnScroll=window.scrollY;
 const ticket=++readerSerial;readerController?.abort();readerController=new AbortController();
 if(record&&readerTrail.at(-1)!==url)readerTrail.push(url);
 $('reader-back').disabled=readerTrail.length<2;
 document.body.classList.add('reading');$('reader').hidden=false;$('reader-content').replaceChildren();$('reader-title').textContent='Opening page…';$('reader-address').value=url;$('reader-status').className='';$('reader-status').textContent='Checking Tor and loading the page. This may take up to 90 seconds…';window.scrollTo(0,0);
 try{
  const response=await fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json','X-Veil-Request':'1'},body:JSON.stringify({url}),signal:readerController.signal,credentials:'omit',cache:'no-store'});
  const data=await response.json();if(ticket!==readerSerial)return;
  if(!response.ok)throw new Error(data.error||'The page could not be loaded.');
  $('reader-title').textContent=data.title||'Reading view';$('reader-address').value=data.url||url;
  // Only typed text segments are rendered. Never insert remote HTML, markup, styles, or attributes.
  for(const block of (data.blocks||[]).slice(0,500)){
   const element=document.createElement(block.kind==='heading'?'h2':block.kind==='pre'?'pre':'p');
   for(const segment of (block.segments||[])){
    if(typeof segment.text!=='string')continue;
    if(typeof segment.url==='string'){
     const link=node('button','reader-link',segment.text);link.type='button';link.addEventListener('click',()=>openReader(segment.url));element.append(link);
    }else{element.append(document.createTextNode(segment.text));}
   }
   $('reader-content').append(element);
  }
  showRoute(data.route);
  $('reader-status').textContent=data.blocks?.length?(data.truncated?'Showing the first part of this page. Reading limit reached.':'Loaded through Tor. Page links open in this reading view.'):'This page has no readable text. It may require JavaScript or block automated readers.';
  $('reader-title').focus({preventScroll:true});
 }catch(error){
  if(ticket!==readerSerial||error.name==='AbortError')return;
  $('reader-title').textContent='Page could not be opened';$('reader-status').className='error';$('reader-status').textContent=error.message==='Failed to fetch'?'Cannot connect to Hoyahh. Make sure the app is running.':error.message;
 }
}
$('reader-results').addEventListener('click',closeReader);
$('reader-back').addEventListener('click',()=>{if(readerTrail.length>1){readerTrail.pop();openReader(readerTrail.at(-1),false);}});

if(window.veilDesktop){window.veilDesktop.onSearch(query=>{$('query').value=query;search();});document.querySelector('.route-panel strong').textContent='Tor-routed search';document.querySelector('.privacy-note').hidden=true;$('status').textContent='Click a result to open the full website in a new Hoyahh tab.';}
