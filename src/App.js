import React, { useState, useEffect } from 'react';
import ServerList from './components/ServerList';
import ConnectionControl from './components/ConnectionControl';
import SudoPasswordDialog from './components/SudoPasswordDialog';
import RenameDialog from './components/RenameDialog';
import OpenVpnWarning from './components/OpenVpnWarning';

// Storage utility
const STORAGE_KEY = 'vpn-servers';
const SUDO_PASSWORD_CHECKED_KEY = 'sudo-password-checked';

const loadServers = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('Error loading servers:', error);
    return [];
  }
};

const saveServers = (servers) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch (error) {
    console.error('Error saving servers:', error);
  }
};

const hasSudoPasswordBeenChecked = () => {
  try {
    return localStorage.getItem(SUDO_PASSWORD_CHECKED_KEY) === 'true';
  } catch (error) {
    return false;
  }
};

const setSudoPasswordChecked = () => {
  try {
    localStorage.setItem(SUDO_PASSWORD_CHECKED_KEY, 'true');
  } catch (error) {
    console.error('Error saving sudo password check status:', error);
  }
};

function App() {
  const [selectedServer, setSelectedServer] = useState(null);
  const [servers, setServers] = useState([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showSudoDialog, setShowSudoDialog] = useState(false);
  const [sudoPasswordValidated, setSudoPasswordValidated] = useState(false);
  const [connectedServers, setConnectedServers] = useState(new Set()); // Track connected server IDs
  const [serverConnectionDetails, setServerConnectionDetails] = useState({}); // Track details like startTime
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [serverToRename, setServerToRename] = useState(null);
  const [triggerConnect, setTriggerConnect] = useState(null); // Trigger connection from list
  const [openvpnStatus, setOpenvpnStatus] = useState({ installed: true, checking: true, platform: null, installationGuide: null });

  // Load servers from storage on mount
  useEffect(() => {
    const loadedServers = loadServers();
    setServers(loadedServers);
    setIsInitialLoad(false);

    // Setup Electron listeners and checks
    const setupElectron = async () => {
      if (!window.electronAPI) return;

      // 1. Check Directory/Password
      try {
        const dirStatus = await window.electronAPI.checkVpnDirectory();
        const passwordValid = await window.electronAPI.checkSudoPassword();
        if (!dirStatus.exists || !passwordValid) {
          setShowSudoDialog(true);
        } else {
          setSudoPasswordValidated(true);
        }
      } catch (error) {
        setShowSudoDialog(true);
      }

      // 2. Sync Active Connections
      try {
        const active = await window.electronAPI.getActiveConnections();
        if (active) {
            const newConnected = new Set();
            const newDetails = {};
            Object.entries(active).forEach(([id, info]) => {
                newConnected.add(Number(id)); // Assuming ID is number
                newDetails[Number(id)] = info;
            });
            // Also handle string IDs if used
            Object.entries(active).forEach(([id, info]) => {
                 if (isNaN(id)) {
                    newConnected.add(id);
                    newDetails[id] = info;
                 }
            });
            
            setConnectedServers(newConnected);
            setServerConnectionDetails(newDetails);
        }
      } catch (error) {
        console.error('Failed to sync connections:', error);
      }

      // 3. Listen for disconnection events
      window.electronAPI.onVpnDisconnected((event, { serverId, reason }) => {
         console.log(`Server ${serverId} disconnected: ${reason}`);
         setConnectedServers(prev => {
             const newSet = new Set(prev);
             newSet.delete(serverId);
             return newSet;
         });
         setServerConnectionDetails(prev => {
             const newDetails = { ...prev };
             delete newDetails[serverId];
             return newDetails;
         });
      });
    };

    setupElectron();
    
    // Check OpenVPN installation
    const checkOpenVpn = async () => {
      if (!window.electronAPI) {
        setOpenvpnStatus({ installed: true, checking: false, platform: null, installationGuide: null });
        return;
      }

      try {
        setOpenvpnStatus(prev => ({ ...prev, checking: true }));
        const result = await window.electronAPI.checkOpenVpnInstalled();
        setOpenvpnStatus({
          installed: result.installed,
          checking: false,
          platform: result.platform,
          installationGuide: result.installationGuide
        });
      } catch (error) {
        console.error('Error checking OpenVPN:', error);
        setOpenvpnStatus({
          installed: false,
          checking: false,
          platform: 'Unknown',
          installationGuide: 'https://openvpn.net/community-downloads/'
        });
      }
    };

    checkOpenVpn();
    
    return () => {
       if (window.electronAPI) {
         window.electronAPI.removeAllListeners('vpn-disconnected');
       }
    };
  }, []);

  // Save servers to storage whenever servers change (but not on initial load)
  useEffect(() => {
    if (!isInitialLoad) {
      saveServers(servers);
    }
  }, [servers, isInitialLoad]);

  const handleServerSelect = (server) => {
    setSelectedServer(server);
  };

  const handleAddProfile = async () => {
    try {
      setIsLoading(true);
      setIsProcessingFile(true);
      
      // Check if Electron API is available
      if (!window.electronAPI) {
        console.error('Electron not available');
        alert('This feature requires Electron. Please run the desktop app.');
        setIsLoading(false);
        setIsProcessingFile(false);
        return;
      }

      const result = await window.electronAPI.openFileDialog();

      setIsLoading(false);
      setIsProcessingFile(false);

      if (result.canceled) {
        return;
      }

      if (result.error) {
        alert(`Error: ${result.error}`);
        return;
      }

      // File has been processed, automatically add to server list
      const newServer = {
        id: Date.now() + Math.random(), // Generate unique ID
        name: result.fileName,
        filePath: result.filePath,
        status: 'disconnected',
        createdAt: new Date().toISOString(),
      };

      // Add server to list
      setServers((prevServers) => [newServer, ...prevServers]);

      // Show success message if file was modified
      if (result.processed) {
        console.log('File processed: Removed unwanted configs');
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
      setIsLoading(false);
      setIsProcessingFile(false);
      alert(`Error: ${error.message}`);
    }
  };


  const handleDeleteServer = async (server) => {
    try {
      if (!window.electronAPI) {
        alert('This feature requires Electron. Please run the desktop app.');
        return;
      }

      // Delete file from filesystem
      const result = await window.electronAPI.deleteVpnFile(server.filePath);
      
      if (result.success) {
        // Remove server from list
        setServers((prevServers) => prevServers.filter(s => s.id !== server.id));
        
        // If deleted server was selected, clear selection
        if (selectedServer && selectedServer.id === server.id) {
          setSelectedServer(null);
        }
      } else {
        alert(`Failed to delete file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting server:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleDeleteAll = () => {
    if (servers.length === 0) {
      return;
    }

    // Confirm deletion
    if (window.confirm(`Are you sure you want to delete all ${servers.length} server(s)? This will remove them from the list.`)) {
      // Clear all servers from list (regardless of file existence)
      setServers([]);
      setSelectedServer(null);
    }
  };

  const handleRenameServer = (server) => {
    setServerToRename(server);
    setShowRenameDialog(true);
  };

  const handleRenameSubmit = async (newName) => {
    if (!serverToRename) return;

    try {
      if (!window.electronAPI) {
        alert('Electron API not available. Cannot rename file.');
        setShowRenameDialog(false);
        setServerToRename(null);
        return;
      }

      const result = await window.electronAPI.renameVpnFile(serverToRename.filePath, newName);
      
      if (result.success) {
        // Update server name in list
        setServers((prevServers) =>
          prevServers.map((s) =>
            s.id === serverToRename.id
              ? { ...s, name: newName, filePath: result.newFilePath }
              : s
          )
        );
        
        // Update selected server if it's the renamed one
        if (selectedServer && selectedServer.id === serverToRename.id) {
          setSelectedServer({
            ...selectedServer,
            name: newName,
            filePath: result.newFilePath
          });
        }

        setShowRenameDialog(false);
        setServerToRename(null);
      } else {
        alert(`Failed to rename file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error renaming server:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleRenameCancel = () => {
    setShowRenameDialog(false);
    setServerToRename(null);
  };

  const handleConnectServer = async (server) => {
    // Select the server first
    setSelectedServer(server);
    
    // Trigger connection - this will show auth dialog in ConnectionControl
    // Use setTimeout to ensure selectedServer is set first
    setTimeout(() => {
      setTriggerConnect(server.id);
      // Reset trigger after dialog is shown
      setTimeout(() => {
        setTriggerConnect(null);
      }, 200);
    }, 50);
  };

  const handleDisconnectServer = async (server) => {
    try {
      if (!window.electronAPI) {
        alert('Electron API not available. Cannot disconnect.');
        return;
      }

      const result = await window.electronAPI.disconnectVpn(server.id);
      
      if (result.success) {
        // Update connected servers
        setConnectedServers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(server.id);
          return newSet;
        });
        setServerConnectionDetails(prev => {
             const newDetails = { ...prev };
             delete newDetails[server.id];
             return newDetails;
        });
      } else {
        alert(`Failed to disconnect: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error disconnecting server:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleSudoPasswordSubmit = (password) => {
    // Password has been validated by the dialog component
    setSudoPasswordValidated(true);
    setShowSudoDialog(false);
    setSudoPasswordChecked();
  };

  const handleSudoPasswordCancel = () => {
    // User cancelled, but we still allow them to use the app
    // In production, you might want to exit the app here
    setShowSudoDialog(false);
    setSudoPasswordChecked(); // Mark as checked so dialog doesn't show again
  };

  const handleCheckOpenVpnAgain = async () => {
    if (!window.electronAPI) return;
    
    try {
      setOpenvpnStatus(prev => ({ ...prev, checking: true }));
      const result = await window.electronAPI.checkOpenVpnInstalled();
      setOpenvpnStatus({
        installed: result.installed,
        checking: false,
        platform: result.platform,
        installationGuide: result.installationGuide
      });
    } catch (error) {
      console.error('Error checking OpenVPN:', error);
    }
  };

  return (
    <>
      <div className="h-screen w-screen flex bg-gray-900 overflow-hidden">
        {/* OpenVPN Warning Banner */}
        {!openvpnStatus.installed && !openvpnStatus.checking && (
          <div className="absolute top-0 left-0 right-0 z-50 px-4 pt-4">
            <OpenVpnWarning
              isVisible={true}
              platform={openvpnStatus.platform}
              installationGuide={openvpnStatus.installationGuide}
              onCheckAgain={handleCheckOpenVpnAgain}
            />
          </div>
        )}
        
        {/* Sidebar - 25-30% width */}
        <div className="w-1/4 min-w-[280px] max-w-[320px] border-r border-gray-800">
        <ServerList
          servers={servers}
          onServerSelect={handleServerSelect}
          onAddProfile={handleAddProfile}
          onDeleteServer={handleDeleteServer}
          onDeleteAll={handleDeleteAll}
          onRenameServer={handleRenameServer}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          connectedServers={connectedServers}
          serverConnectionDetails={serverConnectionDetails}
          isLoading={isLoading}
          isProcessingFile={isProcessingFile}
        />
        </div>

        {/* Main Content - Remaining width */}
        <div className="flex-1 overflow-hidden">
          <ConnectionControl 
            selectedServer={selectedServer} 
            connectedServers={connectedServers}
            triggerConnect={triggerConnect}
            openvpnInstalled={openvpnStatus.installed}
            connectionStartTime={selectedServer && serverConnectionDetails[selectedServer.id] ? serverConnectionDetails[selectedServer.id].startTime : null}
            onConnectionChange={(serverId, isConnected) => {
              setConnectedServers(prev => {
                const newSet = new Set(prev);
                if (isConnected) {
                  newSet.add(serverId);
                } else {
                  newSet.delete(serverId);
                }
                return newSet;
              });
              
              if (isConnected) {
                  setServerConnectionDetails(prev => ({
                      ...prev,
                      [serverId]: { startTime: Date.now() }
                  }));
              } else {
                  setServerConnectionDetails(prev => {
                      const newDetails = { ...prev };
                      delete newDetails[serverId];
                      return newDetails;
                  });
              }
              
              // Note: We don't update server.status here because we use connectedServers Set
              // to determine connection status, which is more reliable for multiple connections
            }}
          />
        </div>
      </div>

      {/* Sudo Password Dialog */}
      <SudoPasswordDialog
        isVisible={showSudoDialog}
        onPasswordSubmit={handleSudoPasswordSubmit}
        onCancel={handleSudoPasswordCancel}
      />

      {/* Rename Dialog */}
      <RenameDialog
        isVisible={showRenameDialog}
        currentName={serverToRename?.name || ''}
        onRename={handleRenameSubmit}
        onCancel={handleRenameCancel}
      />
      
      {/* Update Notification */}
      <UpdateNotification />
    </>
  );
}

const UpdateNotification = () => {
  const [status, setStatus] = useState(null); // 'available', 'downloading', 'downloaded', 'error'
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onUpdateAvailable(() => {
        setStatus('available');
    });

    window.electronAPI.onUpdateProgress((event, progressObj) => {
        setStatus('downloading');
        setProgress(Math.round(progressObj.percent));
    });

    window.electronAPI.onUpdateDownloaded(() => {
        setStatus('downloaded');
    });

    window.electronAPI.onUpdateError((event, message) => {
        // Only show if we were actually doing something
        if (status) {
            setStatus('error');
            setErrorMsg(message);
            // Auto hide error after 5s
            setTimeout(() => setStatus(null), 5000);
        }
    });
    
    return () => {
         window.electronAPI.removeAllListeners('update-available');
         window.electronAPI.removeAllListeners('update-progress');
         window.electronAPI.removeAllListeners('update-downloaded');
         window.electronAPI.removeAllListeners('update-error');
    }
  }, [status]); // Add status dependency to handle error logic correctly if needed, though mostly independent

  if (!status) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg bg-gray-800 text-white border border-gray-700 w-80 animate-fade-in-up">
        <div className="flex items-start gap-3">
             <div className="mt-1">
                 {status === 'available' && (
                     <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                 )}
                 {status === 'downloading' && (
                     <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                 )}
                 {status === 'downloaded' && (
                     <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                 )}
                 {status === 'error' && (
                     <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 )}
             </div>
             <div className="flex-1">
                 {status === 'available' && (
                     <div>
                         <h4 className="font-semibold text-sm">Update Available</h4>
                         <p className="text-xs text-gray-400 mt-1">Starting download...</p>
                     </div>
                 )}
                 {status === 'downloading' && (
                     <div>
                         <h4 className="font-semibold text-sm">Downloading Update...</h4>
                         <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                             <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                         </div>
                         <p className="text-xs text-right text-gray-400 mt-1">{progress}%</p>
                     </div>
                 )}
                 {status === 'downloaded' && (
                     <div>
                         <h4 className="font-semibold text-sm">Update Ready</h4>
                         <p className="text-xs text-gray-400 mt-1">Restart to install update.</p>
                     </div>
                 )}
                 {status === 'error' && (
                     <div>
                         <h4 className="font-semibold text-sm">Update Failed</h4>
                         <p className="text-xs text-red-300 mt-1">{errorMsg}</p>
                     </div>
                 )}
             </div>
             {status === 'downloaded' && (
                 <button onClick={() => window.close()} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors">
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
             )}
        </div>
    </div>
  );
};

export default App;

