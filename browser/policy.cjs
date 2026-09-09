'use strict';
const { isIP } = require('node:net');
const HOME = 'http://127.0.0.1:8787';
const PROXY = Object.freeze({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:9060', proxyBypassRules: '<-loopback>' });
function publicURL(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(value)) throw Error('Enter a public website address.');
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || isIP(h.replace(/^\[|\]$/g, '')) || !h.includes('.') || h.endsWith('.') || /\.(localhost|local|lan|internal|home|test|invalid|example)$/.test(h) || !h.split('.').every(x => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))) throw Error('Only public websites on standard HTTP/HTTPS ports are supported.');
  if (u.protocol === 'http:' && !h.endsWith('.onion')) u.protocol = 'https:';
  return u.href;
}
function remoteAllowed(value, extensionIDs = []) {
  try {
    const u = new URL(value);
    if (u.protocol === 'chrome-extension:') return extensionIDs.includes(u.hostname);
    if (['data:', 'blob:'].includes(u.protocol)) return true;
    if (u.protocol === 'wss:') { const h = new URL(u.href); h.protocol='https:'; return publicURL(h.href)===h.href; }
    return publicURL(value) === u.href;
  } catch { return false; }
}
function localAllowed(value) {
  try { return new URL(value).origin === HOME; } catch { return false; }
}
function destination(value) {
  const text = String(value || '').trim().slice(0, 8192);
  if (!text || ['hoyahh://newtab','veil://newtab'].includes(text)) return { kind: 'home' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return { kind: 'web', url: publicURL(text) };
  if (!/\s/.test(text) && text.includes('.')) return { kind: 'web', url: publicURL('https://' + text) };
  return { kind: 'search', query: text.slice(0, 500) };
}
const defaults = { name: '', accent: '#a8e6cf', background: '#101815', text: '#edf6ef', font: 'Segoe UI', fontSize: 16, radius: 28, clock24: false, showClock: true, showNotes: true, layout: 'balanced', css: '', wallpaper: '', notes: '', shortcuts: [{ name: 'Wikipedia', url: 'https://www.wikipedia.org/' }, { name: 'Python', url: 'https://www.python.org/' }], newTabExtension: '' };
function settings(input = {}) {
  const out = { ...defaults };
  for (const k of ['accent','background','text']) if (/^#[0-9a-f]{6}$/i.test(input[k])) out[k] = input[k];
  for (const k of ['name','font','notes','css']) if (typeof input[k] === 'string') out[k] = input[k].slice(0, k === 'css' ? 100000 : k === 'notes' ? 50000 : 100);
  for (const [k,min,max] of [['fontSize',12,32],['radius',0,64]]) if (Number.isFinite(Number(input[k]))) out[k] = Math.max(min,Math.min(max,Number(input[k])));
  for (const k of ['clock24','showClock','showNotes']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (['balanced','centered','wide'].includes(input.layout)) out.layout=input.layout;
  if (typeof input.wallpaper === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.wallpaper) && input.wallpaper.length < 16000000) out.wallpaper=input.wallpaper;
  if (typeof input.newTabExtension === 'string' && /^[a-p]{32}$/.test(input.newTabExtension)) out.newTabExtension=input.newTabExtension;
  if (Array.isArray(input.shortcuts)) out.shortcuts=input.shortcuts.flatMap(x=>{try{return [{name:String(x.name||'Link').slice(0,80),url:publicURL(x.url)}];}catch{return [];}});
  return out;
}
module.exports = { HOME, PROXY, publicURL, remoteAllowed, localAllowed, destination, defaults, settings };
