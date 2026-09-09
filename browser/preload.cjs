'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veil', {
  command: (action, data) => ipcRenderer.invoke('veil:command', action, data),
  onState: callback => { ipcRenderer.on('veil:state', (_event, data) => callback(data)); },
  onShortcut: callback => { ipcRenderer.on('veil:shortcut', (_event, name) => callback(name)); }
});
