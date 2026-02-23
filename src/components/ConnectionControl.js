import React, { useState, useEffect, useCallback, useRef } from 'react';
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

  // Timer Visibility Preference
  const [showDurationTimer, setShowDurationTimer] = useState(true);

  // Awake Mode State
  const [awakeEnabled, setAwakeEnabled] = useState(false);
  const [awakeMenuOpen, setAwakeMenuOpen] = useState(false);
  const [awakeExpiry, setAwakeExpiry] = useState(null);
  const [awakeDuration, setAwakeDuration] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const awakeMenuRef = useRef(null);

  // Load timer preference on mount
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getTimerPreference) {
      window.electronAPI.getTimerPreference().then((value) => {
        setShowDurationTimer(value);
      }).catch(console.error);
    }
  }, []);

  const handleTimerToggle = async () => {
    const newValue = !showDurationTimer;
    setShowDurationTimer(newValue);
    if (window.electronAPI && window.electronAPI.setTimerPreference) {
      await window.electronAPI.setTimerPreference(newValue).catch(console.error);
    }
  };

  // Close Awake Menu on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (awakeMenuRef.current && !awakeMenuRef.current.contains(event.target)) {
        setAwakeMenuOpen(false);
      }
    }

    if (awakeMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [awakeMenuOpen]);

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



  // Load saved email and password for selected server from keytar
  useEffect(() => {
    const loadCredentials = async () => {
      if (selectedServer && window.electronAPI && window.electronAPI.loadVpnCredentials) {
        try {
          // Extract filename from filePath
          const filename = selectedServer.filePath ? selectedServer.filePath.split('/').pop() : null;
          if (filename) {
            const creds = await window.electronAPI.loadVpnCredentials(filename);
            setSavedEmail(creds.email || null);
            setSavedPassword(creds.password || null);
          } else {
            setSavedEmail(null);
            setSavedPassword(null);
          }
        } catch (error) {
          console.error('Error loading VPN credentials:', error);
          setSavedEmail(null);
          setSavedPassword(null);
        }
      } else {
        setSavedEmail(null);
        setSavedPassword(null);
      }
    };
    loadCredentials();
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
    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('vpn-log');
        window.electronAPI.removeAllListeners('awake-status-change');
      }
    };
  }, [selectedServer]);

  // Awake Mode Listener
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onAwakeStatusChange) {
      window.electronAPI.onAwakeStatusChange((event, status) => {
        setAwakeEnabled(status.enabled);
        setAwakeExpiry(status.expiry || null);
        setAwakeDuration(status.duration || null);
      });
    }
  }, []);

  // Timer for Awake Mode countdown
  useEffect(() => {
    // If we have an expiry, start calculating
    if (!awakeEnabled || !awakeExpiry) {
      if (timeLeft) setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = awakeExpiry - now;

      if (remaining <= 0) {
        // Time is up, but let the backend send the status change event to disable it
        // Just show 00:00 or nothing for now
        setTimeLeft('0s');
      } else {
        // Format remaining time
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

        let timeString = '';
        if (hours > 0) {
          timeString = `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
          timeString = `${minutes}m ${seconds}s`;
        } else {
          timeString = `${seconds}s`;
        }
        setTimeLeft(timeString);
      }
    };

    updateTimer(); // Initial call
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [awakeEnabled, awakeExpiry]);

  const handleAwakeChange = async (duration) => {
    setAwakeMenuOpen(false);
    try {
      if (duration === 'off') {
        await window.electronAPI.disableAwakeMode();
      } else {
        await window.electronAPI.enableAwakeMode(duration);
      }
    } catch (e) {
      console.error("Failed to toggle awake mode:", e);
    }
  };

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

        // Handle credential persistence via keytar
        const filename = selectedServer.filePath ? selectedServer.filePath.split('/').pop() : null;
        if (filename && window.electronAPI.saveVpnCredentials) {
          const credsToSave = {};
          if (authData.saveEmail) {
            credsToSave.email = authData.email;
            setSavedEmail(authData.email);
          } else {
            // Delete saved email if unchecked
            await window.electronAPI.deleteVpnCredentials(filename).catch(() => { });
            setSavedEmail(null);
          }
          if (authData.savePassword) {
            credsToSave.password = authData.password;
            setSavedPassword(authData.password);
          } else {
            setSavedPassword(null);
          }
          if (Object.keys(credsToSave).length > 0) {
            await window.electronAPI.saveVpnCredentials(filename, credsToSave);
          }
        }

        // Bulk save credentials to all configs if "Apply to all" is checked
        if (authData.applyAll && window.electronAPI.bulkSaveVpnCredentials) {
          try {
            const bulkResult = await window.electronAPI.bulkSaveVpnCredentials({
              email: authData.email,
              password: authData.password,
              saveEmail: authData.saveEmail,
              savePassword: authData.savePassword,
            });
            if (bulkResult.success) {
              addLog(`Credentials applied to ${bulkResult.count} configs`);
            }
          } catch (bulkError) {
            console.error('Bulk save error:', bulkError);
          }
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
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${isConnected
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

        {/* Timer Toggle */}
        <button
          onClick={handleTimerToggle}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors ${showDurationTimer ? 'text-blue-400 hover:bg-blue-500/10' : 'text-gray-500 hover:bg-gray-800'}`}
          title={showDurationTimer ? 'Hide Connection Timer' : 'Show Connection Timer'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>{showDurationTimer ? 'Timer On' : 'Timer Off'}</span>
        </button>

        {/* Awake Mode Control */}
        <div className="relative" ref={awakeMenuRef}>
          <button
            onClick={() => setAwakeMenuOpen(!awakeMenuOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${awakeEnabled ? 'bg-yellow-500/10 text-yellow-500' : 'hover:bg-gray-800 text-gray-500'}`}
            title="Awake Mode (Prevent Sleep)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
              <line x1="6" y1="1" x2="6" y2="4"></line>
              <line x1="10" y1="1" x2="10" y2="4"></line>
              <line x1="14" y1="1" x2="14" y2="4"></line>
            </svg>
            <span>{awakeEnabled ? (awakeExpiry ? (timeLeft ? `Awake (${timeLeft})` : 'Awake (Timer)') : 'Awake On') : 'Awake Mode'}</span>
          </button>

          {awakeMenuOpen && (
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
              <div className="py-1 max-h-96 overflow-y-auto">
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-800/50">
                  Keep System Awake
                </div>
                <button onClick={() => handleAwakeChange(null)} className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 flex items-center justify-between ${awakeEnabled && !awakeExpiry ? 'text-yellow-500' : 'text-gray-300'}`}>
                  Indefinite
                  {awakeEnabled && !awakeExpiry && <span className="text-yellow-500">✓</span>}
                </button>

                <div className="border-t border-gray-700 my-1"></div>
                <div className={`px-4 py-1 text-xs font-semibold ${awakeEnabled && awakeDuration && awakeDuration < 60 * 60 * 1000 ? 'text-emerald-500' : 'text-gray-500'}`}>Minutes</div>
                <div className="grid grid-cols-4 gap-1 px-2">
                  {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => {
                    const ms = m * 60 * 1000;
                    const isActive = awakeEnabled && awakeDuration === ms;
                    return (
                      <button key={m} onClick={() => handleAwakeChange(ms)} className={`text-center py-1 text-xs rounded transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-500 font-bold' : 'text-gray-300 hover:bg-gray-700'}`}>
                        {m}
                      </button>
                    );
                  })}
                </div>

                <div className={`mt-2 px-4 py-1 text-xs font-semibold ${awakeEnabled && awakeDuration && awakeDuration >= 60 * 60 * 1000 ? 'text-emerald-500' : 'text-gray-500'}`}>Hours</div>
                <div className="grid grid-cols-4 gap-1 px-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24].map(h => {
                    const ms = h * 60 * 60 * 1000;
                    const isActive = awakeEnabled && awakeDuration === ms;
                    return (
                      <button key={h} onClick={() => handleAwakeChange(ms)} className={`text-center py-1 text-xs rounded transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-500 font-bold' : 'text-gray-300 hover:bg-gray-700'}`}>
                        {h}
                      </button>
                    );
                  })}
                </div>

                <div className="border-t border-gray-700 my-1 mt-2"></div>
                <button onClick={() => handleAwakeChange('off')} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700">Disable</button>
              </div>
            </div>
          )}
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

