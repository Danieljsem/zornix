const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  // live
  getCameras: () => ipcRenderer.invoke('get-cameras'),
  showCameras: (ips, quality) => ipcRenderer.invoke('show-cameras', { ips, quality }),
  fullscreenCamera: (ip) => ipcRenderer.invoke('fullscreen-camera', { ip }),
  // nvr / config
  getNvrConfig: () => ipcRenderer.invoke('get-nvr-config'),
  saveNvrConfig: (cfg) => ipcRenderer.invoke('save-nvr-config', cfg),
  testNvr: () => ipcRenderer.invoke('test-nvr'),
  // playback
  playbackQuery: (ip, date) => ipcRenderer.invoke('playback-query', { ip, date }),
  playbackStart: (id, ip, startTime, endTime, speed) => ipcRenderer.invoke('playback-start', { id, ip, startTime, endTime, speed }),
  playbackStop: (id) => ipcRenderer.invoke('playback-stop', { id }),
  // misc
  saveSnapshot: (dataUrl, suggestedName) => ipcRenderer.invoke('save-snapshot', { dataUrl, suggestedName }),
});
