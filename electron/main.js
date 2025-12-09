const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const keytar = require('keytar');
const isDev = process.env.ELECTRON_IS_DEV === '1';

// Configure autoUpdater
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// App configuration (must be defined before LOG_FILE)
const APP_NAME = app.getName() || 'rcp-network';
const VPN_DIRECTORY = path.join(os.homedir(), `.${APP_NAME}`);
const KEYCHAIN_SERVICE = `${APP_NAME}_sudo_password`;
const KEYCHAIN_ACCOUNT = 'sudo_password';

// Setup logging to file (use VPN_DIRECTORY for logs)
const LOG_FILE = path.join(VPN_DIRECTORY, 'app.log');

// Store original console methods BEFORE overriding
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Create log function (use original console methods to avoid infinite loop)
const logToFile = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.length > 0 ? args.map(arg => 
    (typeof arg === 'string') ? arg : JSON.stringify(arg)
  ).join(' ') : '';
  const logMessage = `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;
  
  try {
    // Ensure directory exists before writing
    if (!fs.existsSync(VPN_DIRECTORY)) {
      fs.mkdirSync(VPN_DIRECTORY, { recursive: true, mode: 0o755 });
    }
    fs.appendFileSync(LOG_FILE, logMessage, 'utf8');
  } catch (error) {
    // Silently fail if can't write to log file
    // Use originalError to avoid infinite loop
    originalError('Failed to write to log file:', error);
  }
  
  // Use original console methods to avoid infinite loop
  if (level === 'ERROR') {
    originalError(message, ...args);
  } else if (level === 'WARN') {
    originalWarn(message, ...args);
  } else {
    originalLog(message, ...args);
  }
};

// Override console methods to also log to file
console.log = (...args) => {
  logToFile('INFO', args.join(' '));
};

console.error = (...args) => {
  logToFile('ERROR', args.join(' '));
};

console.warn = (...args) => {
  logToFile('WARN', args.join(' '));
};

// Get icon path based on platform
function getIconPath() {
  const platform = process.platform;
  if (platform === 'darwin') {
    // macOS
    return path.join(__dirname, '../icons/mac/icon.icns');
  } else if (platform === 'win32') {
    // Windows
    return path.join(__dirname, '../icons/win/icon.ico');
  } else {
    // Linux
    return path.join(__dirname, '../icons/png/512x512.png');
  }
}

let mainWindow = null;

// Auto-update logic
function setupAutoUpdater(win) {
  autoUpdater.on('checking-for-update', () => {
    autoUpdater.logger.info('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    autoUpdater.logger.info('Update available: ' + info.version);
    win.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    autoUpdater.logger.info('Update not available.');
  });

  autoUpdater.on('error', (err) => {
    autoUpdater.logger.error('Error in auto-updater: ' + err);
    win.webContents.send('update-error', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    autoUpdater.logger.info(log_message);
    win.webContents.send('update-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    autoUpdater.logger.info('Update downloaded');
    win.webContents.send('update-downloaded', info);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111827', // bg-gray-900
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'default',
    frame: true,
    icon: getIconPath(),
  });
  
  mainWindow = win;
  
  // Setup auto-updater
  setupAutoUpdater(win);
  
  // Check for updates when window is shown
  win.once('ready-to-show', () => {
      // Small delay to ensure UI is ready to receive events if needed
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
      }, 3000);
      win.show();
  });

  // Show loading indicator immediately
  const loadingHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          margin: 0;
          padding: 0;
          background: #111827;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #fff;
        }
        .loader {
          text-align: center;
        }
        .spinner {
          border: 4px solid #374151;
          border-top: 4px solid #3b82f6;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .text {
          font-size: 16px;
          color: #9ca3af;
        }
      </style>
    </head>
    <body>
      <div class="loader">
        <div class="spinner"></div>
        <div class="text">Loading RCP Network...</div>
      </div>
    </body>
    </html>
  `;
  win.loadURL(`data:text/html,${encodeURIComponent(loadingHTML)}`);

  // Load the app
  if (isDev) {
    // Wait for React dev server to be ready
    const loadDevServer = () => {
      win.loadURL('http://localhost:3000').catch(() => {
        console.log('Waiting for React dev server...');
        setTimeout(loadDevServer, 1000);
      });
    };
    loadDevServer();
    win.webContents.once('did-finish-load', () => {
      win.webContents.openDevTools();
    });
  } else {
    // Production mode: load from build folder
    // In production, files are packaged in app.asar
    // app.getAppPath() returns the path to app.asar in production
    const appPath = app.getAppPath();
    const buildIndexPath = path.join(appPath, 'build', 'index.html');
    
    console.log('Production mode - App path:', appPath);
    console.log('Production mode - Build index path:', buildIndexPath);
    
    // Load the file - Electron can read from app.asar directly
    win.loadFile(buildIndexPath).then(() => {
      console.log('Successfully loaded build from:', buildIndexPath);
    }).catch((error) => {
      console.error('Failed to load build file:', error);
      console.error('App path:', appPath);
      console.error('Build path:', buildIndexPath);
      
      // Show error page with detailed info for debugging
      const errorHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              margin: 0;
              padding: 40px;
              background: #111827;
              color: #fff;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            h1 { color: #ef4444; }
            pre {
              background: #1f2937;
              padding: 15px;
              border-radius: 5px;
              overflow-x: auto;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <h1>Error: Failed to load application</h1>
          <p>Unable to load build files. Please rebuild the application.</p>
          <pre>Error: ${error.message}\n\nApp path: ${appPath}\nBuild path: ${buildIndexPath}</pre>
        </body>
        </html>
      `;
      win.loadURL(`data:text/html,${encodeURIComponent(errorHTML)}`);
    });
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win.show();
  });
  
  // Enable DevTools in production with keyboard shortcut (Cmd+Option+I or Cmd+Shift+I)
  if (!isDev) {
    // Register global shortcut to toggle DevTools
    globalShortcut.register('CommandOrControl+Option+I', () => {
      if (win) {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools();
        }
      }
    });
    
    // Also register Cmd+Shift+I as alternative
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (win) {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools();
        }
      }
    });
    
    logToFile('INFO', 'DevTools shortcuts registered: Cmd+Option+I or Cmd+Shift+I');
  }

  // Handle window closed
  win.on('closed', () => {
    // Dereference the window object
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  logToFile('INFO', 'Application starting...');
  logToFile('INFO', 'App path:', app.getAppPath());
  logToFile('INFO', 'Log file:', LOG_FILE);
  
  // Load sudo password from keychain if available
  const passwordLoaded = await loadSudoPasswordFromKeychain();
  if (passwordLoaded) {
    logToFile('INFO', 'Sudo password loaded from keychain');
  }
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  logToFile('INFO', 'Application closing...');
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on app quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  logToFile('INFO', 'Application quit');
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
});

// Store validated sudo password (in memory, also saved to keychain)
let validatedSudoPassword = null;

// Platform detection helpers
const isWindows = () => process.platform === 'win32';
const isLinux = () => process.platform === 'linux';
const isMacOS = () => process.platform === 'darwin';
const getPlatformName = () => {
  if (isWindows()) return 'Windows';
  if (isLinux()) return 'Linux';
  if (isMacOS()) return 'macOS';
  return 'Unknown';
};

// Get installation guide URL based on platform
const getInstallationGuide = (platform) => {
  if (platform === 'Windows') {
    return 'https://openvpn.net/community-downloads/';
  } else if (platform === 'Linux') {
    return 'https://community.openvpn.net/openvpn/wiki/OpenvpnSoftwareRepos';
  } else if (platform === 'macOS') {
    return 'https://openvpn.net/community-downloads/';
  }
  return 'https://openvpn.net/community-downloads/';
};

// Find OpenVPN executable path
const findOpenVpnPath = async () => {
  const platform = process.platform;
  logToFile('INFO', 'Searching for OpenVPN on platform:', platform);
  
  if (isWindows()) {
    // Windows paths
    const possiblePaths = [
      'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe',
      'C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe',
      'C:\\OpenVPN\\bin\\openvpn.exe'
    ];
    
    // Try to find using 'where' command
    try {
      const { stdout } = await execAsync('where openvpn', { 
        timeout: 2000,
        shell: true
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim().split('\r\n')[0].trim();
        logToFile('INFO', 'Found OpenVPN using where:', foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile('WARN', 'where openvpn failed, trying direct paths...', e.message);
    }
    
    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile('INFO', 'Found OpenVPN at:', testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Last resort: try to execute openvpn --version
    try {
      await execAsync('openvpn --version', { 
        timeout: 2000,
        shell: true
      });
      logToFile('INFO', 'OpenVPN found in PATH (verified with --version)');
      return 'openvpn.exe';
    } catch (e) {
      logToFile('ERROR', 'OpenVPN not found in PATH or common locations');
      throw new Error('OpenVPN not found. Please install OpenVPN from https://openvpn.net/community-downloads/');
    }
  } else if (isLinux()) {
    // Linux paths
    const possiblePaths = [
      '/usr/bin/openvpn',
      '/usr/sbin/openvpn',
      '/usr/local/bin/openvpn',
      '/usr/local/sbin/openvpn',
      '/opt/openvpn/bin/openvpn'
    ];
    
    // Try to find using 'which' command
    try {
      const envPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      const { stdout } = await execAsync('which openvpn', { 
        timeout: 2000,
        env: { ...process.env, PATH: envPath }
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim();
        logToFile('INFO', 'Found OpenVPN using which:', foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile('WARN', 'which openvpn failed, trying direct paths...', e.message);
    }
    
    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile('INFO', 'Found OpenVPN at:', testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Last resort: try to execute openvpn --version
    try {
      const envPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      await execAsync('openvpn --version', { 
        timeout: 2000,
        env: { ...process.env, PATH: envPath }
      });
      logToFile('INFO', 'OpenVPN found in PATH (verified with --version)');
      return 'openvpn';
    } catch (e) {
      logToFile('ERROR', 'OpenVPN not found in PATH or common locations');
      throw new Error('OpenVPN not found. Please install OpenVPN. For Linux: https://community.openvpn.net/openvpn/wiki/OpenvpnSoftwareRepos');
    }
  } else {
    // macOS paths (existing implementation)
    const possiblePaths = [
      '/opt/homebrew/sbin/openvpn',      // Homebrew Apple Silicon (sbin)
      '/opt/homebrew/bin/openvpn',       // Homebrew Apple Silicon (bin)
      '/usr/local/sbin/openvpn',         // Homebrew Intel (sbin)
      '/usr/local/bin/openvpn',          // Homebrew Intel (bin)
      '/usr/sbin/openvpn',               // System sbin
      '/usr/bin/openvpn'                 // System bin
    ];
    
    // Try to find using 'which' command
    try {
      const envPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin';
      const { stdout } = await execAsync('which openvpn', { 
        timeout: 2000,
        env: { ...process.env, PATH: envPath }
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim();
        logToFile('INFO', 'Found OpenVPN using which:', foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile('WARN', 'which openvpn failed, trying direct paths...', e.message);
    }
    
    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile('INFO', 'Found OpenVPN at:', testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Last resort: try to execute openvpn --version
    try {
      const envPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin';
      await execAsync('openvpn --version', { 
        timeout: 2000,
        env: { ...process.env, PATH: envPath }
      });
      logToFile('INFO', 'OpenVPN found in PATH (verified with --version)');
      return 'openvpn';
    } catch (e) {
      logToFile('ERROR', 'OpenVPN not found in PATH or common locations');
      throw new Error('OpenVPN not found. Please install OpenVPN or add it to your PATH.');
    }
  }
};

// Load sudo password from keychain on startup
const loadSudoPasswordFromKeychain = async () => {
  try {
    const password = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (password) {
      validatedSudoPassword = password;
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error loading password from keychain:', error);
    return false;
  }
};

// Save sudo password to keychain
const saveSudoPasswordToKeychain = async (password) => {
  try {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, password);
    return true;
  } catch (error) {
    console.error('Error saving password to keychain:', error);
    return false;
  }
};

// Delete sudo password from keychain
const deleteSudoPasswordFromKeychain = async () => {
  try {
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    return true;
  } catch (error) {
    console.error('Error deleting password from keychain:', error);
    return false;
  }
};

// Check if VPN directory exists
const checkVpnDirectory = () => {
  try {
    return fs.existsSync(VPN_DIRECTORY) && fs.statSync(VPN_DIRECTORY).isDirectory();
  } catch (error) {
    return false;
  }
};

// Create VPN directory (may require sudo)
const createVpnDirectory = async (password) => {
  try {
    // First, try to create without sudo
    try {
      if (!fs.existsSync(VPN_DIRECTORY)) {
        fs.mkdirSync(VPN_DIRECTORY, { recursive: true, mode: 0o755 });
      }
      return { success: true, usedSudo: false };
    } catch (error) {
      // If failed, try with sudo
      if (password) {
        const escapedPassword = password.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
        const escapedDir = VPN_DIRECTORY.replace(/'/g, "'\\''");
        const command = `echo '${escapedPassword}' | sudo -S mkdir -p '${escapedDir}' && echo '${escapedPassword}' | sudo -S chmod 755 '${escapedDir}'`;
        
        try {
          await execAsync(command, { timeout: 5000 });
          return { success: true, usedSudo: true };
        } catch (sudoError) {
          return { 
            success: false, 
            error: 'Failed to create directory with sudo. Please check your password.' 
          };
        }
      } else {
        return { 
          success: false, 
          error: 'Directory creation requires sudo password' 
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to create directory'
    };
  }
};

// Process .ovpn file: remove unwanted configs
const processOvpnFile = (filePath) => {
  try {
    // Read file content
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Configs to remove (exact match, case-insensitive)
    const configsToRemove = [
      'client-cert-not-required',
      'verify-client-cert none'
    ];
    
    // Split into lines
    const lines = content.split('\n');
    let modified = false;
    
    // Process each line
    const processedLines = lines.map(line => {
      const trimmedLine = line.trim();
      
      // Check if line matches any config to remove
      for (const config of configsToRemove) {
        // Match exact config (case-insensitive)
        // Handle both "config" and "config " (with trailing space)
        const regex = new RegExp(`^${config.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
        if (regex.test(trimmedLine)) {
          modified = true;
          return null; // Mark for removal
        }
      }
      
      return line; // Keep the line
    }).filter(line => line !== null); // Remove null lines
    
    // Join lines back
    content = processedLines.join('\n');
    
    // Write processed content back to file if modified
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      return {
        success: true,
        modified: true,
        message: 'File processed: Removed unwanted configs'
      };
    }
    
    return {
      success: true,
      modified: false,
      message: 'No changes needed'
    };
  } catch (error) {
    console.error('Error processing .ovpn file:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// IPC Handlers
ipcMain.handle('open-file-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select OpenVPN Configuration File',
      filters: [
        { name: 'OpenVPN Config', extensions: ['ovpn'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled) {
      return { canceled: true };
    }

    const originalFilePath = result.filePaths[0];
    const fileName = path.basename(originalFilePath, '.ovpn');
    
    // Verify file exists and is readable
    try {
      fs.accessSync(originalFilePath, fs.constants.R_OK);
      
      // Use VPN directory in home folder (~/.vpn_client)
      // Ensure directory exists (should be created during sudo password validation)
      if (!checkVpnDirectory()) {
        return {
          canceled: false,
          error: 'VPN directory does not exist. Please restart the application and enter sudo password.'
        };
      }
      
      // Copy file to VPN directory
      const destinationPath = path.join(VPN_DIRECTORY, `${fileName}.ovpn`);
      
      // If file already exists, add timestamp to make it unique
      let finalDestinationPath = destinationPath;
      if (fs.existsSync(finalDestinationPath)) {
        const timestamp = Date.now();
        finalDestinationPath = path.join(VPN_DIRECTORY, `${fileName}_${timestamp}.ovpn`);
      }
      
      // Copy file to VPN directory
      fs.copyFileSync(originalFilePath, finalDestinationPath);
      
      // Process the .ovpn file (remove unwanted configs) - process the copied file
      const processResult = processOvpnFile(finalDestinationPath);
      
      if (!processResult.success) {
        // If processing fails, remove the copied file
        try {
          fs.unlinkSync(finalDestinationPath);
        } catch (e) {
          console.error('Error cleaning up file:', e);
        }
        return {
          canceled: false,
          error: processResult.error || 'Failed to process file'
        };
      }
      
      return {
        canceled: false,
        filePath: finalDestinationPath, // Return path to copied file
        originalPath: originalFilePath, // Keep original path for reference
        fileName: fileName,
        processed: processResult.modified,
        message: processResult.message
      };
    } catch (error) {
      return {
        canceled: false,
        error: error.message || 'File cannot be read or copied'
      };
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
    return {
      canceled: false,
      error: error.message
    };
  }
});

// Validate sudo password
ipcMain.handle('validate-sudo-password', async (event, password) => {
  try {
    // Skip validation for Windows - no sudo needed
    if (isWindows()) {
      // Just create directory if needed
      const directoryExists = checkVpnDirectory();
      let directoryCreated = false;
      
      if (!directoryExists) {
        const createResult = await createVpnDirectory(null); // No password needed for Windows
        if (!createResult.success) {
          return {
            success: false,
            error: createResult.error || 'Failed to create VPN directory'
          };
        }
        directoryCreated = createResult.usedSudo || false;
      }
      
      return {
        success: true,
        message: directoryCreated 
          ? 'Directory created successfully'
          : 'Ready to use',
        directoryCreated: directoryCreated,
        directoryExists: directoryExists || directoryCreated
      };
    }
    
    // For Linux/macOS: validate sudo password
    // Test password by trying to run a sudo command
    // Use -S flag to read password from stdin
    // Escape special characters in password
    const escapedPassword = password.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
    
    // Use a safer method: write password to a temporary approach
    // For security, we'll use sudo -S with echo piped
    const testCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;
    
    try {
      const { stdout, stderr } = await execAsync(testCommand, { 
        timeout: 5000,
        maxBuffer: 1024 
      });
      
      // Check if sudo succeeded (no error output means success)
      if (stderr && stderr.includes('Sorry, try again')) {
        return {
          success: false,
          error: 'Invalid password. Please try again.'
        };
      }
      
      // Password is valid, store it in memory and save to keychain
      validatedSudoPassword = password;
      await saveSudoPasswordToKeychain(password);
      
      // Check if VPN directory exists, create if needed
      const directoryExists = checkVpnDirectory();
      let directoryCreated = false;
      
      if (!directoryExists) {
        const createResult = await createVpnDirectory(password);
        if (!createResult.success) {
          return {
            success: false,
            error: createResult.error || 'Failed to create VPN directory'
          };
        }
        directoryCreated = createResult.usedSudo || false;
      }
      
      return {
        success: true,
        message: directoryCreated 
          ? 'Password validated and directory created successfully'
          : 'Password validated successfully',
        directoryCreated: directoryCreated,
        directoryExists: directoryExists || directoryCreated
      };
    } catch (error) {
      // Check error message to determine if it's invalid password
      if (error.stderr && error.stderr.includes('Sorry, try again')) {
        return {
          success: false,
          error: 'Invalid password. Please try again.'
        };
      }
      
      // Other errors
      return {
        success: false,
        error: 'Failed to validate password. Please try again.'
      };
    }
  } catch (error) {
    console.error('Error validating sudo password:', error);
    return {
      success: false,
      error: error.message || 'Failed to validate password'
    };
  }
});

// Get validated sudo password (for use in VPN operations)
ipcMain.handle('get-sudo-password', async () => {
  return validatedSudoPassword;
});

// Check VPN directory status
ipcMain.handle('check-vpn-directory', async () => {
  const exists = checkVpnDirectory();
  return {
    exists: exists,
    path: VPN_DIRECTORY,
    needsSudo: !exists // If doesn't exist, might need sudo
  };
});

// Check if sudo password is available and valid (from keychain or memory)
ipcMain.handle('check-sudo-password', async () => {
  // Skip for Windows - no sudo needed
  if (isWindows()) {
    return true;
  }
  
  // If not in memory, try to load from keychain
  if (!validatedSudoPassword) {
    const loaded = await loadSudoPasswordFromKeychain();
    if (!loaded) {
      return false;
    }
  }

  // Validate password by testing with sudo -v
  if (validatedSudoPassword) {
    try {
      const escapedPassword = validatedSudoPassword.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
      const testCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;
      
      try {
        const { stderr } = await execAsync(testCommand, { timeout: 5000, maxBuffer: 1024 });
        
        // Check if sudo succeeded
        if (stderr && stderr.includes('Sorry, try again')) {
          // Password invalid, clear it
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return false;
        }
        
        // Password is still valid
        return true;
      } catch (error) {
        // Password might be invalid or expired
        if (error.stderr && error.stderr.includes('Sorry, try again')) {
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return false;
        }
        // Other errors, assume password is still valid
        return true;
      }
    } catch (error) {
      console.error('Error validating password:', error);
      return false;
    }
  }

  return false;
});

// Check if OpenVPN is installed
ipcMain.handle('check-openvpn-installed', async () => {
  const platform = getPlatformName();
  const installationGuide = getInstallationGuide(platform);
  
  try {
    const openvpnPath = await findOpenVpnPath();
    logToFile('INFO', 'OpenVPN check: Installed at', openvpnPath);
    return {
      installed: true,
      path: openvpnPath,
      platform: platform,
      error: null,
      installationGuide: installationGuide
    };
  } catch (error) {
    logToFile('ERROR', 'OpenVPN check: Not installed', error.message);
    return {
      installed: false,
      path: null,
      platform: platform,
      error: error.message,
      installationGuide: installationGuide
    };
  }
});

// Store running OpenVPN processes (key: serverId, value: process info)
const openvpnProcesses = new Map();

// Append email to .ovpn file if saveEmail is true
const appendEmailToOvpn = (filePath, email) => {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if auth-user-pass already exists (with or without value)
    const authUserPassRegex = /^auth-user-pass(\s+.*)?$/im;
    const lines = content.split('\n');
    let found = false;
    let modified = false;
    
    // Process lines: remove existing auth-user-pass and add new one
    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      if (authUserPassRegex.test(trimmed)) {
        found = true;
        modified = true;
        // Replace with new auth-user-pass with email
        return `auth-user-pass ${email}`;
      }
      return line;
    });
    
    // If not found, append at the end
    if (!found) {
      processedLines.push(`auth-user-pass ${email}`);
      modified = true;
    }
    
    content = processedLines.join('\n');
    
    // Write back to file
    fs.writeFileSync(filePath, content, 'utf8');
    
    return { success: true, modified: modified };
  } catch (error) {
    console.error('Error appending email to .ovpn file:', error);
    return { success: false, error: error.message };
  }
};

// Remove email from .ovpn file (remove auth-user-pass line with email)
const removeEmailFromOvpn = (filePath) => {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if auth-user-pass with email exists
    const authUserPassRegex = /^auth-user-pass\s+.*$/im;
    const lines = content.split('\n');
    let modified = false;
    
    // Remove lines that match auth-user-pass with value (email)
    const processedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (authUserPassRegex.test(trimmed)) {
        modified = true;
        return false; // Remove this line
      }
      return true; // Keep this line
    });
    
    content = processedLines.join('\n');
    
    // Write back to file if modified
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
    
    return { success: true, modified: modified };
  } catch (error) {
    console.error('Error removing email from .ovpn file:', error);
    return { success: false, error: error.message };
  }
};

// Connect VPN
ipcMain.handle('connect-vpn', async (event, data) => {
  try {
    const { serverId, filePath, email, password, saveEmail } = data;
    
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'VPN file not found' };
    }

    // Ensure sudo password is available and valid (only for Linux/macOS)
    if (!isWindows()) {
      if (!validatedSudoPassword) {
        // Try to load from keychain
        const loaded = await loadSudoPasswordFromKeychain();
        if (!loaded) {
          return { success: false, error: 'Sudo password not available. Please enter password first.' };
        }
      }

      // Validate password is still valid by refreshing sudo timestamp
      try {
        const escapedPassword = validatedSudoPassword.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
        const validateCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;
        const { stderr } = await execAsync(validateCommand, { timeout: 5000, maxBuffer: 1024 });
        
        if (stderr && stderr.includes('Sorry, try again')) {
          // Password expired or invalid, clear it
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return { success: false, error: 'Sudo password expired. Please enter password again.' };
        }
      } catch (error) {
        if (error.stderr && error.stderr.includes('Sorry, try again')) {
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return { success: false, error: 'Sudo password expired. Please enter password again.' };
        }
        // Continue if other error (might be network issue, etc)
      }
    }

    // Handle email in .ovpn file based on saveEmail checkbox
    if (saveEmail) {
      // Append email to .ovpn file
      const appendResult = appendEmailToOvpn(filePath, email);
      if (!appendResult.success) {
        return { success: false, error: appendResult.error };
      }
    } else {
      // Remove email from .ovpn file if checkbox is unchecked
      const removeResult = removeEmailFromOvpn(filePath);
      if (!removeResult.success) {
        // Log error but don't fail the connection
        console.warn('Warning: Failed to remove email from .ovpn file:', removeResult.error);
      }
    }

    // Note: We'll create auth file below based on saveEmail flag

    // Build OpenVPN command
    const escapedFilePath = filePath.replace(/'/g, "'\\''");
    
    // Create auth file with email and password
    // Format: first line = email/username, second line = password
    const tempAuthFile = path.join(VPN_DIRECTORY, `.vpn_auth_${Date.now()}.tmp`);
    
    if (saveEmail) {
      // Email is already in .ovpn file (auth-user-pass <email>)
      // But OpenVPN still needs auth file with email and password
      // We use the email from the saved value
      fs.writeFileSync(tempAuthFile, `${email}\n${password}`, 'utf8');
    } else {
      // Both email and password from user input
      fs.writeFileSync(tempAuthFile, `${email}\n${password}`, 'utf8');
    }
    
    // Set file permissions (Unix only)
    if (!isWindows()) {
      fs.chmodSync(tempAuthFile, 0o600);
    }
    const escapedAuthFile = tempAuthFile.replace(/'/g, "'\\''");
    
    // Find OpenVPN executable path
    let openvpnPath;
    try {
      openvpnPath = await findOpenVpnPath();
      logToFile('INFO', 'Using OpenVPN path:', openvpnPath);
    } catch (error) {
      logToFile('ERROR', 'Failed to find OpenVPN:', error.message);
      return { 
        success: false, 
        error: error.message || 'OpenVPN not found. Please install OpenVPN.' 
      };
    }
    
    // Build command based on platform
    // Check if running as Admin on Windows
    const isWindowsAdmin = async () => {
       try {
         // 'net session' requires Admin privileges. Returns 0 if admin, != 0 if not.
         await execAsync('net session');
         return true;
       } catch (e) {
         return false;
       }
    };

    // Build command based on platform
    const escapedOpenvpnPath = openvpnPath.replace(/'/g, "'\\''");
    
    // Windows Logic
    if (isWindows()) {
      const isAdmin = await isWindowsAdmin();
      
      if (isAdmin) {
         // ALREADY ADMIN: Run directly using standard child_process.spawn/exec
         // No UAC prompt needed because we inherit permissions.
         
         const winOpenVpn = openvpnPath;
         const winConfig = filePath;
         const winAuth = tempAuthFile;
         
         // Standard execution
         const command = `"${winOpenVpn}" --config "${winConfig}" --auth-user-pass "${winAuth}"`;
         
         logToFile('INFO', 'Executing OpenVPN command (Already Admin)...');
         
         const execOptions = {
            cwd: VPN_DIRECTORY,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
            env: { ...process.env }
         };
         
         // Start process
         const openvpnProcess = exec(command, execOptions, (error, stdout, stderr) => {
             if (serverId && openvpnProcesses.has(serverId)) {
                 openvpnProcesses.delete(serverId);
             }
         });
         
         // Handle logs
         if (openvpnProcess.stdout) {
             openvpnProcess.stdout.on('data', d => console.log('OpenVPN stdout:', d.toString()));
         }
         if (openvpnProcess.stderr) {
             openvpnProcess.stderr.on('data', d => console.error('OpenVPN stderr:', d.toString()));
         }
         
         if (!openvpnProcess.pid) {
              return { success: false, error: 'Failed to start OpenVPN process.' };
         }
         
         console.log('OpenVPN process started with PID:', openvpnProcess.pid);
         openvpnProcess.unref();
         
         if (serverId) {
              openvpnProcesses.set(serverId, {
                process: openvpnProcess,
                filePath: filePath,
                tempAuthFile: tempAuthFile,
                startTime: Date.now()
              });

              openvpnProcess.on('exit', (code, signal) => {
                if (openvpnProcesses.has(serverId)) {
                    openvpnProcesses.delete(serverId);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('vpn-disconnected', { serverId, reason: `Process exited with code ${code}` });
                    }
                    try { fs.unlinkSync(tempAuthFile); } catch(e) {}
                }
             });
         }
         
         return { success: true, message: 'VPN connection started (Admin Mode)', serverId: serverId };

      } else {
          // NOT ADMIN: Must trigger UAC via PowerShell Start-Process -Verb RunAs
          // This allows users to "Connect" -> Accept UAC -> Connected.
          // They cannot "save" this permission permanently unless they run the App itself as Admin.

          const logPath = path.join(VPN_DIRECTORY, `openvpn_${serverId || Date.now()}.log`);
          
          if (fs.existsSync(logPath)) {
            try { fs.unlinkSync(logPath); } catch (e) {}
          }

          const winOpenVpn = openvpnPath;
          const winConfig = filePath;
          const winAuth = tempAuthFile;

          const openVpnArgs = `--config "${winConfig}" --auth-user-pass "${winAuth}"`;

          const psCommand = `
            $p = Start-Process "${winOpenVpn}" -ArgumentList '${openVpnArgs}' -Verb RunAs -PassThru -RedirectStandardOutput "${logPath}" -RedirectStandardError "${logPath}" -WindowStyle Hidden;
            if ($p) { Write-Output $p.Id } else { exit 1 }
          `.replace(/\n/g, ' ').trim();

          logToFile('INFO', 'Executing elevated OpenVPN command (Requesting UAC)...', psCommand);
          logToFile('INFO', 'Log file:', logPath);

          try {
            const { stdout, stderr } = await execAsync(`powershell -Command "${psCommand}"`);
            
            const pid = parseInt(stdout.trim());
            if (!pid || isNaN(pid)) {
              throw new Error('Failed to get PID from elevated process');
            }

            console.log('OpenVPN process started with PID (elevated):', pid);

            // Log tailing
            let lastSize = 0;
            const logPoller = setInterval(() => {
              try {
                if (fs.existsSync(logPath)) {
                  const stats = fs.statSync(logPath);
                  if (stats.size > lastSize) {
                    const stream = fs.createReadStream(logPath, { start: lastSize, end: stats.size });
                    stream.on('data', chunk => {
                      console.log('OpenVPN stdout:', chunk.toString());
                    });
                    lastSize = stats.size;
                  }
                }
              } catch (e) {}
            }, 500);

            // Monitor exit
            const exitMonitor = setInterval(async () => {
                 try {
                    const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`);
                    if (!stdout.includes(pid.toString())) {
                        clearInterval(exitMonitor);
                        clearInterval(logPoller);
                        if (serverId && openvpnProcesses.has(serverId)) {
                            openvpnProcesses.delete(serverId);
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('vpn-disconnected', { serverId, reason: 'Elevated process exited' });
                            }
                            try { fs.unlinkSync(tempAuthFile); } catch(e) {}
                        }
                    }
                 } catch (e) {}
            }, 2000);

            if (serverId) {
              openvpnProcesses.set(serverId, {
                process: {
                  pid: pid,
                  kill: () => {
                    clearInterval(logPoller);
                    clearInterval(exitMonitor);
                  },
                  unref: () => {}
                },
                filePath: filePath,
                tempAuthFile: tempAuthFile,
                logPath: logPath,
                startTime: Date.now()
              });
            }
            
            return { success: true, message: 'VPN connection started (Elevated)', serverId: serverId };

          } catch (error) {
            logToFile('ERROR', 'Failed to start elevated process:', error.message);
            
            // Helpful error if PowerShell is missing or blocked
            if (error.message && (error.message.toLowerCase().includes('powershell') || error.message.includes('not recognized'))) {
                 return { 
                   success: false, 
                   error: 'PowerShell is required for auto-elevation. Please restart the app as Administrator.' 
                 };
            }
            
            return { 
              success: false, 
              error: 'Failed to start OpenVPN as Admin. Please accept the UAC prompt or run the App as Administrator.' 
            };
          }
      }
    } 

    // Linux/macOS Implementation
    let command;
    let envPath;
    
    // Linux/macOS: use sudo
    const escapedPassword = validatedSudoPassword.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
    envPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin';
    command = `echo '${escapedPassword}' | sudo -S '${escapedOpenvpnPath}' --config '${escapedFilePath}' --auth-user-pass '${escapedAuthFile}'`;

    logToFile('INFO', 'Executing OpenVPN command...');
    logToFile('INFO', 'OpenVPN path:', openvpnPath);
    logToFile('INFO', 'Config file:', filePath);
    logToFile('INFO', 'Auth file:', tempAuthFile);
    
    // Execute OpenVPN in background
    const execOptions = {
      cwd: VPN_DIRECTORY,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr for debugging
      env: {
        ...process.env,
        PATH: envPath
      }
    };
    
    const openvpnProcess = exec(command, execOptions, (error, stdout, stderr) => {
      if (error) {
        console.error('OpenVPN execution error:', error);
        if (stderr) {
          console.error('OpenVPN stderr:', stderr.toString());
        }
      }
      if (stdout) {
        console.log('OpenVPN stdout:', stdout.toString());
      }
      // Remove from map when process exits
      if (serverId) {
        openvpnProcesses.delete(serverId);
      }
    });
    
    // Log stderr for debugging
    if (openvpnProcess.stderr) {
      let stderrBuffer = '';
      openvpnProcess.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        console.error('OpenVPN stderr:', data.toString());
      });
      
      // Check for common errors after a short delay
      setTimeout(() => {
        if (stderrBuffer.includes('command not found') || stderrBuffer.includes('No such file')) {
          console.error('OpenVPN command not found - installation issue');
        }
        if (stderrBuffer.includes('Permission denied')) {
          console.error('OpenVPN permission denied - sudo issue');
        }
      }, 1000);
    }
    
    // Log stdout for debugging
    if (openvpnProcess.stdout) {
      openvpnProcess.stdout.on('data', (data) => {
        console.log('OpenVPN stdout:', data.toString());
      });
    }
    
    // Check if process started successfully
    if (!openvpnProcess.pid) {
      return { 
        success: false, 
        error: 'Failed to start OpenVPN process. Please check if OpenVPN is installed and accessible.' 
      };
    }
    
    console.log('OpenVPN process started with PID:', openvpnProcess.pid);

    // Store process info with serverId as key
    openvpnProcess.unref();
    if (serverId) {
      openvpnProcesses.set(serverId, {
        process: openvpnProcess,
        filePath: filePath,
        tempAuthFile: tempAuthFile,
        startTime: Date.now()
      });
      
      // Monitor process exit
      openvpnProcess.on('exit', (code, signal) => {
        console.log(`OpenVPN process exited with code ${code} and signal ${signal}`);
        if (openvpnProcesses.has(serverId)) {
           // If it's still in the map, it means it crashed or exited unexpectedly
           openvpnProcesses.delete(serverId);
           // Notify frontend
           if (mainWindow && !mainWindow.isDestroyed()) {
             mainWindow.webContents.send('vpn-disconnected', { 
               serverId, 
               reason: `Process exited with code ${code}` 
             });
           }
           // Cleanup
           try { fs.unlinkSync(tempAuthFile); } catch(e) {}
        }
      });
    }

    return { success: true, message: 'VPN connection started', serverId: serverId };
  } catch (error) {
    console.error('Error connecting VPN:', error);
    return { success: false, error: error.message || 'Failed to connect VPN' };
  }
});

// Get active connections with duration
ipcMain.handle('get-active-connections', async () => {
   const connections = {};
   for (const [id, info] of openvpnProcesses.entries()) {
      connections[id] = {
         startTime: info.startTime,
         duration: Date.now() - info.startTime
      };
   }
   return connections;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Disconnect VPN (specific server or all)
ipcMain.handle('disconnect-vpn', async (event, serverId) => {
  try {
    if (isWindows()) {
      // Windows: use taskkill
      if (serverId) {
        // Disconnect specific server
        const processInfo = openvpnProcesses.get(serverId);
        if (processInfo && processInfo.process && processInfo.process.pid) {
          // Cleanup custom process handlers (pollers)
          if (processInfo.process.kill) {
             try { processInfo.process.kill(); } catch (e) {}
          }

          try {
            await execAsync(`taskkill /F /PID ${processInfo.process.pid}`, { 
              timeout: 5000,
              shell: true 
            });
          } catch (e) {
            // Process might already be terminated
            logToFile('WARN', 'Error killing process:', e.message);
          }
          
          // Clean up temp auth file
          if (processInfo.tempAuthFile && fs.existsSync(processInfo.tempAuthFile)) {
            try {
              fs.unlinkSync(processInfo.tempAuthFile);
            } catch (e) {
              console.error('Error deleting temp auth file:', e);
            }
          }

          // Clean up log file if exists (from elevated process)
          if (processInfo.logPath && fs.existsSync(processInfo.logPath)) {
            try { fs.unlinkSync(processInfo.logPath); } catch (e) {}
          }
          
          openvpnProcesses.delete(serverId);
          return { success: true, message: 'VPN disconnected' };
        } else {
          openvpnProcesses.delete(serverId); // Ensure removed even if pid missing
          return { success: false, error: 'VPN connection not found' };
        }
      } else {
        // Disconnect all VPNs
        if (openvpnProcesses.size > 0) {
          // Cleanup all processes including pollers
          for (const [id, processInfo] of openvpnProcesses.entries()) {
             if (processInfo.process && processInfo.process.kill) {
                 try { processInfo.process.kill(); } catch (e) {}
             }
             if (processInfo.logPath && fs.existsSync(processInfo.logPath)) {
                 try { fs.unlinkSync(processInfo.logPath); } catch(e) {}
             }
          }

          try {
            await execAsync('taskkill /F /IM openvpn.exe', { 
              timeout: 5000,
              shell: true 
            });
          } catch (e) {
            // Process might already be terminated or not running
            logToFile('WARN', 'Error killing OpenVPN processes:', e.message);
          }
          
          // Clean up all temp auth files
          for (const [id, processInfo] of openvpnProcesses.entries()) {
            if (processInfo.tempAuthFile && fs.existsSync(processInfo.tempAuthFile)) {
              try {
                fs.unlinkSync(processInfo.tempAuthFile);
              } catch (e) {
                console.error('Error deleting temp auth file:', e);
              }
            }
          }
          
          openvpnProcesses.clear();
          return { success: true, message: 'All VPNs disconnected' };
        } else {
          return { success: true, message: 'No active VPN connections' };
        }
      }
    } else {
      // Linux/macOS: use pkill with sudo if needed
      const escapedPassword = validatedSudoPassword ? validatedSudoPassword.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`') : '';
      
      if (serverId) {
        // Disconnect specific server
        const processInfo = openvpnProcesses.get(serverId);
        if (processInfo) {
          // Kill specific OpenVPN process by file path
          const escapedFilePath = processInfo.filePath.replace(/'/g, "'\\''");
          if (escapedPassword) {
            await execAsync(`echo '${escapedPassword}' | sudo -S pkill -f "openvpn.*${escapedFilePath}"`, { timeout: 5000 });
          } else {
            await execAsync(`pkill -f "openvpn.*${escapedFilePath}"`, { timeout: 5000 });
          }
          
          // Clean up temp auth file
          if (processInfo.tempAuthFile && fs.existsSync(processInfo.tempAuthFile)) {
            try {
              fs.unlinkSync(processInfo.tempAuthFile);
            } catch (e) {
              console.error('Error deleting temp auth file:', e);
            }
          }
          
          openvpnProcesses.delete(serverId);
          return { success: true, message: 'VPN disconnected' };
        } else {
          openvpnProcesses.delete(serverId);
          return { success: false, error: 'VPN connection not found' };
        }
      } else {
        // Disconnect all VPNs
        if (openvpnProcesses.size > 0) {
          if (escapedPassword) {
            await execAsync(`echo '${escapedPassword}' | sudo -S pkill -f openvpn`, { timeout: 5000 });
          } else {
            await execAsync('pkill -f openvpn', { timeout: 5000 });
          }
          
          // Clean up all temp auth files
          for (const [id, processInfo] of openvpnProcesses.entries()) {
            if (processInfo.tempAuthFile && fs.existsSync(processInfo.tempAuthFile)) {
              try {
                fs.unlinkSync(processInfo.tempAuthFile);
              } catch (e) {
                console.error('Error deleting temp auth file:', e);
              }
            }
          }
          
          openvpnProcesses.clear();
          return { success: true, message: 'All VPNs disconnected' };
        } else {
          return { success: true, message: 'No active VPN connections' };
        }
      }
    }
  } catch (error) {
    console.error('Error disconnecting VPN:', error);
    return { success: false, error: error.message || 'Failed to disconnect VPN' };
  }
});

// Delete VPN file
ipcMain.handle('delete-vpn-file', async (event, filePath) => {
  try {
    if (!filePath) {
      return { success: false, error: 'File path is required' };
    }

    logToFile('INFO', 'Attempting to delete file:', filePath);
    
    // Normalize paths to fix potential delimiter issues
    const normalizedPath = path.normalize(filePath);
    const normalizedVpnDir = path.normalize(VPN_DIRECTORY);

    // Verify file is in VPN directory (security check)
    // Use startsWith checking, but ensure case safety on Windows if needed
    if (!normalizedPath.startsWith(normalizedVpnDir)) {
      console.error('Security check failed:', normalizedPath, 'not in', normalizedVpnDir);
      return { success: false, error: 'File is not in VPN directory' };
    }

    // Verify file exists
    if (!fs.existsSync(normalizedPath)) {
      console.error('File not found at:', normalizedPath);
      // If file is gone, we can consider it "deleted" from the user's perspective
      // But let's return error so UI knows it was already gone (or maybe just success)
      // User complaint: "error shown file/config not available"
      // Let's assume they want it gone. If it's gone, it's success.
      return { success: true, message: 'File already deleted or not found' };
    }

    // Delete the file
    try {
      fs.unlinkSync(normalizedPath);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message || 'Failed to delete file' };
    }
  } catch (error) {
    console.error('Error in delete-vpn-file handler:', error);
    return { success: false, error: error.message || 'Failed to delete file' };
  }
});

// Rename VPN file
ipcMain.handle('rename-vpn-file', async (event, filePath, newName) => {
  try {
    if (!filePath || !newName) {
      return { success: false, error: 'File path and new name are required' };
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    // Verify file is in VPN directory (security check)
    if (!filePath.startsWith(VPN_DIRECTORY)) {
      return { success: false, error: 'File is not in VPN directory' };
    }

    // Sanitize new name (remove invalid characters)
    const sanitizedName = newName.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (sanitizedName.length === 0) {
      return { success: false, error: 'Invalid file name' };
    }

    // Get directory and extension
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const newFilePath = path.join(dir, `${sanitizedName}${ext}`);

    // Check if new file already exists
    if (fs.existsSync(newFilePath) && newFilePath !== filePath) {
      return { success: false, error: 'A file with this name already exists' };
    }

    // Rename the file
    try {
      fs.renameSync(filePath, newFilePath);
      return { 
        success: true, 
        message: 'File renamed successfully',
        newFilePath: newFilePath,
        newName: sanitizedName
      };
    } catch (error) {
      console.error('Error renaming file:', error);
      return { success: false, error: error.message || 'Failed to rename file' };
    }
  } catch (error) {
    console.error('Error in rename-vpn-file handler:', error);
    return { success: false, error: error.message || 'Failed to rename file' };
  }
});

