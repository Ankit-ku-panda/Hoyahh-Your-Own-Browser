'use strict';
const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HOME, PROXY, publicURL, remoteAllowed, localAllowed, destination, settings } = require('./policy.cjs');

// Keep the existing profile when changing the displayed app name.
app.setName('Veil Browser');
const existingProfile = app.getPath('userData');
require('node:fs').mkdirSync(existingProfile, { recursive: true });
app.setName('Hoyahh');
app.setPath('userData', existingProfile);
app.enableSandbox();
app.commandLine.appendSwitch('proxy-server', PROXY.proxyRules);
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-http-cache');
if (!app.requestSingleInstanceLock()) app.quit();

const SHELL = pathToFileURL(path.join(__dirname,'ui','index.html')).href;
let win, remote, local, shellSession, active = 0, nextID = 1, panel = false, closing = false;
const tabs = new Map();
let config = { appearance: settings(), extensions: [] };
let configSave = Promise.resolve();
let route = { status: 'unchecked', message: 'Tor connection has not been checked.' }, lastCheck=0, pendingCheck;
const configPath = () => path.join(app.getPath('userData'),'customization.json');
const ids = () => remote?.extensions.getAllExtensions().map(x=>x.id) || [];
const tab = () => tabs.get(active);

async function saveConfig() {
  const serialized=JSON.stringify(config,null,2);
  configSave=configSave.catch(()=>{}).then(async()=>{
    await fs.mkdir(app.getPath('userData'),{recursive:true});
    await fs.writeFile(configPath()+'.tmp',serialized);
    await fs.rename(configPath()+'.tmp',configPath());
  });
  return configSave;
}
function send() {
  if (!win || win.isDestroyed()) return;
  layout();
  win.webContents.send('veil:state',{
    active, panel, settings:config.appearance, route,
    extensions:remote.extensions.getAllExtensions().map(x=>({id:x.id,name:x.name,newtab:Boolean(x.manifest.chrome_url_overrides?.newtab)})),
    tabs:[...tabs.values()].map(t=>({id:t.id,kind:t.kind,title:t.title,url:t.url,error:t.error||'',loading:t.loading||false,back:t.view?.webContents.navigationHistory.canGoBack()||false,forward:t.view?.webContents.navigationHistory.canGoForward()||false}))
  });
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width,height]=win.getContentSize();
  for(const t of tabs.values()) if(t.view){
    t.view.setVisible(t.id===active&&!panel&&!t.error);
    t.view.setBounds({x:0,y:104,width,height:Math.max(0,height-104)});
  }
}
function focus(id) { if(!tabs.has(id))return; active=id;panel=false;layout();send();tab()?.view?.webContents.focus(); }
function closeTab(id) {
  const t=tabs.get(id);if(!t)return;
  if(t.view){win.contentView.removeChildView(t.view);t.view.webContents.close();}
  tabs.delete(id);
  if(!tabs.size) return newHome();
  if(active===id)active=[...tabs.keys()].at(-1);
  layout();send();
}
function newHome(forceBuiltIn=false) {
  const ext=remote.extensions.getExtension(config.appearance.newTabExtension);
  if(!forceBuiltIn && ext?.manifest.chrome_url_overrides?.newtab) {
    return createView('extension',new URL(ext.manifest.chrome_url_overrides.newtab,`chrome-extension://${ext.id}/`).href);
  }
  const t={id:nextID++,kind:'home',title:'New tab',url:'hoyahh://newtab'};tabs.set(t.id,t);focus(t.id);return t.id;
}
async function checkTor() {
  if(pendingCheck)return pendingCheck;
  route={status:'checking',message:'Checking this browser’s Tor connection…'};send();
  pendingCheck=(async()=>{
    try {
      const response=await remote.fetch('https://check.torproject.org/api/ip',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});
      const data=await response.json();
      if(!response.ok||data.IsTor!==true)throw Error('not-tor');
      route={status:'verified',message:'Tor verified at '+new Date().toLocaleTimeString()+'.',checkedAt:Date.now()};lastCheck=Date.now();
      return true;
    } catch {
      route={status:'failed',message:'Tor unavailable. Start Docker Desktop and start-browser.bat, then check again.'};lastCheck=0;return false;
    } finally { pendingCheck=null;send(); }
  })();
  return pendingCheck;
}
function keys(event,input) {
  if(input.type!=='keyDown')return;
  const mod=input.control||input.meta;
  if(mod&&['l','t','w',','].includes(input.key.toLowerCase())) {
    event.preventDefault();const k=input.key.toLowerCase();
    if(k==='t')newHome();
    if(k==='w')closeTab(active);
    if(k===','){panel=!panel;layout();send();}
    if(k==='l'){win.webContents.focus();win.webContents.send('veil:shortcut','address');}
  } else if(mod&&input.key==='Tab') {
    event.preventDefault();const list=[...tabs.keys()],i=list.indexOf(active);focus(list[(i+(input.shift?list.length-1:1))%list.length]);
  } else if(mod&&input.key.toLowerCase()==='r') {event.preventDefault();tab()?.view?.webContents.reload();}
  else if(input.alt&&['ArrowLeft','ArrowRight'].includes(input.key)) {
    event.preventDefault();const h=tab()?.view?.webContents.navigationHistory;
    if(input.key==='ArrowLeft'&&h?.canGoBack())h.goBack();
    if(input.key==='ArrowRight'&&h?.canGoForward())h.goForward();
  }
}
app.on('web-contents-created',(_event,wc)=>{
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.on('will-attach-webview',event=>event.preventDefault());
  wc.on('before-input-event',keys);
  wc.setWindowOpenHandler(({url})=>{if(wc!==win?.webContents)openValue(url,true).catch(()=>{});return {action:'deny'};});
});
function createView(kind,url,query='') {
  const isLocal=kind==='search';
  const view=new WebContentsView({webPreferences:{session:isLocal?local:remote,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,...(isLocal?{preload:path.join(__dirname,'search-preload.cjs')}:{})}});
  const wc=view.webContents;
  const t={id:nextID++,kind,title:isLocal?'Hoyahh':'Loading…',url,view,loading:true};tabs.set(t.id,t);win.contentView.addChildView(view);focus(t.id);
  wc.on('will-navigate',(event,target)=>{
    if(isLocal&&!localAllowed(target)){event.preventDefault();openValue(target,true).catch(()=>{});}
    else if(!isLocal&&!remoteAllowed(target,ids()))event.preventDefault();
  });
  wc.on('will-redirect',(event,target)=>{if(!(isLocal?localAllowed(target):remoteAllowed(target,ids())))event.preventDefault();});
  wc.on('page-title-updated',(_event,title)=>{t.title=String(title).slice(0,180);send();});
  wc.on('did-navigate',(_event,target)=>{t.url=target;send();});
  wc.on('did-navigate-in-page',(_event,target,mainFrame)=>{if(mainFrame){t.url=target;send();}});
  wc.on('did-start-loading',()=>{t.loading=true;t.error='';send();});
  wc.on('did-stop-loading',()=>{t.loading=false;send();});
  wc.on('did-fail-load',(_event,code,_description,_url,mainFrame)=>{
    if(mainFrame&&code!==-3){t.error=isLocal?'Hoyahh is unavailable. Run start-browser.bat with Docker Desktop open.':'This page could not load through Tor. Check the connection, then retry. Some sites block Tor.';t.loading=false;send();}
  });
  wc.on('render-process-gone',()=>{t.error='This tab stopped responding. Close it and open a new tab.';send();});
  wc.on('context-menu',(_event,params)=>{
    const template=[];
    if(params.linkURL){try{const target=publicURL(params.linkURL);template.push({label:'Open link in a new Tor tab',click:()=>openValue(target,true).catch(()=>{})});}catch{}}
    template.push({role:'copy'},{role:'paste'},{role:'selectAll'});
    Menu.buildFromTemplate(template).popup({window:win});
  });
  if(query)wc.once('did-finish-load',()=>wc.send('veil:search',query));
  wc.loadURL(url).catch(()=>{});return t.id;
}
async function openValue(value,newTab=false) {
  const dest=destination(value);
  if(dest.kind==='home')return newHome(true);
  if(dest.kind==='web'&&Date.now()-lastCheck>60000&&!await checkTor())throw Error(route.message);
  const current=tab();
  if(dest.kind==='web'&&!newTab&&current?.kind==='web') {
    current.url=dest.url;current.error='';send();current.view.webContents.loadURL(dest.url).catch(()=>{});return current.id;
  }
  const replace=!newTab&&current?.kind==='home'?current.id:null;
  const id=createView(dest.kind,dest.kind==='search'?HOME:dest.url,dest.query);
  if(replace)closeTab(replace);return id;
}
function trusted(event) { return event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===SHELL; }
ipcMain.handle('veil:open-result',async(event,url)=>{
  if(event.senderFrame!==event.sender.mainFrame||!localAllowed(event.senderFrame.url)||![...tabs.values()].some(t=>t.kind==='search'&&t.view.webContents===event.sender))throw Error('Blocked request.');
  return openValue(publicURL(url),true);
});
ipcMain.handle('veil:command',async(event,action,data)=>{
  if(!trusted(event))throw Error('Blocked request.');
  switch(action){
    case 'state':send();return;
    case 'new':return newHome();
    case 'home':return newHome(true);
    case 'focus':return focus(Number(data));
    case 'close':return closeTab(Number(data));
    case 'go':return openValue(data);
    case 'open':return openValue(data,true);
    case 'check':return checkTor();
    case 'back':if(tab()?.view?.webContents.navigationHistory.canGoBack())tab().view.webContents.navigationHistory.goBack();return;
    case 'forward':if(tab()?.view?.webContents.navigationHistory.canGoForward())tab().view.webContents.navigationHistory.goForward();return;
    case 'reload':tab()?.view?.webContents.reload();return;
    case 'stop':tab()?.view?.webContents.stop();return;
    case 'panel':panel=Boolean(data);layout();send();return;
    case 'settings':config.appearance=settings(data);await saveConfig();send();return;
    case 'wallpaper':{
      const pick=await dialog.showOpenDialog(win,{title:'Choose a wallpaper',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});
      if(pick.canceled)return;
      const stat=await fs.stat(pick.filePaths[0]);if(stat.size>10000000)throw Error('Choose an image smaller than 10 MB.');
      const img=nativeImage.createFromPath(pick.filePaths[0]);if(img.isEmpty())throw Error('This image could not be opened.');
      config.appearance.wallpaper=img.resize({width:1920}).toDataURL();config.appearance=settings(config.appearance);await saveConfig();send();return;
    }
    case 'export':{
      const pick=await dialog.showSaveDialog(win,{title:'Export customization',defaultPath:'Hoyahh-theme.json',filters:[{name:'JSON',extensions:['json']}]});
      if(!pick.canceled)await fs.writeFile(pick.filePath,JSON.stringify(config.appearance,null,2));return;
    }
    case 'import':{
      const pick=await dialog.showOpenDialog(win,{title:'Import customization',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
      if(pick.canceled)return;
      if((await fs.stat(pick.filePaths[0])).size>18000000)throw Error('The settings file is too large.');
      config.appearance=settings(JSON.parse(await fs.readFile(pick.filePaths[0],'utf8')));await saveConfig();send();return;
    }
    case 'extension-add':{
      const pick=await dialog.showOpenDialog(win,{title:'Choose an unpacked extension folder containing manifest.json',properties:['openDirectory']});
      if(pick.canceled)return;
      const directory=pick.filePaths[0];const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
      const choice=await dialog.showMessageBox(win,{type:'warning',title:'Load extension?',message:'Load '+String(manifest.name||'this extension')+'?',detail:'Only load extensions you trust. Extensions may read page content and send data. Electron supports only some Chrome APIs. Requested permissions: '+JSON.stringify([...(manifest.permissions||[]),...(manifest.host_permissions||[])]),buttons:['Cancel','Load extension'],defaultId:0,cancelId:0});
      if(choice.response!==1)return;
      await remote.extensions.loadExtension(directory,{allowFileAccess:false});
      if(!config.extensions.includes(directory))config.extensions.push(directory);await saveConfig();send();return;
    }
    case 'extension-remove':{
      const ext=remote.extensions.getExtension(String(data));if(!ext)return;
      remote.extensions.removeExtension(ext.id);config.extensions=config.extensions.filter(p=>path.resolve(p)!==path.resolve(ext.path));
      if(config.appearance.newTabExtension===ext.id)config.appearance.newTabExtension='';await saveConfig();send();return;
    }
    case 'extension-page':{
      const ext=remote.extensions.getExtension(String(data));if(!ext)return;
      const page=ext.manifest.options_ui?.page||ext.manifest.options_page||ext.manifest.action?.default_popup||ext.manifest.browser_action?.default_popup;
      if(!page)throw Error('This extension has no settings page or popup.');
      return createView('extension',new URL(page,`chrome-extension://${ext.id}/`).href);
    }
    case 'clear':{
      for(const t of [...tabs.values()])if(t.view){win.contentView.removeChildView(t.view);t.view.webContents.close();}
      tabs.clear();await remote.closeAllConnections();await remote.clearStorageData();await remote.clearCache();await local.clearStorageData();lastCheck=0;route={status:'unchecked',message:'Browsing data cleared. Tor connection has not been rechecked.'};return newHome(true);
    }
    default:throw Error('Unknown action.');
  }
});

function permissions(ses){
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.setDevicePermissionHandler(()=>false);
  ses.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
  ses.on('will-download',(event)=>{event.preventDefault();dialog.showMessageBox(win,{message:'Downloads are disabled in this first version.',detail:'Reading pages and normal website navigation are supported.'}).catch(()=>{});});
}
app.whenReady().then(async()=>{
  try {const c=JSON.parse(await fs.readFile(configPath(),'utf8'));config={appearance:settings(c.appearance),extensions:Array.isArray(c.extensions)?c.extensions.filter(x=>typeof x==='string'):[]};}catch{}
  remote=session.fromPartition('persist:veil-web',{cache:false});
  local=session.fromPartition('veil-local',{cache:false});shellSession=session.fromPartition('veil-shell',{cache:false});
  await remote.setProxy(PROXY);await remote.closeAllConnections();
  await remote.clearStorageData();await remote.clearCache();
  await local.setProxy({mode:'direct'});
  permissions(remote);permissions(local);permissions(shellSession);
  remote.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!remoteAllowed(details.url,ids())}));
  local.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!localAllowed(details.url)}));
  shellSession.webRequest.onBeforeRequest((details,callback)=>{
    const prefix=pathToFileURL(path.join(__dirname,'ui')+path.sep).href;
    callback({cancel:!(details.url.startsWith(prefix)||details.url.startsWith('data:image/png;base64,'))});
  });
  win=new BrowserWindow({width:1400,height:920,minWidth:800,minHeight:640,title:'Hoyahh',backgroundColor:'#101815',autoHideMenuBar:true,webPreferences:{session:shellSession,preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  Menu.setApplicationMenu(null);
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('resize',layout);
  win.on('close',event=>{
    if(closing)return;event.preventDefault();closing=true;
    for(const t of tabs.values())if(t.view)t.view.webContents.close();
    Promise.allSettled([remote.clearStorageData(),remote.clearCache(),remote.closeAllConnections()]).finally(()=>win.destroy());
  });
  await win.loadURL(SHELL);
  for(const directory of config.extensions){try{await remote.extensions.loadExtension(directory,{allowFileAccess:false});}catch{route={status:'unchecked',message:'An extension could not load. Check its folder in Customize.'};}}
  newHome();checkTor();
}).catch(error=>{dialog.showErrorBox('Hoyahh could not start',String(error.message));app.quit();});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
