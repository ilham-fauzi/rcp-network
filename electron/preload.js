const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  checkVpnDirectory: () => ipcRenderer.invoke('check-vpn-directory'),
  checkOpenVpnInstalled: () => ipcRenderer.invoke('check-openvpn-installed'),
  installOpenVpn: () => ipcRenderer.invoke('install-openvpn'),
  connectVpn: (data) => ipcRenderer.invoke('connect-vpn', data),
  disconnectVpn: (serverId) => ipcRenderer.invoke('disconnect-vpn', serverId),
  deleteVpnFile: (filePath) => ipcRenderer.invoke('delete-vpn-file', filePath),
  renameVpnFile: (filePath, newName) => ipcRenderer.invoke('rename-vpn-file', filePath, newName),
  getAllConfigs: () => ipcRenderer.invoke('get-all-configs'),
  getActiveConnections: () => ipcRenderer.invoke('get-active-connections'),
  onVpnConnected: (callback) => ipcRenderer.on('vpn-connected', callback),
  onVpnTraffic: (callback) => ipcRenderer.on('vpn-traffic', callback),
  onVpnLog: (callback) => ipcRenderer.on('vpn-log', callback),
  onVpnDisconnected: (callback) => ipcRenderer.on('vpn-disconnected', callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  // In-app updates
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  openUpdatePage: () => ipcRenderer.invoke('update-open-page'),
  getUpdateState: () => ipcRenderer.invoke('update-get-state'),
  getAutoUpdateCheck: () => ipcRenderer.invoke('get-auto-update-check'),
  setAutoUpdateCheck: (value) => ipcRenderer.invoke('set-auto-update-check', value),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  enableAwakeMode: (duration) => ipcRenderer.invoke('enable-awake-mode', duration),
  disableAwakeMode: () => ipcRenderer.invoke('disable-awake-mode'),
  onAwakeStatusChange: (callback) => ipcRenderer.on('awake-status-change', callback),
  // VPN Credential Storage
  saveVpnCredentials: (filename, credentials) => ipcRenderer.invoke('save-vpn-credentials', filename, credentials),
  loadVpnCredentials: (filename) => ipcRenderer.invoke('load-vpn-credentials', filename),
  deleteVpnCredentials: (filename) => ipcRenderer.invoke('delete-vpn-credentials', filename),
  bulkSaveVpnCredentials: (credentials) => ipcRenderer.invoke('bulk-save-vpn-credentials', credentials),
  // Timer Preference
  getTimerPreference: () => ipcRenderer.invoke('get-timer-preference'),
  setTimerPreference: (value) => ipcRenderer.invoke('set-timer-preference', value),
  // New: Event-driven API (Push-based)
  on: (channel, callback) => {
    const validChannels = [
      'vpn-traffic',
      'preference-changed',
      'vpn-connected',
      'vpn-disconnected',
      'awake-status-change',
      'vpn-log',
      'vpn-tick',
      'update-state'
    ];
    if (validChannels.includes(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return subscription; // Return context for removal
    }
  },
  removeListener: (channel, subscription) => {
    ipcRenderer.removeListener(channel, subscription);
  },
  onInstallProgress: (callback) => {
    const subscription = (event, progress) => callback(progress);
    ipcRenderer.on('install-progress', subscription);
    return () => ipcRenderer.removeListener('install-progress', subscription);
  },
});
