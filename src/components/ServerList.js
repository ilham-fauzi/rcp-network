import React, { useState } from 'react';

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const ConnectionTimer = ({ startTime }) => {
  const [duration, setDuration] = useState(Date.now() - startTime);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setDuration(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  return <span className="font-mono">{formatDuration(duration)}</span>;
};

const ServerListItem = ({ server, onSelect, onInfo, onDelete, onRename, onConnect, onDisconnect, isConnected, isSelected, startTime }) => {
  const getStatusColor = () => {
    // Only show green if this specific server is connected
    if (isConnected) {
      return 'bg-green-500';
    }
    // For other statuses, use default colors
    switch (server.status) {
      case 'connecting':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const truncateName = (name, maxLength = 10) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength) + '...';
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    
    // Confirm deletion
    if (window.confirm(`Are you sure you want to delete "${server.name}"? This will also delete the .ovpn file.`)) {
      await onDelete(server);
    }
  };

  const handleRename = (e) => {
    e.stopPropagation();
    onRename(server);
  };

  const handleConnect = (e) => {
    e.stopPropagation();
    onConnect(server);
  };

  const handleDisconnect = (e) => {
    e.stopPropagation();
    onDisconnect(server);
  };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors group ${
        isConnected 
          ? 'bg-green-900/30 border border-green-500/50 hover:bg-green-900/40' 
          : isSelected
            ? 'bg-blue-900/30 border border-blue-500/40 hover:bg-blue-900/40'
            : 'border border-transparent hover:bg-gray-800'
      }`}
      onClick={() => onSelect(server)}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getStatusColor()} ${isConnected ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-gray-900' : ''}`} />
        <span className={`text-sm font-medium truncate ${isConnected ? 'text-green-100' : isSelected ? 'text-blue-100' : 'text-gray-100'}`} title={server.name}>
          {truncateName(server.name, 10)}
        </span>
        {isConnected && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400 font-semibold bg-green-500/20 px-2 py-0.5 rounded flex-shrink-0">
              {startTime ? <ConnectionTimer startTime={startTime} /> : 'Connected'}
            </span>
          </div>
        )}
      </div>
      <div className={`flex items-center gap-1 ${isSelected || isConnected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex-shrink-0`}>
        {isConnected ? (
          <button
            onClick={handleDisconnect}
            className="text-orange-400 hover:text-orange-300 transition-colors p-1"
            title="Disconnect"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className="text-green-400 hover:text-green-300 transition-colors p-1"
            title="Connect"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        )}
        <button
          onClick={handleRename}
          className="text-blue-400 hover:text-blue-300 transition-colors p-1"
          title="Rename"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
        <button
          onClick={handleDelete}
          className="text-red-400 hover:text-red-300 transition-colors p-1"
          title="Delete Server"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

const ServerList = ({ 
  servers, 
  selectedServer,
  onServerSelect, 
  onAddProfile, 
  onDeleteServer,
  onDeleteAll,
  onRenameServer,
  onConnectServer,
  onDisconnectServer,
  connectedServers,
  serverConnectionDetails,
  isLoading,
  isProcessingFile
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredServers = servers.filter(server =>
    server.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleKeyPress = (e) => {
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      onAddProfile();
    }
  };

  React.useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-100">RCP Network</h1>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search Servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <svg
            className="absolute right-3 top-2.5 w-5 h-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Server List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredServers.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">
              {searchQuery ? 'No servers found' : "No VPN profiles yet. Click 'Add New Profile' to get started."}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
            {filteredServers.map((server) => (
              <ServerListItem
                key={server.id}
                server={server}
                onSelect={onServerSelect}
                onInfo={(server) => console.log('Info:', server)}
                onDelete={onDeleteServer}
                onRename={onRenameServer}
                onConnect={onConnectServer}
                onDisconnect={onDisconnectServer}
                isConnected={connectedServers ? connectedServers.has(server.id) : false}
                isSelected={selectedServer ? selectedServer.id === server.id : false}
                startTime={serverConnectionDetails && serverConnectionDetails[server.id] ? serverConnectionDetails[server.id].startTime : null}
              />
            ))}
            </div>
            {servers.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <button
                  onClick={onDeleteAll}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  <span>Delete All Servers</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-800 space-y-3">
        <button
          onClick={onAddProfile}
          disabled={isLoading || isProcessingFile}
          className="w-full px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading || isProcessingFile ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>{isProcessingFile ? 'Processing file...' : 'Loading...'}</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add New Profile</span>
              <span className="text-xs opacity-75 ml-auto">Ctrl+A</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ServerList;

