import React, { useState, useEffect } from 'react';
import ServerList from './components/ServerList';
import ConnectionControl from './components/ConnectionControl';
import RenameDialog from './components/RenameDialog';
import OpenVpnWarning from './components/OpenVpnWarning';
import { UpdateBanner } from './components/UpdateSection';

// Storage utility
const STORAGE_KEY = 'vpn-servers';

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

function App() {
  const [selectedServer, setSelectedServer] = useState(null);
  const [servers, setServers] = useState([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [connectedServers, setConnectedServers] = useState(new Set()); // Track connected server IDs
  const [serverConnectionDetails, setServerConnectionDetails] = useState({}); // Track details like startTime
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [serverToRename, setServerToRename] = useState(null);
  const [triggerConnect, setTriggerConnect] = useState(null); // Trigger connection from list
  const [openvpnStatus, setOpenvpnStatus] = useState({ installed: true, checking: true, platform: null, installationGuide: null });

  // Load servers from filesystem on mount (and setup listeners)
  useEffect(() => {
    // Note: We don't load from localStorage anymore for the list itself, 
    // but maybe we could store user preferences (like custom names) if we wanted.
    // For now, file system is source of truth.

    // Setup Electron listeners and checks
    const setupElectron = async () => {
      if (!window.electronAPI) return;

      // 0. Load Configs from Disk
      try {
          const configs = await window.electronAPI.getAllConfigs();
          // Transform if needed, but the object structure from main { id, name, filePath } matches what we need
          const formattedConfigs = configs.map(c => ({
              ...c, 
              status: 'disconnected', // Default, will update below
              createdAt: new Date().toISOString() // Placeholder
          }));
          setServers(formattedConfigs);
          setIsInitialLoad(false);
      } catch (err) {
          console.error("Failed to load configs:", err);
      }

      // 1. Sync Active Connections
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

      // 2. Listen for disconnection events
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

      // 3. Listen for connection events (e.g. from Tray)
      if (window.electronAPI.onVpnConnected) {
          window.electronAPI.onVpnConnected((event, { serverId, startTime }) => {
             console.log(`Server ${serverId} connected`);
             setConnectedServers(prev => {
                 const newSet = new Set(prev);
                 newSet.add(serverId);
                 // Also ensure it is added for numbers/strings match
                 if (!isNaN(serverId)) newSet.add(Number(serverId));
                 return newSet;
             });
             setServerConnectionDetails(prev => ({
                 ...prev,
                 [serverId]: { startTime: startTime }
             }));
             // Also update for number/string match
             if (!isNaN(serverId)) {
                 setServerConnectionDetails(prev => ({
                     ...prev,
                     [Number(serverId)]: { startTime: startTime }
                 }));
             }
          });
      }
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
         if (window.electronAPI.onVpnConnected) {
             window.electronAPI.removeAllListeners('vpn-connected');
         }
       }
    };
  }, []);

  // Remove localStorage sync for servers list as we rely on file system now
  // keeping the useEffect hook structure if checking other things, or just delete it.
  // actually, let's delete the localStorage logic to avoid confusion.

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
      // File has been processed
      
      // Refresh list from backend to ensure we have the correct file ID/path
      const configs = await window.electronAPI.getAllConfigs();
      const formattedConfigs = configs.map(c => ({
          ...c, 
          status: 'disconnected', 
          createdAt: new Date().toISOString()
      }));
      setServers(formattedConfigs);

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
        // Refresh list
        const configs = await window.electronAPI.getAllConfigs();
        const formattedConfigs = configs.map(c => ({
            ...c, 
            status: 'disconnected', 
            createdAt: new Date().toISOString()
        }));
        setServers(formattedConfigs);
        
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
        // Refresh list
        const configs = await window.electronAPI.getAllConfigs();
        const formattedConfigs = configs.map(c => ({
            ...c, 
            status: 'disconnected', 
            createdAt: new Date().toISOString()
        }));
        setServers(formattedConfigs);
        
        // Update selected server if it's the renamed one. 
        // Note: ID (filename) might have changed if name changed filename!
        // The backend `renameVpnFile` basically renames the file.
        // So the old ID is gone.
        // We find the new server by the new filename (which is derived from name)
        // But `result.newName` gives us the sanitized name.
        // New ID should be `${result.newName}.ovpn`
        
        const newId = `${result.newName}.ovpn`;
        const newServerObj = formattedConfigs.find(s => s.id === newId);

        if (selectedServer && selectedServer.id === serverToRename.id) {
          setSelectedServer(newServerObj || null);
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

  const handleInstallOpenVpn = async () => {
    if (!window.electronAPI || !window.electronAPI.installOpenVpn) return { success: false };

    const result = await window.electronAPI.installOpenVpn();
    if (result.success) {
      await handleCheckOpenVpnAgain();
    } else if (result.needsManualInstall && result.guide) {
      setOpenvpnStatus(prev => ({ ...prev, installationGuide: result.guide }));
    }
    return result;
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
              onInstall={openvpnStatus.platform === 'macOS' ? handleInstallOpenVpn : null}
            />
          </div>
        )}
        
        {/* Sidebar - 25-30% width */}
        <div className="w-1/4 min-w-[280px] max-w-[320px] border-r border-gray-800">
        <ServerList
          servers={servers}
          selectedServer={selectedServer}
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

      {/* Rename Dialog */}
      <RenameDialog
        isVisible={showRenameDialog}
        currentName={serverToRename?.name || ''}
        onRename={handleRenameSubmit}
        onCancel={handleRenameCancel}
      />
      
      {/* Update banner (newer version found) */}
      <UpdateBanner />
    </>
  );
}

export default App;

