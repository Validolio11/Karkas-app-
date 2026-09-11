const { contextBridge, ipcRenderer, webFrame } = require('electron');

const MIN_ZOOM_FACTOR = 0.75;
const MAX_ZOOM_FACTOR = 1.5;
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function setZoomFactor(factor) {
  const numericFactor = Number(factor);
  if (!Number.isFinite(numericFactor)) return;
  webFrame.setZoomFactor(Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, numericFactor)));
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('karkasDesktop', {
  isDesktop: true,
  window: {
    minimize: () => ipcRenderer.send('karkas:window:minimize'),
    toggleMaximize: () => ipcRenderer.send('karkas:window:toggle-maximize'),
    hide: () => ipcRenderer.send('karkas:window:hide'),
    quit: () => invoke('karkas:window:quit'),
    getState: () => invoke('karkas:window:get-state'),
    setZoomFactor,
    onStateChanged: (callback) => subscribe('karkas:window:state', callback),
    onCommand: (callback) => subscribe('karkas:command', callback),
  },
  workspace: {
    loadAccount: (ownerId) => invoke('karkas:workspace:load-account', { ownerId }),
    saveAccount: (input) => invoke('karkas:workspace:save-account', input),
    getActiveOwner: () => invoke('karkas:workspace:get-active-owner'),
    setActiveOwner: (ownerId) => invoke('karkas:workspace:set-active-owner', { ownerId }),
    createRecoveryPoint: (ownerId) => invoke('karkas:workspace:create-recovery', { ownerId }),
    stageSync: (input) => invoke('karkas:workspace:stage-sync', input),
    claimSync: (ownerId, bypassBackoff = false) => invoke('karkas:workspace:claim-sync', { ownerId, bypassBackoff }),
    markSyncFailed: (input) => invoke('karkas:workspace:mark-sync-failed', input),
    acknowledgeSync: (input) => invoke('karkas:workspace:ack-sync', input),
    replaceWithCloud: (input) => invoke('karkas:workspace:replace-with-cloud', input),
  },
  preferences: {
    get: () => invoke('karkas:preferences:get'),
    update: (changes) => invoke('karkas:preferences:update', changes),
  },
  auth: {
    loginWithGoogle: () => invoke('karkas:auth:google-login'),
  },
  ai: {
    hasKey: () => invoke('karkas:ai:has-key'),
    verifyAndStoreKey: (apiKey) => invoke('karkas:ai:verify-key', { apiKey }),
    clearKey: () => invoke('karkas:ai:clear-key'),
    assist: (input) => invoke('karkas:ai:assist', input),
    breakdown: (input) => invoke('karkas:ai:breakdown', input),
    recommendations: (input) => invoke('karkas:ai:recommendations', input),
    transcribeAudio: (input) => invoke('karkas:ai:transcribe-audio', input),
  },
  updates: {
    checkLatest: () => invoke('karkas:updates:check'),
    downloadAndInstall: (input) => invoke('karkas:updates:install', input),
  },
  system: {
    openExternal: (url) => invoke('karkas:system:open-external', { url }),
    showNotification: (input) => invoke('karkas:system:notify', input),
    getStartupEnabled: () => invoke('karkas:system:get-startup'),
    setStartupEnabled: (enabled) => invoke('karkas:system:set-startup', { enabled }),
  },
});
