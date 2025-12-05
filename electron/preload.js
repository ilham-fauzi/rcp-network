const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  validateSudoPassword: (password) => ipcRenderer.invoke('validate-sudo-password', password),
  checkVpnDirectory: () => ipcRenderer.invoke('check-vpn-directory'),
  checkSudoPassword: () => ipcRenderer.invoke('check-sudo-password'),
  connectVpn: (data) => ipcRenderer.invoke('connect-vpn', data),
  disconnectVpn: (serverId) => ipcRenderer.invoke('disconnect-vpn', serverId),
  deleteVpnFile: (filePath) => ipcRenderer.invoke('delete-vpn-file', filePath),
  renameVpnFile: (filePath, newName) => ipcRenderer.invoke('rename-vpn-file', filePath, newName),
});

