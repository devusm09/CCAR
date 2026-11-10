const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  clearKey: () => ipcRenderer.invoke('settings:clearKey'),
  listModels: (apiKeyOverride) => ipcRenderer.invoke('models:list', apiKeyOverride),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  listHistory: () => ipcRenderer.invoke('history:list'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  listQuestions: () => ipcRenderer.invoke('questions:list'),
  upsertQuestion: (rec) => ipcRenderer.invoke('questions:upsert', rec),
  clearQuestions: () => ipcRenderer.invoke('questions:clear'),
  listUsage: () => ipcRenderer.invoke('usage:list'),
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  listBank: () => ipcRenderer.invoke('bank:list'),
  getLearn: () => ipcRenderer.invoke('learn:get'),
  generateBank: (payload) => ipcRenderer.invoke('bank:generate', payload),
  pollBank: () => ipcRenderer.invoke('bank:poll'),
  cancelBank: (id) => ipcRenderer.invoke('bank:cancel', id),
  clearBank: () => ipcRenderer.invoke('bank:clear'),
  exportBank: () => ipcRenderer.invoke('bank:export'),
  importBank: () => ipcRenderer.invoke('bank:import'),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (state) => ipcRenderer.invoke('session:save', state),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  send: (payload) => ipcRenderer.invoke('chat:send', payload),
  abort: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  onMessage: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('chat:message', fn);
    return () => ipcRenderer.removeListener('chat:message', fn);
  },
  onDelta: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('chat:delta', fn);
    return () => ipcRenderer.removeListener('chat:delta', fn);
  },
});
