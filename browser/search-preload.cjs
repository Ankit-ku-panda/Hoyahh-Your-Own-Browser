'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veilDesktop', {
  open: url => ipcRenderer.invoke('veil:open-result', url),
  onSearch: callback => { ipcRenderer.on('veil:search', (_event, query) => callback(query)); }
});
