# VPN Client Desktop Application

A modern VPN Client desktop application built with Electron, React, and Tailwind CSS. This application allows users to manage and connect to VPN servers through OpenVPN configuration files (`.ovpn`).

## Features

### Core Functionality
- **Dark Mode UI**: Beautiful dark-themed interface with modern design
- **Two-Panel Layout**: Sidebar for server management and main content for connection control
- **Cross-Platform Support**: Full support for Windows, Linux, and macOS with platform-specific handling
- **OpenVPN Integration**: Full support for OpenVPN configuration files (`.ovpn`)
- **OpenVPN Detection**: Proactive detection of OpenVPN installation with warning banner and installation guide
- **Multiple Connections**: Support for multiple simultaneous VPN connections
- **Secure Storage**: System password stored securely in system keychain using `keytar`

### Server Management
- **Import VPN Profiles**: Add new VPN servers by importing `.ovpn` files
- **Server List**: View all configured VPN servers with search functionality
- **Server Actions**:
  - **Connect/Disconnect**: Quick connect/disconnect buttons on each server item
  - **Rename**: Edit server names with custom dialog
  - **Delete**: Remove individual servers or delete all at once
- **Status Indicators**: Visual indicators showing connection status (Connected, Connecting, Disconnected)
- **Truncated Names**: Server names limited to 10 characters with ellipsis for better UI

### Connection Features
- **Authentication Dialog**: Secure email and password input with save options
- **Email Management**: Option to save email to `.ovpn` file or keep it temporary
- **Password Management**: Option to save password to localStorage for convenience
- **Auto File Processing**: Automatically removes `client-cert-not-required` and `verify-client-cert none` from `.ovpn` files
- **System Password Management**: Secure system password storage and validation using system keychain

### Real-Time Monitoring
- **Time-Series Traffic Chart**: Interactive chart showing download and upload speeds over time
- **Current Speed Indicators**: Real-time display of current download and upload speeds
- **Resizable Chart**: Drag handle to adjust chart height (200px - 600px range)
- **Disconnect Overlay**: Transparent disconnect button overlay in center of chart when connected
- **Statistics Dashboard**: Real-time statistics for Download, Upload, Latency, and IP Address
- **Activity Log**: Scrollable log area tracking all connection activities

### File Management
- **Automatic Directory Creation**: Creates `~/.vpn_client` directory automatically (requires system password on first run for Linux/macOS, not required for Windows)
- **File Storage**: All `.ovpn` files stored securely in `~/.vpn_client` directory (cross-platform path handling)
- **File Operations**: Copy, rename, and delete operations for VPN configuration files

### Cross-Platform Support
- **Windows Support**: 
  - No sudo password required (uses UAC/elevation)
  - Automatic detection of OpenVPN in common installation paths
  - Uses `taskkill` for process management
- **Linux Support**:
  - Sudo password validation and storage
  - Support for multiple package managers (apt, yum, pacman, etc.)
  - Automatic detection of OpenVPN in standard Linux paths
- **macOS Support**:
  - Sudo password validation and storage
  - Support for Homebrew (Intel and Apple Silicon)
  - Automatic detection of OpenVPN in Homebrew and system paths

### OpenVPN Detection
- **Proactive Detection**: Automatically checks for OpenVPN installation on application startup
- **Warning Banner**: Displays prominent warning banner if OpenVPN is not installed
- **Platform-Specific Guides**: Provides installation guide links specific to user's operating system
- **Check Again Button**: Allows users to re-check OpenVPN installation after installing
- **Connection Prevention**: Disables connect button when OpenVPN is not detected

## Installation

### Prerequisites
- Node.js (v20-24 recommended)
- npm or yarn
- **OpenVPN**: Must be installed on your system
  - **Windows**: Download from [OpenVPN Community Downloads](https://openvpn.net/community-downloads/)
  - **Linux**: Install via package manager (e.g., `sudo apt install openvpn` or `sudo yum install openvpn`)
  - **macOS**: Install via Homebrew (`brew install openvpn`) or download from [OpenVPN Community Downloads](https://openvpn.net/community-downloads/)
- Supported Operating Systems: macOS, Linux, or Windows

### Steps

1. Install dependencies:
```bash
npm install
```

2. The `postinstall` script will automatically rebuild native modules (keytar) for Electron.

## Development

To run the application in development mode, you have three options:

### Option 1: Using npm run dev (Recommended)
```bash
npm run dev
```

This will:
- Start the React development server on http://localhost:3000
- Wait for the server to be ready (up to 60 seconds)
- Launch Electron with hot-reload enabled

### Option 2: Using start script (Alternative)
```bash
./start-dev.sh
```

This script ensures React server is ready before starting Electron.

### Option 3: Run separately (Manual)
```bash
# Terminal 1: Start React dev server
npm start

# Wait for "Compiled successfully!" message (usually 10-20 seconds)
# Then in Terminal 2:
npm run electron-dev
```

**Note:** 
- Electron will automatically retry connecting to the React dev server if it's not ready yet
- Make sure React server shows "Compiled successfully!" before starting Electron manually
- If you see "ERR_CONNECTION_REFUSED", wait a few more seconds - Electron will retry automatically

## Building

To build the application for production:

```bash
npm run build
npm run electron
```

Or use electron-builder for distribution:

```bash
npm run build-electron
```

## Project Structure

```
vpn_client/
├── electron/
│   ├── main.js          # Electron main process (IPC handlers, file operations)
│   └── preload.js       # Preload script for secure IPC communication
├── public/
│   └── index.html       # HTML entry point
├── src/
│   ├── components/
│   │   ├── ServerList.js        # Sidebar component (server list, search, actions)
│   │   ├── ConnectionControl.js # Main content component (connection UI, stats)
│   │   ├── TrafficChart.js      # Time-series traffic visualization
│   │   ├── VpnAuthDialog.js     # VPN authentication dialog
│   │   ├── SudoPasswordDialog.js # System password input dialog (initial setup)
│   │   ├── RenameDialog.js      # Server rename dialog
│   │   └── OpenVpnWarning.js    # OpenVPN installation warning banner
│   ├── App.js           # Main app component (state management, routing)
│   ├── index.js         # React entry point
│   └── index.css        # Tailwind CSS imports
├── package.json
├── tailwind.config.js
└── postcss.config.js
```

## Components

### ServerList.js
- Server list with search functionality
- Status indicators (Connected, Connecting, Disconnected)
- Server item actions:
  - Connect/Disconnect buttons
  - Rename button
  - Delete button
- Add new profile button
- Delete all servers button
- Server name truncation (max 10 characters)

### ConnectionControl.js
- Status banner with connection info
- Time-series traffic chart integration
- Real-time statistics (Download, Upload, Latency, IP Address)
- Activity log with scrollable area
- Footer with version info

### TrafficChart.js
- Time-series visualization using Recharts
- Real-time data collection (updates every second)
- Current speed indicators (Download/Upload)
- Resizable chart with drag handle
- Disconnect button overlay when connected
- Empty state with "Click to Connect" overlay

### VpnAuthDialog.js
- Email and password input fields
- "Simpan" checkbox for email (appends to `.ovpn` file)
- "Simpan Password" checkbox (saves to localStorage)
- Auto-fill from saved credentials
- Form validation

### SudoPasswordDialog.js
- System password input (for initial setup)
- Password validation
- Keychain integration
- Directory creation on first run
- User-friendly welcome message

### RenameDialog.js
- Server name editing
- Input validation
- File rename operation

### OpenVpnWarning.js
- Warning banner displayed when OpenVPN is not installed
- Platform-specific installation guide links
- "Check Again" button for re-checking OpenVPN installation
- Prominent yellow warning design with clear messaging

## Technologies

- **Electron**: Desktop application framework
- **React**: UI library with Hooks
- **Tailwind CSS**: Utility-first CSS framework
- **Recharts**: Chart library for data visualization
- **Keytar**: Secure password storage in system keychain
- **React Scripts**: Build tooling

## Key Features Details

### System Password Management
- **Platform-Specific Handling**:
  - **Windows**: No sudo password required (uses UAC/elevation when needed)
  - **Linux/macOS**: System password stored securely in system keychain (macOS Keychain, Linux Secret Service)
- Password is validated and refreshed before each VPN connection (Linux/macOS only)
- Directory `~/.vpn_client` is created automatically on first run
  - **Windows**: Created without requiring admin password
  - **Linux/macOS**: May require system password for initial setup
- User-friendly dialog with "Welcome to VPN Client" message for first-time users (Linux/macOS only)

### VPN Connection Flow
1. Application checks for OpenVPN installation on startup
2. If OpenVPN is not installed, warning banner is displayed with installation guide
3. User selects a VPN server from the list
4. Authentication dialog appears (email and password)
5. User can choose to save email (appends to `.ovpn` file) and/or password (localStorage)
6. Connection is established using OpenVPN command:
   - **Windows**: Direct execution (no sudo required)
   - **Linux/macOS**: Execution with sudo privileges
7. Real-time traffic monitoring begins
8. Statistics and activity log are updated

### OpenVPN Detection Flow
1. Application checks for OpenVPN on startup using platform-specific detection:
   - **Windows**: Uses `where openvpn` and checks common installation paths
   - **Linux**: Uses `which openvpn` and checks standard Linux paths
   - **macOS**: Uses `which openvpn` and checks Homebrew paths
2. If OpenVPN is found, application proceeds normally
3. If OpenVPN is not found:
   - Warning banner is displayed at the top of the application
   - Connect button is disabled
   - Platform-specific installation guide link is provided
   - User can click "Check Again" after installing OpenVPN

### File Processing
- When a `.ovpn` file is imported, the application automatically:
  - Removes `client-cert-not-required` configuration
  - Removes `verify-client-cert none` configuration
  - Copies file to `~/.vpn_client` directory
  - Handles duplicate file names with timestamp

### Multiple Connections
- The application supports multiple simultaneous VPN connections
- Each connection is tracked independently
- Connection status is displayed per server in the list
- Platform-specific process management:
  - **Windows**: Uses `taskkill` to terminate OpenVPN processes
  - **Linux/macOS**: Uses `pkill` with sudo privileges

## Security

- **Keychain Storage**: System passwords stored securely in system keychain
- **File Isolation**: All VPN files stored in dedicated directory (`~/.vpn_client`)
- **Password Handling**: Passwords never stored in plain text files
- **IPC Security**: Context isolation enabled, no node integration in renderer

## License

MIT
