const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const keytar = require('keytar');
const isDev = process.env.ELECTRON_IS_DEV === '1';

// App configuration
const APP_NAME = app.getName() || 'vpn_client';
const VPN_DIRECTORY = path.join(os.homedir(), `.${APP_NAME}`);
const KEYCHAIN_SERVICE = `${APP_NAME}_sudo_password`;
const KEYCHAIN_ACCOUNT = 'sudo_password';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111827', // bg-gray-900
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'default',
    frame: true,
    icon: path.join(__dirname, '../public/icon.png'), // Optional: add icon later
  });

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
    win.loadFile(path.join(__dirname, '../build/index.html'));
  }

  // Handle window closed
  win.on('closed', () => {
    // Dereference the window object
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Load sudo password from keychain if available
  const passwordLoaded = await loadSudoPasswordFromKeychain();
  if (passwordLoaded) {
    console.log('Sudo password loaded from keychain');
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
});

// Store validated sudo password (in memory, also saved to keychain)
let validatedSudoPassword = null;

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

    // Ensure sudo password is available and valid
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
    const escapedPassword = validatedSudoPassword.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
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
    
    fs.chmodSync(tempAuthFile, 0o600);
    const escapedAuthFile = tempAuthFile.replace(/'/g, "'\\''");
    
    // Run OpenVPN with sudo
    // Note: If saveEmail is true, the .ovpn file already has auth-user-pass <email>
    // but we still provide the auth file for password
    const command = `echo '${escapedPassword}' | sudo -S openvpn --config '${escapedFilePath}' --auth-user-pass '${escapedAuthFile}'`;

    // Execute OpenVPN in background
    const openvpnProcess = exec(command, {
      cwd: VPN_DIRECTORY,
      detached: true,
      stdio: 'ignore'
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('OpenVPN error:', error);
      }
      // Remove from map when process exits
      if (serverId) {
        openvpnProcesses.delete(serverId);
      }
    });

    // Store process info with serverId as key
    openvpnProcess.unref();
    if (serverId) {
      openvpnProcesses.set(serverId, {
        process: openvpnProcess,
        filePath: filePath,
        tempAuthFile: tempAuthFile
      });
    }

    return { success: true, message: 'VPN connection started', serverId: serverId };
  } catch (error) {
    console.error('Error connecting VPN:', error);
    return { success: false, error: error.message || 'Failed to connect VPN' };
  }
});

// Disconnect VPN (specific server or all)
ipcMain.handle('disconnect-vpn', async (event, serverId) => {
  try {
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

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    // Verify file is in VPN directory (security check)
    if (!filePath.startsWith(VPN_DIRECTORY)) {
      return { success: false, error: 'File is not in VPN directory' };
    }

    // Delete the file
    try {
      fs.unlinkSync(filePath);
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

