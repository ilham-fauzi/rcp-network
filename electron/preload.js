const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  validateSudoPassword: (password) => ipcRenderer.invoke('validate-sudo-password', password),
  checkVpnDirectory: () => ipcRenderer.invoke('check-vpn-directory'),
  checkSudoPassword: () => ipcRenderer.invoke('check-sudo-password'),
  checkOpenVpnInstalled: () => ipcRenderer.invoke('check-openvpn-installed'),
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
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});

