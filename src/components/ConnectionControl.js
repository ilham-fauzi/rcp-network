import React, { useState, useEffect, useCallback } from 'react';
import VpnAuthDialog from './VpnAuthDialog';
import TrafficChart from './TrafficChart';


const ConnectionControl = ({ selectedServer, connectedServers, onConnectionChange, triggerConnect, openvpnInstalled = true, connectionStartTime }) => {
  const isConnected = selectedServer ? connectedServers.has(selectedServer.id) : false;
  const [isConnecting, setIsConnecting] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [stats, setStats] = useState({
    download: '0 MB/s',
    upload: '0 MB/s',
    latency: '-- ms',
    ipAddress: '--',
  });
  const [logs, setLogs] = useState([]);
  const [savedEmail, setSavedEmail] = useState(null);
  const [savedPassword, setSavedPassword] = useState(null);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [appVersion, setAppVersion] = useState('1.0.0');

  useEffect(() => {
     if (window.electronAPI) {
         window.electronAPI.getAppVersion().then(setAppVersion).catch(console.error);
         
         // Listen for real-time logs
         if (window.electronAPI.onVpnLog) {
             window.electronAPI.onVpnLog((event, { serverId, message }) => {
                 // Update logs if this log belongs to the selected server OR if it's general
                 // For now, if we are connected/connecting to a server, we generally want to see its logs.
                 // We can filter by serverId if needed.
                 if (selectedServer && (serverId === selectedServer.id || serverId === String(selectedServer.id) || Number(serverId) === selectedServer.id)) {
                      addLog(message.trim());
                 }
                 // If no server selected, maybe don't show? Or show all?
                 // Current UI is server-centric.
             });
         }
     }
     
     return () => {
         if (window.electronAPI) {
             window.electronAPI.removeAllListeners('vpn-log');
         }
     };
  }, [selectedServer]); // Re-bind listener when selectedServer changes? No, listener is global. 
  // Better to keep listener constant and check ref or selectedServer inside? 
  // React state in listener: closure issue.
  // Let's rely on standard state update pattern `setLogs` which doesn't need deps.
  // But filtering by `selectedServer` needs it.
  // So include selectedServer in deps.



  // Load saved email and password for selected server
  useEffect(() => {
    if (selectedServer) {
      const cacheKey = `vpn_auth_${selectedServer.id}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const authData = JSON.parse(cached);
          if (authData.emailSaved) {
            setSavedEmail(authData.email);
          } else {
            setSavedEmail(null);
          }
          if (authData.passwordSaved && authData.password) {
            setSavedPassword(authData.password);
          } else {
            setSavedPassword(null);
          }
        } else {
          setSavedEmail(null);
          setSavedPassword(null);
        }
      } catch (error) {
        setSavedEmail(null);
        setSavedPassword(null);
      }
    } else {
      setSavedEmail(null);
      setSavedPassword(null);
    }
  }, [selectedServer]);

  // Trigger connection when connect button clicked from list
  useEffect(() => {
    if (triggerConnect && selectedServer && selectedServer.id === triggerConnect && !isConnected && !showAuthDialog) {
      // Show auth dialog to start connection
      setShowAuthDialog(true);
    }
  }, [triggerConnect, selectedServer, isConnected, showAuthDialog]);

  // Setup global listeners for logs irrespective of connection state for now
  useEffect(() => {
     if (!window.electronAPI) return;

     const handleLog = (event, { serverId, message }) => {
         // Parse IP Address from logs
         // Windows: Notified TAP-Windows driver to set a DHCP IP/Netmask of 10.8.0.2/255.255.255.252
         // Mac: /sbin/ifconfig utun1 10.8.0.2 10.8.0.1
         // Linux: ifconfig tun0 10.8.0.2
         // or: ip addr add 10.8.0.2/24 dev tun0
         const ipMatch = message.match(/(?:ifconfig|ip addr add)\s+(?:[\w]+\s+)?([0-9]{1,3}(?:\.[0-9]{1,3}){3})|DHCP IP\/Netmask of ([0-9.]+)|IPv4 pool address ([0-9.]+)/i);
         
         if (ipMatch) {
             const ip = ipMatch[1] || ipMatch[2] || ipMatch[3];
             if (ip) {
                 // Ignore if IP is 0.0.0.0 or 255.255.255.255
                 if (ip !== '0.0.0.0' && ip !== '255.255.255.255') {
                      setStats(prev => ({ ...prev, ipAddress: ip }));
                 }
             }
         }

         if (selectedServer && (serverId === selectedServer.id || serverId === String(selectedServer.id) || Number(serverId) === selectedServer.id)) {
             addLog(message.trim());
         } else if (!selectedServer) {
             addLog(`[${serverId}] ${message.trim()}`);
         }
     };

     // Register
     if (window.electronAPI.onVpnLog) window.electronAPI.onVpnLog(handleLog);

     return () => {
         if (window.electronAPI) {
             window.electronAPI.removeAllListeners('vpn-log');
         }
     };
  }, [selectedServer]); 

  // Simulation for Traffic and Meta stats (Latency only) - Restored "Like Before"
  useEffect(() => {
     if (!isConnected) {
         setDownloadSpeed(0);
         setUploadSpeed(0);
         setStats(prev => ({ ...prev, ipAddress: '--' })); // Reset IP on disconnect
         return;
     }

     // Restore the "busy" simulation the user liked
     const interval = setInterval(() => {
        const download = Math.random() * 50 + 10;
        const upload = Math.random() * 20 + 5;
        
        setDownloadSpeed(download);
        setUploadSpeed(upload);
        
        setStats(prev => ({
            ...prev,
            download: `${download.toFixed(2)} MB/s`,
            upload: `${upload.toFixed(2)} MB/s`,
            latency: `${Math.floor(Math.random() * 50 + 20)} ms`,
            // Don't overwrite ipAddress here if it was set by log
            ipAddress: prev.ipAddress === '--' || prev.ipAddress === 'assigning...' ? 'Assigning...' : prev.ipAddress
        }));
     }, 1000);

     return () => clearInterval(interval);
  }, [isConnected]);

  const handleToggleConnection = () => {
    if (isConnecting) return;
    
    // Disable if OpenVPN is not installed
    if (!openvpnInstalled && !isConnected) {
      alert('OpenVPN is not installed. Please install OpenVPN to connect to VPN servers.');
      return;
    }

    if (isConnected) {
      // Disconnect
      handleDisconnect();
    } else {
      // Show auth dialog if server is selected
      if (selectedServer) {
        setShowAuthDialog(true);
      }
    }
  };

  const handleDisconnect = async () => {
    if (!selectedServer) return;
    
    setIsConnecting(true);
    addLog('Disconnecting...');
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.disconnectVpn(selectedServer.id);
        // Update connected servers
        if (onConnectionChange) {
          onConnectionChange(selectedServer.id, false);
        }
      }
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
    
    setIsConnecting(false);
    addLog('Disconnected');
  };

  const handleConnect = useCallback(async (authData) => {
    setShowAuthDialog(false);
    setIsConnecting(true);
    addLog('Connecting...');

    try {
      if (!window.electronAPI) {
        throw new Error('Electron not available');
      }

      // Save auth data to cache
      const cacheKey = `vpn_auth_${selectedServer.id}`;
      const authCache = {
        email: authData.email,
        emailSaved: authData.saveEmail
      };
      
      // Only save password if checkbox is checked
      if (authData.savePassword) {
        authCache.password = authData.password;
        authCache.passwordSaved = true;
      } else {
        // Don't save password if checkbox is not checked
        authCache.passwordSaved = false;
      }
      
      localStorage.setItem(cacheKey, JSON.stringify(authCache));

      // Connect VPN
      const result = await window.electronAPI.connectVpn({
        serverId: selectedServer.id,
        filePath: selectedServer.filePath,
        email: authData.email,
        password: authData.password,
        saveEmail: authData.saveEmail
      });

      if (result.success) {
        addLog('Connected');
        
        // Update saved email if checkbox was checked
        if (authData.saveEmail) {
          setSavedEmail(authData.email);
        }
        
        // Update saved password if checkbox was checked
        if (authData.savePassword) {
          setSavedPassword(authData.password);
        } else {
          setSavedPassword(null);
        }
        
        // Update connected servers
        if (onConnectionChange) {
          onConnectionChange(selectedServer.id, true);
        }
      } else {
        throw new Error(result.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Error connecting:', error);
      addLog(`Error: ${error.message}`);
      alert(`Failed to connect: ${error.message}`);
    } finally {
      setIsConnecting(false);
    }
  }, [selectedServer, onConnectionChange]);

  const handleCancelAuth = useCallback(() => {
    setShowAuthDialog(false);
  }, []);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-4), `[${timestamp}] ${message}`]);
  };

  const getStatusText = () => {
    if (isConnecting) {
      return isConnected ? 'Disconnecting...' : 'Connecting...';
    }
    if (isConnected && selectedServer) {
      return `Connected to ${selectedServer.name}`;
    }
    return 'Not Connected';
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      {/* Status Banner */}
      <div className="p-6 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">
            {getStatusText()}
          </h2>
          {selectedServer && (
            <p className="text-sm text-gray-400 mt-1">
              {selectedServer.location || 'Location not specified'}
            </p>
          )}
        </div>
        <button
          onClick={handleToggleConnection}
          disabled={isConnecting || (!openvpnInstalled && !isConnected)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            isConnected
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={!openvpnInstalled && !isConnected ? 'OpenVPN is not installed' : ''}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center p-8 overflow-y-auto">
        {/* Traffic Chart */}
        <div className="w-full max-w-4xl mb-4 flex-shrink-0">
          <TrafficChart
            isConnected={isConnected}
            downloadSpeed={downloadSpeed}
            uploadSpeed={uploadSpeed}
            onConnectClick={handleToggleConnection}
            startTime={connectionStartTime}
          />
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-4 gap-3 w-full max-w-2xl mb-4 flex-shrink-0">
          <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700">
            <p className="text-gray-400 text-xs uppercase mb-0.5">Download</p>
            <p className="text-lg font-bold text-gray-100">{stats.download}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700">
            <p className="text-gray-400 text-xs uppercase mb-0.5">Upload</p>
            <p className="text-lg font-bold text-gray-100">{stats.upload}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700">
            <p className="text-gray-400 text-xs uppercase mb-0.5">Latency</p>
            <p className="text-lg font-bold text-gray-100">{stats.latency}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-2.5 border border-gray-700">
            <p className="text-gray-400 text-xs uppercase mb-0.5">IP Address</p>
            <p className="text-lg font-bold text-gray-100">{stats.ipAddress}</p>
          </div>
        </div>

        {/* Activity Log */}
        <div className="w-full max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Activity Log</h3>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 max-h-20 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500 text-sm">No activity yet...</p>
            ) : (
              <div className="space-y-1">
                {logs.map((log, index) => (
                  <p key={index} className="text-xs text-gray-300 font-mono">
                    {log}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <div>
          <p>RCP Network Desktop</p>
        </div>
        <div>
          <p>Version {appVersion}</p>
        </div>
      </div>

      {/* VPN Auth Dialog */}
      <VpnAuthDialog
        isVisible={showAuthDialog}
        server={selectedServer}
        onConnect={handleConnect}
        onCancel={handleCancelAuth}
        savedEmail={savedEmail}
        savedPassword={savedPassword}
      />
    </div>
  );
};

export default ConnectionControl;

