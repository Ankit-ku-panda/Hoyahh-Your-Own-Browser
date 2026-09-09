const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicURL,remoteAllowed,localAllowed,destination,settings,PROXY}=require('../policy.cjs');
test('addresses and searches are separated without external search URLs',()=>{
 assert.deepEqual(destination('python tutorial'),{kind:'search',query:'python tutorial'});
 assert.deepEqual(destination('python.org'),{kind:'web',url:'https://python.org/'});
 assert.deepEqual(destination('veil://newtab'),{kind:'home'});
 assert.equal(publicURL('http://example.com/x?q=a'),'https://example.com/x?q=a');
});
test('private addresses, URL tricks, credentials, and unsafe protocols are blocked',()=>{
 for(const u of ['http://127.0.0.1/','https://2130706433/','https://0x7f000001/','https://[::1]/','https://localhost/','https://router.local/','https://x.internal/','https://example.com:9050/','https://user:pass@example.com/','file:///etc/passwd','javascript:alert(1)','https://example.com\\@127.0.0.1/','https://example.com\n'])assert.throws(()=>publicURL(u),u);
});
test('remote requests cannot reach the local app and local requests cannot reach the internet',()=>{
 assert.equal(remoteAllowed('http://127.0.0.1:8787/api/search'),false);
 assert.equal(localAllowed('https://example.com'),false);
 assert.equal(localAllowed('http://127.0.0.1:8787/api/search'),true);
 assert.equal(localAllowed('http://127.0.0.1:8787.evil.com'),false);
 assert.equal(remoteAllowed('wss://example.com/socket'),true);
 assert.equal(remoteAllowed('ws://example.com/socket'),false);
});
test('extensions are restricted to loaded IDs and proxy has no bypass or direct fallback',()=>{
 const id='a'.repeat(32);assert.equal(remoteAllowed(`chrome-extension://${id}/home.html`),false);
 assert.equal(remoteAllowed(`chrome-extension://${id}/home.html`,[id]),true);
 assert.equal(PROXY.mode,'fixed_servers');assert.equal(PROXY.proxyRules,'socks5://127.0.0.1:9060');assert.equal(PROXY.proxyBypassRules,'<-loopback>');
});
test('imported customization cannot change routing or introduce remote wallpaper URLs',()=>{
 const s=settings({proxyRules:'direct://',wallpaper:'https://tracker.example.com/a.png',fontSize:999,accent:'url(https://x)',shortcuts:[{name:'Bad',url:'file:///x'},{name:'Python',url:'https://python.org'}]});
 assert.equal(s.proxyRules,undefined);assert.equal(s.wallpaper,'');assert.equal(s.fontSize,32);assert.equal(s.accent,'#a8e6cf');assert.equal(s.shortcuts.length,1);
});
