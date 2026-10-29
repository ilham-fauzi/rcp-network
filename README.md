# RCP Network Desktop Application

A modern RCP Network desktop application built with Electron, React, and Tailwind CSS. This application allows users to manage and connect to VPN servers through OpenVPN configuration files (`.ovpn`).

## Features

### Core Functionality

- **Dark Mode UI**: Beautiful dark-themed interface with modern design
- **Two-Panel Layout**: Sidebar for server management and main content for connection control
- **Cross-Platform Support**: Full support for Windows, Linux, and macOS with platform-specific handling
- **OpenVPN Integration**: Full support for OpenVPN configuration files (`.ovpn`)
- **OpenVPN Detection**: Proactive detection of OpenVPN installation with warning banner and installation guide
- **Multiple Connections**: Support for multiple simultaneous VPN connections
- **One-Time Setup**: On Linux/macOS the admin password is asked once, by the system, to install a small privileged helper; the app never stores it

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
- **No Password Prompts After Setup**: Connect and disconnect run through the installed helper with `sudo -n`, so no admin or keychain prompt for the system password appears

### Real-Time Monitoring

- **Time-Series Traffic Chart**: Interactive chart showing download and upload speeds over time
- **Current Speed Indicators**: Real-time display of current download and upload speeds
- **Resizable Chart**: Drag handle to adjust chart height (200px - 600px range)
- **Disconnect Overlay**: Transparent disconnect button overlay in center of chart when connected
- **Statistics Dashboard**: Real-time statistics for Download, Upload, Latency, and IP Address
- **Activity Log**: Scrollable log area tracking all connection activities

### File Management

- **Automatic Directory Creation**: Creates `~/.rcp-network` directory automatically, as the user (no admin password needed)
- **File Storage**: All `.ovpn` files stored securely in `~/.rcp-network` directory (cross-platform path handling)
- **File Operations**: Copy, rename, and delete operations for VPN configuration files

### Cross-Platform Support

- **Windows Support**:
  - No sudo password required (uses UAC/elevation)
  - Automatic detection of OpenVPN in common installation paths
  - Uses `taskkill` for process management
- **Linux Support**:
  - One-time helper setup through a `pkexec` (polkit) prompt
  - Support for multiple package managers (apt, yum, pacman, etc.)
  - Automatic detection of OpenVPN in standard Linux paths
- **macOS Support**:
  - One-time helper setup through the macOS admin dialog (Touch ID allowed)
  - Support for Homebrew (Intel and Apple Silicon)
  - **OpenVPN Installation**: If OpenVPN is missing, the warning banner offers an **Install** button. When Homebrew is present it runs `brew install openvpn` as you (no admin password), shows progress and verifies the result. Without Homebrew the banner shows the install guide; the app does not install Homebrew for you.
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
- **OpenVPN Community Edition**: Must be installed on your system
  - **Windows**: Download from [OpenVPN Community Downloads](https://openvpn.net/community-downloads/)
  - **Linux**: Install via package manager (e.g., `sudo apt install openvpn` or `sudo yum install openvpn`)
  - **macOS**: Click **Install** in the app's OpenVPN banner (uses Homebrew if present), or install manually using `brew install openvpn` or download from [OpenVPN Community Downloads](https://openvpn.net/community-downloads/)
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
rcp_network/
├── electron/
│   ├── main.js          # Electron main process (IPC handlers, file operations)
│   ├── preload.js       # Preload script for secure IPC communication
│   ├── privileged.js    # One-time helper install and sudo -n check (Linux/macOS)
│   └── helper/
│       └── rcp-network-helper # Root helper: connect, disconnect, flush-dns
├── public/
│   └── index.html       # HTML entry point
├── src/
│   ├── components/
│   │   ├── ServerList.js        # Sidebar component (server list, search, actions)
│   │   ├── ConnectionControl.js # Main content component (connection UI, stats)
│   │   ├── TrafficChart.js      # Time-series traffic visualization
│   │   ├── VpnAuthDialog.js     # VPN authentication dialog
│   │   ├── RenameDialog.js      # Server rename dialog
│   │   └── OpenVpnWarning.js    # OpenVPN installation warning banner
│   ├── App.js           # Main app component (state management, routing)
│   ├── index.js         # React entry point
│   └── index.css        # Tailwind CSS imports
├── test/                # node --test tests (npm test)
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
- "Save" checkbox for email (appends to `.ovpn` file)
- "Save Password" checkbox (saves to localStorage)
- Auto-fill from saved credentials
- Form validation

### RenameDialog.js

- Server name editing
- Input validation
- File rename operation

### OpenVpnWarning.js

- Warning banner displayed when OpenVPN is not installed
- Platform-specific installation guide links
- "Install" button on macOS (`brew install openvpn` as the user, or the guide when Homebrew is missing)
- "Check Again" button for re-checking OpenVPN installation
- Prominent yellow warning design with clear messaging

## Technologies

- **Electron**: Desktop application framework
- **React**: UI library with Hooks
- **Tailwind CSS**: Utility-first CSS framework
- **Recharts**: Chart library for data visualization
- **Keytar**: Secure storage of saved VPN credentials in the system keychain
- **React Scripts**: Build tooling

## Key Features Details

### One-Time Admin Setup (Linux/macOS)

- **Windows**: Unchanged; OpenVPN is started through UAC/elevation when needed.
- **Linux/macOS**: The admin password is asked **once**, the first time the app starts, through the system's own dialog:
  - **macOS**: the macOS administrator prompt (`osascript ... with administrator privileges`; Touch ID allowed)
  - **Linux**: a `pkexec` (polkit) prompt. If `pkexec` is missing, the app shows the one command to run in a terminal instead.
- That prompt installs these, all owned by root:
  - the helper:
    - macOS: `/Library/PrivilegedHelperTools/rcp-network-helper`
    - Linux: `/usr/local/libexec/rcp-network/rcp-network-helper`
  - macOS only: a private copy of OpenVPN, `/Library/PrivilegedHelperTools/rcp-network/` (`bin/openvpn` and the Homebrew libraries it needs in `lib/`, pointed at each other and re-signed). It is made from the Homebrew OpenVPN, so install that first (`brew install openvpn`). The copy does not depend on Homebrew afterwards: `brew upgrade openvpn` does not break it or ask for the password again.
  - a sudoers rule, `/etc/sudoers.d/rcp-network` (mode `0440`, checked with `visudo -c` before it is installed), that lets only the user who ran setup run only that helper without a password.
- After setup every privileged action is `sudo -n <helper> <command>`: connect, disconnect, disconnect all, and DNS flush. The app no longer stores, reads or pipes your password; older versions' keychain item (`rcp-network_sudo_password`) is deleted on first start.
- At each launch and each connect the app runs `sudo -n <helper> --version`. If the helper or rule is missing (for example removed by a macOS update), is older than the app's helper version, or (macOS) the private OpenVPN copy is missing or does not run, setup is offered again with one prompt. App updates that do not change the helper never ask again.
- The helper only starts OpenVPN:
  - for a config file directly inside your `~/.rcp-network` (real path, symlinks resolved);
  - with an OpenVPN binary you cannot change: the binary, every library it loads outside `/usr/lib` and `/System`, and every folder above them must be owned by root and not writable by group or others, or the helper refuses to start it:
    - macOS: only the private copy in `/Library/PrivilegedHelperTools/rcp-network/bin/openvpn`;
    - Linux: the first binary from a fixed list (`/opt/homebrew/sbin`, `/usr/local/sbin`, `/usr/sbin`, `/usr/local/bin`, `/usr/bin`) that passes that check;
  - with `--script-security 1`, so configs cannot run scripts. Configs that use `plugin`, `up`, `down`, `route-up`, `route-pre-down`, `ipchange`, `learn-address`, `tls-verify`, `auth-user-pass-verify`, `client-connect`, `client-disconnect`, `config`, `cd`, `chroot`, `log`, `log-append`, `status`, `writepid`, `management`, `iproute` or `tls-crypt-v2-verify` are refused.
- To remove the helper and rule:

  ```bash
  # macOS
  sudo rm /etc/sudoers.d/rcp-network /Library/PrivilegedHelperTools/rcp-network-helper
  sudo rm -rf /Library/PrivilegedHelperTools/rcp-network
  # Linux
  sudo rm /etc/sudoers.d/rcp-network /usr/local/libexec/rcp-network/rcp-network-helper
  ```

- Directory `~/.rcp-network` is created automatically, as the user, on all platforms.

### VPN Connection Flow

1. Application checks for OpenVPN installation on startup
2. If OpenVPN is not installed, warning banner is displayed with installation guide
3. User selects a VPN server from the list
4. Authentication dialog appears (email and password)
5. User can choose to save email (appends to `.ovpn` file) and/or password (localStorage)
6. Connection is established using OpenVPN command:
   - **Windows**: Direct execution (no sudo required)
   - **Linux/macOS**: `sudo -n <helper> connect <config> <auth-file>` (no password prompt)
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
  - Copies file to `~/.rcp-network` directory
  - Handles duplicate file names with timestamp

### Multiple Connections

- The application supports multiple simultaneous VPN connections
- Each connection is tracked independently
- Connection status is displayed per server in the list
- Platform-specific process management:
  - **Windows**: Uses `taskkill` to terminate OpenVPN processes
  - **Linux/macOS**: `sudo -n <helper> disconnect <config>` stops only the OpenVPN process the helper started (by its PID file)

## Security

- **No Stored Admin Password**: The admin password is entered only in the system's own dialog during one-time setup and is never stored by the app
- **Narrow sudo Rule**: The sudoers rule allows only the root-owned helper, for only the user who ran setup
- **Root-Owned OpenVPN**: The helper runs only an OpenVPN binary (and libraries) that is owned by root and not writable by the user
- **Keychain Storage**: Saved VPN credentials are stored in the system keychain
- **File Isolation**: All VPN files stored in dedicated directory (`~/.rcp-network`)
- **Password Handling**: Passwords never stored in plain text files
- **IPC Security**: Context isolation enabled, no node integration in renderer

## License

MIT
