// @ts-nocheck -- plain CommonJS preload; parameter types are enforced by the IPC contract in main.ts
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    selectFiles: (purpose) => invoke('desktop:selectFiles', purpose),
    selectFolder: () => ipcRenderer.invoke('desktop:selectFolder'),
    openExternal: (url) => invoke('desktop:openExternal', url),
    request: (args) => invoke('declgen:request', args),
    upload: (args) => invoke('declgen:upload', args),
    download: (args) => invoke('declgen:download', args),
  }),
);
