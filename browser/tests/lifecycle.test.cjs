const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');

async function harness(){
 const log=[], handlers=new Map(), sessions=new Map(), windows=[], views=[];
 let isTor=true;
 const app=new EventEmitter();
 Object.assign(app,{setName(){},setPath(){},enableSandbox(){log.push('sandbox');},commandLine:{appendSwitch(k,v){log.push([k,v]);}},requestSingleInstanceLock:()=>true,quit(){},getPath:()=>'/mock/user',whenReady:()=>Promise.resolve()});
 class WC extends EventEmitter{
  constructor(){super();this.mainFrame={url:''};this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false};this.sent=[];app.emit('web-contents-created',{},this);}
  setWebRTCIPHandlingPolicy(value){this.webrtc=value;}
  setWindowOpenHandler(handler){this.popup=handler;}
  async loadURL(url){this.mainFrame.url=url;log.push(['load',url]);this.emit('did-finish-load');}
  send(...args){this.sent.push(args);}
  focus(){} close(){} reload(){} stop(){}
 }
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.webContents=new WC();this.contentView={addChildView(){},removeChildView(){}};windows.push(this);}
  loadURL(url){return this.webContents.loadURL(url);}
  isDestroyed(){return false;}getContentSize(){return [1400,900];}destroy(){}focus(){}
 }
 class View{
  constructor(options){this.options=options;this.webContents=new WC();views.push(this);}
  setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}
 }
 function session(name){if(sessions.has(name))return sessions.get(name);const s={
  async setProxy(p){log.push(['proxy',name,p]);this.proxy=p;},async closeAllConnections(){},async clearStorageData(){},async clearCache(){},
  setPermissionRequestHandler(fn){this.permission=fn;},setPermissionCheckHandler(fn){this.permissionCheck=fn;},setDevicePermissionHandler(){},setDisplayMediaRequestHandler(){},on(){},
  webRequest:{onBeforeRequest(fn){s.filter=fn;}},extensions:{getAllExtensions:()=>[],getExtension:()=>null},
  async fetch(url){log.push(['fetch',url]);return {ok:true,json:async()=>({IsTor:isTor,IP:'1.2.3.4'})};}
 };sessions.set(name,s);return s;}
 const electron={app,BrowserWindow:Window,WebContentsView:View,session:{fromPartition:session},ipcMain:{handle(k,fn){handlers.set(k,fn);}},dialog:{showErrorBox(...args){throw Error(args.join(':'));}},Menu:{setApplicationMenu(){},buildFromTemplate(){return{popup(){}};}},nativeImage:{}};
 const dir=path.resolve(__dirname,'..');
 const fakeFS={async readFile(){throw Error('absent');},async mkdir(){},async writeFile(){},async rename(){}};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'main.cjs'),'utf8'),{require:n=>n==='electron'?electron:n==='node:fs/promises'?fakeFS:n==='node:fs'?{mkdirSync(){}}:n==='./policy.cjs'?require('../policy.cjs'):require(n),__dirname:dir,AbortSignal,URL,console});
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 const shell=windows[0].webContents;
 return {log,views,sessions,shell,setTor:v=>isTor=v,command:(a,d)=>handlers.get('veil:command')({sender:shell,senderFrame:shell.mainFrame},a,d),handlers};
}
test('browser configures proxy before loading; remote tabs are sandboxed with no privileged preload',async()=>{
 const h=await harness();
 assert(h.log.findIndex(x=>Array.isArray(x)&&x[0]==='proxy')<h.log.findIndex(x=>Array.isArray(x)&&x[0]==='load'));
 await h.command('go','https://python.org/');const pref=h.views[0].options.webPreferences;
 assert.equal(pref.session,h.sessions.get('persist:veil-web'));assert.equal(pref.sandbox,true);assert.equal(pref.contextIsolation,true);assert.equal(pref.nodeIntegration,false);assert.equal(pref.preload,undefined);
 assert.equal(h.views[0].webContents.webrtc,'disable_non_proxied_udp');
 let answer;pref.session.filter({url:'http://127.0.0.1:8787'},v=>answer=v);assert.equal(answer.cancel,true);
});
test('failed browser Tor check prevents new remote tabs and does not switch to direct',async()=>{
 const h=await harness();h.setTor(false);assert.equal(await h.command('check'),false);
 await assert.rejects(h.command('open','https://python.org/'),/Tor unavailable/);
 assert.equal(h.views.length,0);assert.equal(h.sessions.get('persist:veil-web').proxy.mode,'fixed_servers');
});
test('search tabs use isolated local session; remote and forged frames cannot use privileged IPC',async()=>{
 const h=await harness();await h.command('go','python tutorial');
 const search=h.views[0].webContents;
 assert.equal(h.views[0].options.webPreferences.session,h.sessions.get('veil-local'));
 assert.deepEqual(search.sent[0],['veil:search','python tutorial']);
 let answer;h.sessions.get('veil-local').filter({url:'https://python.org/'},v=>answer=v);assert.equal(answer.cancel,true);
 await assert.rejects(h.handlers.get('veil:command')({sender:search,senderFrame:search.mainFrame},'extension-add'),/Blocked/);
 await assert.rejects(h.handlers.get('veil:open-result')({sender:h.shell,senderFrame:{url:'http://127.0.0.1:8787'}},'https://python.org/'),/Blocked/);
 await h.handlers.get('veil:open-result')({sender:search,senderFrame:search.mainFrame},'https://python.org/');assert.equal(h.views.length,2);
});
