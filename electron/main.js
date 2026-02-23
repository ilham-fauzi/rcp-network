const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  shell,
  Notification,
  powerSaveBlocker,
} = require("electron");
const settings = require("electron-settings");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, spawn } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const keytar = require("keytar");
const si = require("systeminformation");
const isDev = process.env.ELECTRON_IS_DEV === "1";

// Platform detection helpers
const isWindows = () => process.platform === "win32";
const isLinux = () => process.platform === "linux";
const isMacOS = () => process.platform === "darwin";

// autoUpdater will be configured after app is ready
let autoUpdater = null;

// Global Traffic Monitor
let trafficInterval = null;
let lastRx = 0;
let lastTx = 0;
let lastCheckTime = 0;

function startTrafficMonitor() {
  if (trafficInterval) return;

  // Reset counters
  lastRx = 0;
  lastTx = 0;
  lastCheckTime = Date.now();

  trafficInterval = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (openvpnProcesses.size === 0) {
      stopTrafficMonitor();
      return;
    }

    try {
      const stats = await si.networkStats();
      const now = Date.now();
      const timeDiff = (now - lastCheckTime) / 1000; // seconds

      if (timeDiff <= 0) return;
      if (timeDiff > 10) {
        // If huge jump (e.g. sleep), reset
        lastCheckTime = now;
        lastRx = 0; // Will skip one frame effectively
        lastTx = 0;
        return;
      }

      // Sum all non-internal traffic
      let currentRx = 0;
      let currentTx = 0;

      stats.forEach((s) => {
        if (s.internal) return;
        currentRx += s.rx_bytes;
        currentTx += s.tx_bytes;
      });

      if (lastRx > 0 && lastTx > 0) {
        const rxSpeed = Math.max(0, (currentRx - lastRx) / timeDiff); // bytes/sec
        const txSpeed = Math.max(0, (currentTx - lastTx) / timeDiff);

        // Only send if we have meaningful numbers (sometimes counters reset)
        if (rxSpeed < 1e9 && txSpeed < 1e9) {
          // Sanity check 1GB/s
          mainWindow.webContents.send("vpn-traffic", {
            download: rxSpeed,
            upload: txSpeed,
          });
        }
      }

      lastRx = currentRx;
      lastTx = currentTx;
      lastCheckTime = now;
    } catch (e) {
      console.error("Traffic monitor error:", e);
    }
  }, 1000);
}

function stopTrafficMonitor() {
  if (trafficInterval) {
    clearInterval(trafficInterval);
    trafficInterval = null;
  }
}

// autoUpdater logger will be configured in setupAutoUpdater


// App configuration (must be defined before LOG_FILE)
const APP_NAME = app.getName() || "rcp-network";
const VPN_DIRECTORY = path.join(os.homedir(), `.${APP_NAME}`);
const KEYCHAIN_SERVICE = `${APP_NAME}_sudo_password`;
const KEYCHAIN_ACCOUNT = "sudo_password";
const VPN_CRED_SERVICE = `${APP_NAME}_vpn_credentials`;

// User preferences file (simple JSON)
const PREFS_FILE = path.join(VPN_DIRECTORY, "preferences.json");

// Load preferences from disk
const loadPreferences = () => {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Error loading preferences:", e);
  }
  return {};
};

// Save preferences to disk
const savePreferences = (prefs) => {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), "utf-8");
  } catch (e) {
    console.error("Error saving preferences:", e);
  }
};

// Get a single preference with default
const getPreference = (key, defaultValue) => {
  const prefs = loadPreferences();
  return prefs[key] !== undefined ? prefs[key] : defaultValue;
};

// Set a single preference
const setPreference = (key, value) => {
  const prefs = loadPreferences();
  prefs[key] = value;
  savePreferences(prefs);
};

// Setup logging to file (use VPN_DIRECTORY for logs)
const LOG_FILE = path.join(VPN_DIRECTORY, "app.log");

// Store original console methods BEFORE overriding
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Create log function (use original console methods to avoid infinite loop)
const logToFile = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formattedArgs =
    args.length > 0
      ? args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ")
      : "";
  const logMessage = `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;

  try {
    // Ensure directory exists before writing
    if (!fs.existsSync(VPN_DIRECTORY)) {
      fs.mkdirSync(VPN_DIRECTORY, { recursive: true, mode: 0o755 });
    }
    fs.appendFileSync(LOG_FILE, logMessage, "utf8");
  } catch (error) {
    // Silently fail if can't write to log file
    // Use originalError to avoid infinite loop
    originalError("Failed to write to log file:", error);
  }

  // Use original console methods to avoid infinite loop
  if (level === "ERROR") {
    originalError(message, ...args);
  } else if (level === "WARN") {
    originalWarn(message, ...args);
  } else {
    originalLog(message, ...args);
  }
};

// Override console methods to also log to file
console.log = (...args) => {
  logToFile("INFO", args.join(" "));
};

console.error = (...args) => {
  logToFile("ERROR", args.join(" "));
};

console.warn = (...args) => {
  logToFile("WARN", args.join(" "));
};

// Get icon path based on platform
function getIconPath() {
  const platform = process.platform;
  // Now that icons are bundled in app.asar, we can simply use relative paths
  const iconDir = path.join(__dirname, "../icons");

  if (platform === "darwin") {
    // macOS
    return path.join(iconDir, "mac/icon.icns");
  } else if (platform === "win32") {
    // Windows
    return path.join(iconDir, "win/icon.ico");
  } else {
    // Linux
    return path.join(iconDir, "png/512x512.png");
  }
}

function getTrayIconPath() {
  const platform = process.platform;
  const iconDir = path.join(__dirname, "../icons");

  if (platform === "darwin") {
    // macOS: Use 24x24 from tray folder
    return path.join(iconDir, "tray/24x24.png");
  } else if (platform === "win32") {
    // Windows: Use 48x48 from tray folder
    return path.join(iconDir, "tray/48x48.png");
  } else {
    // Linux: Use 48x48 from tray folder
    return path.join(iconDir, "tray/48x48.png");
  }
}

let mainWindow = null;
let tray = null;
let connectionTimers = new Map(); // Store timeouts for duration disconnects

// Auto-update logic
function setupAutoUpdater(win) {
  // Require and configure autoUpdater here (after app is ready)
  const { autoUpdater: updater } = require("electron-updater");
  autoUpdater = updater;

  autoUpdater.logger = require("electron-log");
  autoUpdater.logger.transports.file.level = "info";
  autoUpdater.channel = "latest";
  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    autoUpdater.logger.info("Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    autoUpdater.logger.info("Update available: " + info.version);
    win.webContents.send("update-available", info);
  });

  autoUpdater.on("update-not-available", (info) => {
    autoUpdater.logger.info("Update not available.");
  });

  autoUpdater.on("error", (err) => {
    autoUpdater.logger.error("Error in auto-updater: " + err);
    win.webContents.send("update-error", err.message);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + " - Downloaded " + progressObj.percent + "%";
    log_message =
      log_message +
      " (" +
      progressObj.transferred +
      "/" +
      progressObj.total +
      ")";
    autoUpdater.logger.info(log_message);
    win.webContents.send("update-progress", progressObj);
  });

  autoUpdater.on("update-downloaded", (info) => {
    autoUpdater.logger.info("Update downloaded");
    win.webContents.send("update-downloaded", info);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#111827", // bg-gray-900
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "default",
    frame: true,
    icon: getIconPath(),
  });

  mainWindow = win;

  // Setup auto-updater
  setupAutoUpdater(win);

  // Check for updates when window is shown
  win.once("ready-to-show", () => {
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
      win.loadURL("http://localhost:3000").catch(() => {
        console.log("Waiting for React dev server...");
        setTimeout(loadDevServer, 1000);
      });
    };
    loadDevServer();
    win.webContents.once("did-finish-load", () => {
      win.webContents.openDevTools();
    });
  } else {
    // Production mode: load from build folder
    // In production, files are packaged in app.asar
    // app.getAppPath() returns the path to app.asar in production
    const appPath = app.getAppPath();
    const buildIndexPath = path.join(appPath, "build", "index.html");

    console.log("Production mode - App path:", appPath);
    console.log("Production mode - Build index path:", buildIndexPath);

    // Load the file - Electron can read from app.asar directly
    win
      .loadFile(buildIndexPath)
      .then(() => {
        console.log("Successfully loaded build from:", buildIndexPath);
      })
      .catch((error) => {
        console.error("Failed to load build file:", error);
        console.error("App path:", appPath);
        console.error("Build path:", buildIndexPath);

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
  win.once("ready-to-show", () => {
    win.show();
  });

  // Enable DevTools in production with keyboard shortcut (Cmd+Option+I or Cmd+Shift+I)
  if (!isDev) {
    // Register global shortcut to toggle DevTools
    globalShortcut.register("CommandOrControl+Option+I", () => {
      if (win) {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools();
        }
      }
    });

    // Also register Cmd+Shift+I as alternative
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      if (win) {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools();
        }
      }
    });

    logToFile(
      "INFO",
      "DevTools shortcuts registered: Cmd+Option+I or Cmd+Shift+I",
    );
  }

  // Handle window closed
  win.on("closed", () => {
    // Dereference the window object
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  logToFile("INFO", "Application starting...");
  logToFile("INFO", "App path:", app.getAppPath());
  logToFile("INFO", "Log file:", LOG_FILE);

  // Load sudo password from keychain if available
  const passwordLoaded = await loadSudoPasswordFromKeychain();
  if (passwordLoaded) {
    logToFile("INFO", "Sudo password loaded from keychain");
  }

  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Watch for file changes in VPN directory to update Tray
  if (fs.existsSync(VPN_DIRECTORY)) {
    fs.watch(VPN_DIRECTORY, (eventType, filename) => {
      if (filename && filename.endsWith(".ovpn")) {
        updateTrayMenu();
      }
    });
  }
});

// Create System Tray
function createTray() {
  const iconPath = getTrayIconPath();
  logToFile("INFO", "Creating Tray with icon:", iconPath);

  try {
    if (fs.existsSync(iconPath)) {
      logToFile("INFO", "Icon file exists at path");
    } else {
      logToFile("ERROR", "Icon file MISSING at path:", iconPath);
    }
  } catch (e) {
    logToFile("ERROR", "Error checking icon existence:", e);
  }

  let icon = nativeImage.createFromPath(iconPath);
  logToFile("INFO", "Icon empty status:", icon.isEmpty());

  // Resize for macOS to appear sleek (Notion-like size is ~18-20px)
  if (isMacOS()) {
    icon = icon.resize({ width: 17, height: 17, quality: "best" });
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("RCP Network");

  // Update tray tooltip with timer info if enabled
  const updateTrayTooltip = () => {
    if (!tray) return;
    const showTimer = getPreference("showDurationTimer", true);
    if (showTimer && openvpnProcesses.size > 0) {
      const connections = [];
      for (const [serverId, procInfo] of openvpnProcesses) {
        const elapsed = procInfo.startTime ? Math.floor((Date.now() - procInfo.startTime) / 1000) : 0;
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        connections.push(`${serverId.replace('.ovpn', '')}: ${time}`);
      }
      tray.setToolTip(`RCP Network\n${connections.join('\n')}`);
    } else {
      tray.setToolTip("RCP Network");
    }
  };

  // Periodically update tooltip
  setInterval(updateTrayTooltip, 5000);

  updateTrayMenu();
}

// Update Tray Menu
function updateTrayMenu() {
  if (!tray) return;

  const menuTemplate = [
    { label: "RCP Network", enabled: false },
    { type: "separator" },
  ];

  try {
    if (fs.existsSync(VPN_DIRECTORY)) {
      const files = fs
        .readdirSync(VPN_DIRECTORY)
        .filter((file) => file.endsWith(".ovpn"));

      if (files.length === 0) {
        menuTemplate.push({ label: "No configs found", enabled: false });
      } else {
        files.forEach((file) => {
          const serverId = file; // Use filename as serverId for tray items
          const isConnected = openvpnProcesses.has(serverId);

          // Create submenu for each file
          menuTemplate.push({
            label: file.replace(".ovpn", ""),
            icon: isConnected
              ? nativeImage.createFromPath(
                path.join(__dirname, "../icons/png/16x16.png"),
              )
              : null, // Show icon if connected? Or just text.
            submenu: [
              {
                label: isConnected ? "Disconnect" : "Connect",
                click: async () => {
                  if (isConnected) {
                    // Disconnect
                    const result = await handleTrayDisconnect(serverId);
                    if (!result.success) {
                      // handleTrayDisconnect returns boolean currently
                      // Actually handleTrayDisconnect implementation swallows the error but returns true/false?
                      // Let's check handleTrayDisconnect implementation.
                      // It calls disconnectVpn which returns {success...}
                      // But handleTrayDisconnect returns true/false placeholder?
                      // I will update handleTrayDisconnect to return the result object or throw.
                      // But simpler: just show error inside handleTrayDisconnect or here.
                      // The tool instruction says update methods.
                      // Ref: handleTrayDisconnect returns true currently.
                      dialog.showErrorBox(
                        "Disconnect Failed",
                        result.message ||
                        "An unknown error occurred during disconnect.",
                      );
                    }
                  } else {
                    const result = await handleTrayConnect(serverId, file);
                  }
                  updateTrayMenu();
                },
              },
              { type: "separator" },
              {
                label: "Connect with Duration",
                submenu: [
                  {
                    label: "15 Minutes",
                    click: () =>
                      handleTrayConnect(serverId, file, 15 * 60 * 1000),
                  },
                  {
                    label: "30 Minutes",
                    click: () =>
                      handleTrayConnect(serverId, file, 30 * 60 * 1000),
                  },
                  {
                    label: "1 Hour",
                    click: () =>
                      handleTrayConnect(serverId, file, 60 * 60 * 1000),
                  },
                  {
                    label: "4 Hours",
                    click: () =>
                      handleTrayConnect(serverId, file, 4 * 60 * 60 * 1000),
                  },
                  {
                    label: "8 Hours",
                    click: () =>
                      handleTrayConnect(serverId, file, 8 * 60 * 60 * 1000),
                  },
                ],
              },
              { type: "separator" },
              {
                label: "Edit Config",
                click: () => {
                  shell.openPath(path.join(VPN_DIRECTORY, file));
                },
              },
              {
                label: "Delete Config",
                click: async () => {
                  const choice = await dialog.showMessageBox({
                    type: "question",
                    buttons: ["Cancel", "Delete"],
                    title: "Delete Config",
                    message: `Are you sure you want to delete ${file}?`,
                  });
                  if (choice.response === 1) {
                    try {
                      fs.unlinkSync(path.join(VPN_DIRECTORY, file));
                      updateTrayMenu();
                    } catch (e) {
                      console.error("Failed to delete file", e);
                    }
                  }
                },
              },
            ],
          });
        });
      }
    } else {
      menuTemplate.push({ label: "VPN Directory not found", enabled: false });
    }
  } catch (e) {
    console.error("Error updating tray:", e);
  }

  menuTemplate.push(
    { type: "separator" },
    {
      label: "Awake Mode",
      submenu: [
        {
          label: "Indefinite",
          type: "checkbox",
          checked: awakeFooterId !== null && awakeDuration === null,
          click: () => startAwakeMode(null),
        },
        { type: "separator" },
        {
          label: "Minutes",
          submenu: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => {
            const ms = m * 60 * 1000;
            const isActive = awakeDuration === ms;
            let label = `${m} Minutes`;

            if (isActive && awakeExpiry) {
              const now = Date.now();
              const remaining = Math.max(0, awakeExpiry - now);
              const remainingMins = Math.ceil(remaining / 60000);
              label += ` (${remainingMins}m left)`;
            }

            return {
              label: label,
              type: "checkbox",
              checked: isActive,
              click: () => startAwakeMode(ms),
            };
          }),
        },
        {
          label: "Hours",
          submenu: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24].map((h) => {
            const ms = h * 60 * 60 * 1000;
            const isActive = awakeDuration === ms;
            let label = `${h} Hours`;

            if (isActive && awakeExpiry) {
              const now = Date.now();
              const remaining = Math.max(0, awakeExpiry - now);
              // Format: 1h 20m if > 1h, else 59m
              if (remaining > 60 * 60 * 1000) {
                const hrs = Math.floor(remaining / (60 * 60 * 1000));
                const mins = Math.ceil((remaining % (60 * 60 * 1000)) / 60000);
                label += ` (${hrs}h ${mins}m left)`;
              } else {
                const mins = Math.ceil(remaining / 60000);
                label += ` (${mins}m left)`;
              }
            }

            return {
              label: label,
              type: "checkbox",
              checked: isActive,
              click: () => startAwakeMode(ms),
            };
          }),
        },
        { type: "separator" },
        {
          label: "Disable",
          click: () => stopAwakeMode(),
        },
      ],
    },
    { type: "separator" },
    {
      label: getPreference("showDurationTimer", true) ? "⏱ Hide Timer" : "⏱ Show Timer",
      click: () => {
        const current = getPreference("showDurationTimer", true);
        setPreference("showDurationTimer", !current);
        if (current && tray) {
          // Turning off — clear tray title immediately
          tray.setTitle("");
        }
        updateTrayMenu(); // Rebuild menu to reflect new label
      },
    },
    { label: "Refresh", click: updateTrayMenu },
    {
      label: "Open App",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        } else {
          createWindow(); // Recreate if destroyed
        }
      },
    },
    { label: "Quit", click: () => app.quit() },
  );

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

// Handle Connect from Tray
// Keep track of duration interval separately from disconnect timers
let durationIntervals = new Map();

async function handleTrayConnect(serverId, filename, duration = null) {
  // If already connected, do nothing (or show error)
  if (openvpnProcesses.has(serverId)) {
    return false;
  }

  // Load saved credentials for this server
  const savedCredentials = await loadVpnCredentials(filename);
  createAuthWindow(serverId, filename, duration, savedCredentials);
  return true;
}

function createAuthWindow(serverId, filename, duration, savedCredentials = null) {
  // Only parent to main window if it exists and is visible
  const parentWindow =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
      ? mainWindow
      : null;

  const authWin = new BrowserWindow({
    width: 400,
    height: 540,
    title: "Connect to VPN",
    minimizable: false,
    maximizable: false,
    resizable: false,
    modal: !!parentWindow,
    parent: parentWindow || undefined,
    alwaysOnTop: !parentWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simple IPC without preload
    },
  });

  authWin.setMenu(null); // Hide menu bar

  // macOS: ensure the app is visible and the window gets focus when standalone
  if (process.platform === "darwin" && !parentWindow) {
    app.dock.show();
  }

  // Pre-fill values from saved credentials
  const prefillEmail = savedCredentials && savedCredentials.email ? savedCredentials.email : "";
  const prefillPassword = savedCredentials && savedCredentials.password ? savedCredentials.password : "";
  const checkSaveEmail = savedCredentials && savedCredentials.email ? "checked" : "";
  const checkSavePassword = savedCredentials && savedCredentials.password ? "checked" : "";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: system-ui, sans-serif; padding: 20px; background: #1f2937; color: white; display: flex; flex-direction: column; }
            h2 { text-align: center; margin-bottom: 20px; font-size: 18px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-size: 14px; color: #9ca3af; }
            input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #374151; background: #374151; color: white; box-sizing: border-box; }
            input:focus { outline: none; border-color: #3b82f6; }
            button { width: 100%; padding: 10px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px; }
            button:hover { background: #2563eb; }
            .cancel { background: transparent; border: 1px solid #4b5563; color: #9ca3af; margin-top: 10px; }
            .cancel:hover { background: #374151; color: white; }
            .info { font-size: 12px; color: #6b7280; margin-top: 10px; text-align: center; }
            .checkbox-group { display: flex; align-items: center; margin-bottom: 8px; }
            .checkbox-group input[type="checkbox"] { width: auto; margin-right: 8px; }
            .checkbox-group label { margin: 0; display: inline; }
        </style>
    </head>
    <body>
        <h2>Connect to ${filename}</h2>
        <form id="authForm">
            <div class="form-group">
                <label>Username / Email</label>
                <input type="text" id="email" required autofocus placeholder="Enter username" value="${prefillEmail}">
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="password" required placeholder="Enter password" value="${prefillPassword}">
            </div>
            <div class="checkbox-group">
                 <input type="checkbox" id="saveEmail" ${checkSaveEmail}>
                 <label for="saveEmail">Save Username</label>
            </div>
            <div class="checkbox-group">
                 <input type="checkbox" id="savePassword" ${checkSavePassword}>
                 <label for="savePassword">Save Password</label>
            </div>
            <div style="border-top: 1px solid #374151; margin: 12px 0; padding-top: 12px;">
                <div class="checkbox-group">
                     <input type="checkbox" id="applyAll">
                     <label for="applyAll">Apply to all configs</label>
                </div>
                <p id="applyAllHint" style="font-size: 11px; color: #eab308; display: none; margin-top: 4px;">Credentials will be saved to all config files</p>
            </div>
            <button type="submit" id="connectBtn">Connect</button>
            <button type="button" class="cancel" onclick="window.close()">Cancel</button>
        </form>
        <p class="info" id="status"></p>
        <script>
            const { ipcRenderer } = require('electron');
            
            // Show/hide apply all hint
            document.getElementById('applyAll').addEventListener('change', (e) => {
                document.getElementById('applyAllHint').style.display = e.target.checked ? 'block' : 'none';
            });
            
            document.getElementById('authForm').onsubmit = (e) => {
                e.preventDefault();
                const btn = document.getElementById('connectBtn');
                const status = document.getElementById('status');
                
                btn.disabled = true;
                btn.textContent = 'Connecting...';
                status.textContent = 'Initiating connection...';
                
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const saveEmail = document.getElementById('saveEmail').checked;
                const savePassword = document.getElementById('savePassword').checked;
                const applyAll = document.getElementById('applyAll').checked;
                
                ipcRenderer.send('tray-auth-submit', { 
                    email, 
                    password, 
                    saveEmail,
                    savePassword,
                    applyAll,
                    serverId: '${serverId}', 
                    filename: '${filename}',
                    duration: ${duration ? duration : "null"}
                });
            };
            
            ipcRenderer.on('connection-error', (event, msg) => {
                 const btn = document.getElementById('connectBtn');
                 const status = document.getElementById('status');
                 btn.disabled = false;
                 btn.textContent = 'Connect';
                 status.textContent = msg;
                 status.style.color = '#ef4444';
            });
        </script>
    </body>
    </html>
    `;

  authWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
  );

  // Show and focus for standalone mode
  authWin.once("ready-to-show", () => {
    authWin.show();
    authWin.focus();
  });

  // Store reference securely if needed, but for now allow garbage collection on close
  authWin.on("closed", () => {
    // cleanup
  });
}

// Handle Form Submit from Auth Window
ipcMain.on("tray-auth-submit", async (event, data) => {
  const { email, password, saveEmail, savePassword, applyAll, serverId, filename, duration } = data;
  const filePath = path.join(VPN_DIRECTORY, filename);
  const senderWebContents = event.sender; // To reply back to the window

  // Call connectVpn
  const result = await connectVpn({
    serverId,
    filePath,
    email,
    password,
    saveEmail,
  });

  if (result.success) {
    // Handle credential persistence via keytar
    const credsToSave = {};
    if (saveEmail) {
      credsToSave.email = email;
    } else {
      // Delete saved email if unchecked
      await keytar.deletePassword(VPN_CRED_SERVICE, `${filename}_email`).catch(() => { });
    }
    if (savePassword) {
      credsToSave.password = password;
    } else {
      // Delete saved password if unchecked
      await keytar.deletePassword(VPN_CRED_SERVICE, `${filename}_password`).catch(() => { });
    }
    if (Object.keys(credsToSave).length > 0) {
      await saveVpnCredentials(filename, credsToSave);
    }

    // Bulk save credentials to all configs if "Apply to all" is checked
    if (applyAll) {
      try {
        const files = fs.readdirSync(VPN_DIRECTORY).filter((f) => f.endsWith(".ovpn"));
        const bulkCreds = {};
        if (saveEmail && email) bulkCreds.email = email;
        if (savePassword && password) bulkCreds.password = password;
        if (Object.keys(bulkCreds).length > 0) {
          await Promise.all(files.map((file) => saveVpnCredentials(file, bulkCreds)));
          logToFile("INFO", `Tray: Bulk saved credentials to ${files.length} configs`);
        }
      } catch (bulkError) {
        console.error("Error bulk saving from tray:", bulkError);
      }
    }

    // Close the auth window
    const win = BrowserWindow.fromWebContents(senderWebContents);
    if (win) win.close();

    // Handle duration
    if (duration) {
      const timer = setTimeout(async () => {
        console.log(`Duration expired for ${serverId}. Disconnecting...`);
        await handleTrayDisconnect(serverId);
        if (Notification.isSupported()) {
          new Notification({
            title: "RCP Network",
            body: `Connection ${filename} ended (Duration expired)`,
          }).show();
        }
      }, duration);
      connectionTimers.set(serverId, timer);
    }

    // Update Tray to show we are connected
    updateTrayMenu();
  } else {
    // Send error back to window
    senderWebContents.send(
      "connection-error",
      result.error || "Connection failed",
    );
  }
});

async function handleTrayDisconnect(serverId) {
  // Clear timer if exists
  if (connectionTimers.has(serverId)) {
    clearTimeout(connectionTimers.get(serverId));
    connectionTimers.delete(serverId);
  }

  // Call shared disconnect logic
  const result = await disconnectVpn(serverId);
  // We should return result so caller can show error
  return result;
}

// Quit when all windows are closed
app.on("window-all-closed", () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  logToFile("INFO", "Application closing...");

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Cleanup on app quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  logToFile("INFO", "Application quit");
});

// Security: Prevent new window creation
app.on("web-contents-created", (event, contents) => {
  contents.on("new-window", (event, navigationUrl) => {
    event.preventDefault();
  });
});

// Store validated sudo password (in memory, also saved to keychain)
let validatedSudoPassword = null;

// Platform detection helpers

const getPlatformName = () => {
  if (isWindows()) return "Windows";
  if (isLinux()) return "Linux";
  if (isMacOS()) return "macOS";
  return "Unknown";
};

// Get installation guide URL based on platform
const getInstallationGuide = (platform) => {
  if (platform === "Windows") {
    return "https://openvpn.net/community-downloads/";
  } else if (platform === "Linux") {
    return "https://community.openvpn.net/openvpn/wiki/OpenvpnSoftwareRepos";
  } else if (platform === "macOS") {
    return "https://openvpn.net/community-downloads/";
  }
  return "https://openvpn.net/community-downloads/";
};

// Install OpenVPN via Homebrew (macOS only)
const installOpenVpnViaBrew = async (sudoPassword, mainWindow = null) => {
  const sendProgress = (step, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('install-progress', { step, message });
    }
  };
  try {
    logToFile("INFO", "Starting OpenVPN installation via Homebrew...");
    sendProgress(1, "Checking OpenVPN installation...");

    // Escape password for shell
    const escapedPassword = sudoPassword
      .replace(/'/g, "'\\''")
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");

    // Step 1: Check if Homebrew is installed
    let brewInstalled = false;
    try {
      const envPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";
      await execAsync("which brew", {
        timeout: 3000,
        env: { ...process.env, PATH: envPath },
      });
      brewInstalled = true;
      logToFile("INFO", "Homebrew is already installed");
      sendProgress(2, "Homebrew found, preparing installation...");
    } catch (error) {
      logToFile("WARN", "Homebrew not found, will attempt to install it");
      sendProgress(2, "Homebrew not found, will install it first...");
    }

    // Step 2: Install Homebrew if not present
    if (!brewInstalled) {
      // Show notification
      if (Notification.isSupported()) {
        new Notification({
          title: "RCP Network",
          body: "Installing Homebrew package manager...",
        }).show();
      }

      logToFile("INFO", "Installing Homebrew...");
      sendProgress(2, "Installing Homebrew package manager...");

      // Download and install Homebrew
      // Using the official Homebrew installation script
      const brewInstallCmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;

      try {
        // Run Homebrew installation with sudo password
        await execAsync(brewInstallCmd, {
          timeout: 300000, // 5 minutes timeout
          env: {
            ...process.env,
            NONINTERACTIVE: "1" // Non-interactive installation
          },
        });

        logToFile("INFO", "Homebrew installed successfully");

        // Update PATH to include Homebrew
        const brewPath = process.arch === 'arm64' ? '/opt/homebrew/bin' : '/usr/local/bin';
        process.env.PATH = `${brewPath}:${process.env.PATH}`;

      } catch (error) {
        logToFile("ERROR", "Failed to install Homebrew:", error.message);

        if (Notification.isSupported()) {
          new Notification({
            title: "RCP Network",
            body: "Failed to install Homebrew. Please install manually.",
          }).show();
        }

        return {
          installed: false,
          error: "Failed to install Homebrew. Please install it manually from https://brew.sh",
        };
      }
    }

    // Step 3: Install OpenVPN via Homebrew
    if (Notification.isSupported()) {
      new Notification({
        title: "RCP Network",
        body: "Installing OpenVPN in the background...",
      }).show();
    }

    logToFile("INFO", "Installing OpenVPN via Homebrew...");
    sendProgress(3, "Installing OpenVPN (this may take 2-5 minutes)...");

    const envPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";

    // Install OpenVPN using brew with sudo password
    const installCmd = `echo '${escapedPassword}' | sudo -S brew install openvpn`;

    try {
      const { stdout, stderr } = await execAsync(installCmd, {
        timeout: 600000, // 10 minutes timeout for installation
        env: { ...process.env, PATH: envPath },
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for output
      });

      logToFile("INFO", "OpenVPN installation output:", stdout);
      if (stderr) {
        logToFile("WARN", "OpenVPN installation stderr:", stderr);
      }

      // Verify installation
      try {
        const openvpnPath = await findOpenVpnPath();
        logToFile("INFO", "OpenVPN successfully installed at:", openvpnPath);
        sendProgress(4, "Verifying installation...");
        sendProgress(5, "Setup complete!");

        if (Notification.isSupported()) {
          new Notification({
            title: "RCP Network",
            body: "OpenVPN installed successfully!",
          }).show();
        }

        return {
          installed: true,
          path: openvpnPath,
          message: "OpenVPN installed successfully via Homebrew",
        };
      } catch (verifyError) {
        logToFile("ERROR", "OpenVPN installation verification failed:", verifyError.message);

        if (Notification.isSupported()) {
          new Notification({
            title: "RCP Network",
            body: "OpenVPN installation completed but verification failed. Please restart the app.",
          }).show();
        }

        return {
          installed: false,
          error: "OpenVPN installation completed but verification failed. Please restart the application.",
        };
      }

    } catch (error) {
      logToFile("ERROR", "Failed to install OpenVPN:", error.message);

      if (Notification.isSupported()) {
        new Notification({
          title: "RCP Network",
          body: "Failed to install OpenVPN. Please install manually.",
        }).show();
      }

      return {
        installed: false,
        error: `Failed to install OpenVPN: ${error.message}. Please install manually using: brew install openvpn`,
      };
    }

  } catch (error) {
    logToFile("ERROR", "Error in installOpenVpnViaBrew:", error.message);
    return {
      installed: false,
      error: `Installation error: ${error.message}`,
    };
  }
};


// Find OpenVPN executable path
const findOpenVpnPath = async () => {
  const platform = process.platform;
  logToFile("INFO", "Searching for OpenVPN on platform:", platform);

  if (isWindows()) {
    // Windows paths
    const possiblePaths = [
      "C:\\Program Files\\OpenVPN\\bin\\openvpn.exe",
      "C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe",
      "C:\\OpenVPN\\bin\\openvpn.exe",
    ];

    // Try to find using 'where' command
    try {
      const { stdout } = await execAsync("where openvpn", {
        timeout: 2000,
        shell: true,
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim().split("\r\n")[0].trim();
        logToFile("INFO", "Found OpenVPN using where:", foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile(
        "WARN",
        "where openvpn failed, trying direct paths...",
        e.message,
      );
    }

    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile("INFO", "Found OpenVPN at:", testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }

    // Last resort: try to execute openvpn --version
    try {
      await execAsync("openvpn --version", {
        timeout: 2000,
        shell: true,
      });
      logToFile("INFO", "OpenVPN found in PATH (verified with --version)");
      return "openvpn.exe";
    } catch (e) {
      logToFile("ERROR", "OpenVPN not found in PATH or common locations");
      throw new Error(
        "OpenVPN not found. Please install OpenVPN from https://openvpn.net/community-downloads/",
      );
    }
  } else if (isLinux()) {
    // Linux paths
    const possiblePaths = [
      "/usr/bin/openvpn",
      "/usr/sbin/openvpn",
      "/usr/local/bin/openvpn",
      "/usr/local/sbin/openvpn",
      "/opt/openvpn/bin/openvpn",
    ];

    // Try to find using 'which' command
    try {
      const envPath =
        process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      const { stdout } = await execAsync("which openvpn", {
        timeout: 2000,
        env: { ...process.env, PATH: envPath },
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim();
        logToFile("INFO", "Found OpenVPN using which:", foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile(
        "WARN",
        "which openvpn failed, trying direct paths...",
        e.message,
      );
    }

    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile("INFO", "Found OpenVPN at:", testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }

    // Last resort: try to execute openvpn --version
    try {
      const envPath =
        process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      await execAsync("openvpn --version", {
        timeout: 2000,
        env: { ...process.env, PATH: envPath },
      });
      logToFile("INFO", "OpenVPN found in PATH (verified with --version)");
      return "openvpn";
    } catch (e) {
      logToFile("ERROR", "OpenVPN not found in PATH or common locations");
      throw new Error(
        "OpenVPN not found. Please install OpenVPN. For Linux: https://community.openvpn.net/openvpn/wiki/OpenvpnSoftwareRepos",
      );
    }
  } else {
    // macOS paths (existing implementation)
    const possiblePaths = [
      "/opt/homebrew/sbin/openvpn", // Homebrew Apple Silicon (sbin)
      "/opt/homebrew/bin/openvpn", // Homebrew Apple Silicon (bin)
      "/usr/local/sbin/openvpn", // Homebrew Intel (sbin)
      "/usr/local/bin/openvpn", // Homebrew Intel (bin)
      "/usr/sbin/openvpn", // System sbin
      "/usr/bin/openvpn", // System bin
    ];

    // Try to find using 'which' command
    try {
      const envPath =
        process.env.PATH ||
        "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";
      const { stdout } = await execAsync("which openvpn", {
        timeout: 2000,
        env: { ...process.env, PATH: envPath },
      });
      if (stdout && stdout.trim()) {
        const foundPath = stdout.trim();
        logToFile("INFO", "Found OpenVPN using which:", foundPath);
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch (e) {
      logToFile(
        "WARN",
        "which openvpn failed, trying direct paths...",
        e.message,
      );
    }

    // Try direct path check
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logToFile("INFO", "Found OpenVPN at:", testPath);
          return testPath;
        }
      } catch (e) {
        continue;
      }
    }

    // Last resort: try to execute openvpn --version
    try {
      const envPath =
        process.env.PATH ||
        "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";
      await execAsync("openvpn --version", {
        timeout: 2000,
        env: { ...process.env, PATH: envPath },
      });
      logToFile("INFO", "OpenVPN found in PATH (verified with --version)");
      return "openvpn";
    } catch (e) {
      logToFile("ERROR", "OpenVPN not found in PATH or common locations");
      throw new Error(
        "OpenVPN not found. Please install OpenVPN or add it to your PATH.",
      );
    }
  }
};

// Load sudo password from keychain on startup
const loadSudoPasswordFromKeychain = async () => {
  try {
    const password = await keytar.getPassword(
      KEYCHAIN_SERVICE,
      KEYCHAIN_ACCOUNT,
    );
    if (password) {
      validatedSudoPassword = password;
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error loading password from keychain:", error);
    return false;
  }
};

// Save sudo password to keychain
const saveSudoPasswordToKeychain = async (password) => {
  try {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, password);
    return true;
  } catch (error) {
    console.error("Error saving password to keychain:", error);
    return false;
  }
};

// Delete sudo password from keychain
const deleteSudoPasswordFromKeychain = async () => {
  try {
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    return true;
  } catch (error) {
    console.error("Error deleting password from keychain:", error);
    return false;
  }
};

// Save VPN credentials to system keychain (per-server)
const saveVpnCredentials = async (filename, { email, password }) => {
  try {
    if (email !== undefined && email !== null) {
      await keytar.setPassword(VPN_CRED_SERVICE, `${filename}_email`, email);
    }
    if (password !== undefined && password !== null) {
      await keytar.setPassword(VPN_CRED_SERVICE, `${filename}_password`, password);
    }
    logToFile("INFO", `VPN credentials saved for ${filename}`);
    return true;
  } catch (error) {
    console.error("Error saving VPN credentials:", error);
    return false;
  }
};

// Load VPN credentials from system keychain (per-server)
const loadVpnCredentials = async (filename) => {
  try {
    const email = await keytar.getPassword(VPN_CRED_SERVICE, `${filename}_email`);
    const password = await keytar.getPassword(VPN_CRED_SERVICE, `${filename}_password`);
    return { email: email || null, password: password || null };
  } catch (error) {
    console.error("Error loading VPN credentials:", error);
    return { email: null, password: null };
  }
};

// Delete VPN credentials from system keychain (per-server)
const deleteVpnCredentials = async (filename) => {
  try {
    await keytar.deletePassword(VPN_CRED_SERVICE, `${filename}_email`).catch(() => { });
    await keytar.deletePassword(VPN_CRED_SERVICE, `${filename}_password`).catch(() => { });
    logToFile("INFO", `VPN credentials deleted for ${filename}`);
    return true;
  } catch (error) {
    console.error("Error deleting VPN credentials:", error);
    return false;
  }
};

// Check if VPN directory exists
const checkVpnDirectory = () => {
  try {
    return (
      fs.existsSync(VPN_DIRECTORY) && fs.statSync(VPN_DIRECTORY).isDirectory()
    );
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
        const escapedPassword = password
          .replace(/'/g, "'\\''")
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");
        const escapedDir = VPN_DIRECTORY.replace(/'/g, "'\\''");
        const command = `echo '${escapedPassword}' | sudo -S mkdir -p '${escapedDir}' && echo '${escapedPassword}' | sudo -S chmod 755 '${escapedDir}'`;

        try {
          await execAsync(command, { timeout: 5000 });
          return { success: true, usedSudo: true };
        } catch (sudoError) {
          return {
            success: false,
            error:
              "Failed to create directory with sudo. Please check your password.",
          };
        }
      } else {
        return {
          success: false,
          error: "Directory creation requires sudo password",
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || "Failed to create directory",
    };
  }
};

// Process .ovpn file: remove unwanted configs
const processOvpnFile = (filePath) => {
  try {
    // Read file content
    let content = fs.readFileSync(filePath, "utf8");
    const originalContent = content;

    // Configs to remove (exact match, case-insensitive)
    const configsToRemove = [
      "client-cert-not-required",
      "verify-client-cert none",
    ];

    // Split into lines
    const lines = content.split("\n");
    let modified = false;

    // Process each line
    const processedLines = lines
      .map((line) => {
        const trimmedLine = line.trim();

        // Check if line matches any config to remove
        for (const config of configsToRemove) {
          // Match exact config (case-insensitive)
          // Handle both "config" and "config " (with trailing space)
          const regex = new RegExp(
            `^${config.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
            "i",
          );
          if (regex.test(trimmedLine)) {
            modified = true;
            return null; // Mark for removal
          }
        }

        return line; // Keep the line
      })
      .filter((line) => line !== null); // Remove null lines

    // Join lines back
    content = processedLines.join("\n");

    // Write processed content back to file if modified
    if (modified) {
      fs.writeFileSync(filePath, content, "utf8");
      return {
        success: true,
        modified: true,
        message: "File processed: Removed unwanted configs",
      };
    }

    return {
      success: true,
      modified: false,
      message: "No changes needed",
    };
  } catch (error) {
    console.error("Error processing .ovpn file:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// IPC Handlers
ipcMain.handle("open-file-dialog", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Select OpenVPN Configuration File",
      filters: [
        { name: "OpenVPN Config", extensions: ["ovpn"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled) {
      return { canceled: true };
    }

    const originalFilePath = result.filePaths[0];
    const fileName = path.basename(originalFilePath, ".ovpn");

    // Verify file exists and is readable
    try {
      fs.accessSync(originalFilePath, fs.constants.R_OK);

      // Use VPN directory in home folder (~/.vpn_client)
      // Ensure directory exists (should be created during sudo password validation)
      if (!checkVpnDirectory()) {
        return {
          canceled: false,
          error:
            "VPN directory does not exist. Please restart the application and enter sudo password.",
        };
      }

      // Copy file to VPN directory
      const destinationPath = path.join(VPN_DIRECTORY, `${fileName}.ovpn`);

      // If file already exists, add timestamp to make it unique
      let finalDestinationPath = destinationPath;
      if (fs.existsSync(finalDestinationPath)) {
        const timestamp = Date.now();
        finalDestinationPath = path.join(
          VPN_DIRECTORY,
          `${fileName}_${timestamp}.ovpn`,
        );
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
          console.error("Error cleaning up file:", e);
        }
        return {
          canceled: false,
          error: processResult.error || "Failed to process file",
        };
      }

      return {
        canceled: false,
        filePath: finalDestinationPath, // Return path to copied file
        originalPath: originalFilePath, // Keep original path for reference
        fileName: fileName,
        processed: processResult.modified,
        message: processResult.message,
      };
    } catch (error) {
      return {
        canceled: false,
        error: error.message || "File cannot be read or copied",
      };
    }
  } catch (error) {
    console.error("Error opening file dialog:", error);
    return {
      canceled: false,
      error: error.message,
    };
  }
});

// Validate sudo password
ipcMain.handle("validate-sudo-password", async (event, password) => {
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
            error: createResult.error || "Failed to create VPN directory",
          };
        }
        directoryCreated = createResult.usedSudo || false;
      }

      return {
        success: true,
        message: directoryCreated
          ? "Directory created successfully"
          : "Ready to use",
        directoryCreated: directoryCreated,
        directoryExists: directoryExists || directoryCreated,
      };
    }

    // For Linux/macOS: validate sudo password
    // Test password by trying to run a sudo command
    // Use -S flag to read password from stdin
    // Escape special characters in password
    const escapedPassword = password
      .replace(/'/g, "'\\''")
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");

    // Use a safer method: write password to a temporary approach
    // For security, we'll use sudo -S with echo piped
    const testCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;

    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        timeout: 5000,
        maxBuffer: 1024,
      });

      // Check if sudo succeeded (no error output means success)
      if (stderr && stderr.includes("Sorry, try again")) {
        return {
          success: false,
          error: "Invalid password. Please try again.",
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
            error: createResult.error || "Failed to create VPN directory",
          };
        }
        directoryCreated = createResult.usedSudo || false;
      }

      // For macOS: Check if OpenVPN is installed, if not, install via Homebrew
      let openvpnInstallStatus = null;
      if (isMacOS()) {
        try {
          // Check if OpenVPN is already installed
          const openvpnPath = await findOpenVpnPath();
          logToFile("INFO", "OpenVPN already installed at:", openvpnPath);
          openvpnInstallStatus = { installed: true, path: openvpnPath };
        } catch (error) {
          // OpenVPN not found, attempt to install via Homebrew
          logToFile(
            "INFO",
            "OpenVPN not found, attempting to install via Homebrew...",
          );
          const win = BrowserWindow.fromWebContents(event.sender);
          openvpnInstallStatus = await installOpenVpnViaBrew(password, win);
        }
      }

      return {
        success: true,
        message: directoryCreated
          ? "Password validated and directory created successfully"
          : "Password validated successfully",
        directoryCreated: directoryCreated,
        directoryExists: directoryExists || directoryCreated,
        openvpnInstallStatus: openvpnInstallStatus,
      };
    } catch (error) {
      // Check error message to determine if it's invalid password
      if (error.stderr && error.stderr.includes("Sorry, try again")) {
        return {
          success: false,
          error: "Invalid password. Please try again.",
        };
      }

      // Other errors
      return {
        success: false,
        error: "Failed to validate password. Please try again.",
      };
    }
  } catch (error) {
    console.error("Error validating sudo password:", error);
    return {
      success: false,
      error: error.message || "Failed to validate password",
    };
  }
});

// Get validated sudo password (for use in VPN operations)
ipcMain.handle("get-sudo-password", async () => {
  return validatedSudoPassword;
});

// Check VPN directory status
ipcMain.handle("check-vpn-directory", async () => {
  const exists = checkVpnDirectory();
  return {
    exists: exists,
    path: VPN_DIRECTORY,
    needsSudo: !exists, // If doesn't exist, might need sudo
  };
});

// Get all VPN configurations from directory (Source of Truth)
ipcMain.handle("get-all-configs", async () => {
  try {
    if (!fs.existsSync(VPN_DIRECTORY)) {
      return [];
    }
    const files = fs
      .readdirSync(VPN_DIRECTORY)
      .filter((file) => file.endsWith(".ovpn"));
    return files.map((file) => ({
      id: file, // Use filename as unique ID to match Tray logic
      name: file.replace(".ovpn", ""), // Default name
      filePath: path.join(VPN_DIRECTORY, file),
      // We can check connection status here too if needed, but App does it via getActiveConnections
    }));
  } catch (error) {
    console.error("Error reading VPN directory:", error);
    return [];
  }
});

// Check if sudo password is available and valid (from keychain or memory)
ipcMain.handle("check-sudo-password", async () => {
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
      const escapedPassword = validatedSudoPassword
        .replace(/'/g, "'\\''")
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
      const testCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;

      try {
        const { stderr } = await execAsync(testCommand, {
          timeout: 5000,
          maxBuffer: 1024,
        });

        // Check if sudo succeeded
        if (stderr && stderr.includes("Sorry, try again")) {
          // Password invalid, clear it
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return false;
        }

        // Password is still valid
        return true;
      } catch (error) {
        // Password might be invalid or expired
        if (error.stderr && error.stderr.includes("Sorry, try again")) {
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return false;
        }
        // Other errors, assume password is still valid
        return true;
      }
    } catch (error) {
      console.error("Error validating password:", error);
      return false;
    }
  }

  return false;
});

// Check if OpenVPN is installed
ipcMain.handle("check-openvpn-installed", async () => {
  const platform = getPlatformName();
  const installationGuide = getInstallationGuide(platform);

  try {
    const openvpnPath = await findOpenVpnPath();
    logToFile("INFO", "OpenVPN check: Installed at", openvpnPath);
    return {
      installed: true,
      path: openvpnPath,
      platform: platform,
      error: null,
      installationGuide: installationGuide,
    };
  } catch (error) {
    logToFile("ERROR", "OpenVPN check: Not installed", error.message);
    return {
      installed: false,
      path: null,
      platform: platform,
      error: error.message,
      installationGuide: installationGuide,
    };
  }
});

// Store running OpenVPN processes (key: serverId, value: process info)
const openvpnProcesses = new Map();

// Append email to .ovpn file if saveEmail is true
const appendEmailToOvpn = (filePath, email) => {
  try {
    let content = fs.readFileSync(filePath, "utf8");

    // Check if auth-user-pass already exists (with or without value)
    const authUserPassRegex = /^auth-user-pass(\s+.*)?$/im;
    const lines = content.split("\n");
    let found = false;
    let modified = false;

    // Process lines: remove existing auth-user-pass and add new one
    const processedLines = lines.map((line) => {
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

    content = processedLines.join("\n");

    // Write back to file
    fs.writeFileSync(filePath, content, "utf8");

    return { success: true, modified: modified };
  } catch (error) {
    console.error("Error appending email to .ovpn file:", error);
    return { success: false, error: error.message };
  }
};

// Remove email from .ovpn file (remove auth-user-pass line with email)
const removeEmailFromOvpn = (filePath) => {
  try {
    let content = fs.readFileSync(filePath, "utf8");

    // Check if auth-user-pass with email exists
    const authUserPassRegex = /^auth-user-pass\s+.*$/im;
    const lines = content.split("\n");
    let modified = false;

    // Remove lines that match auth-user-pass with value (email)
    const processedLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (authUserPassRegex.test(trimmed)) {
        modified = true;
        return false; // Remove this line
      }
      return true; // Keep this line
    });

    content = processedLines.join("\n");

    // Write back to file if modified
    if (modified) {
      fs.writeFileSync(filePath, content, "utf8");
    }

    return { success: true, modified: modified };
  } catch (error) {
    console.error("Error removing email from .ovpn file:", error);
    return { success: false, error: error.message };
  }
};

// Helper: Flush DNS Cache
const flushDns = async () => {
  logToFile("INFO", "Flushing DNS cache...");
  try {
    if (isWindows()) {
      // On Windows, ipconfig /flushdns usually requires Admin.
      // If the app is not running as admin, this might fail or do nothing for the system cache.
      // However, we attempt it. If we are already admin, it works.
      await execAsync("ipconfig /flushdns");
      logToFile("INFO", "DNS cache flushed (Windows).");
    } else if (isMacOS()) {
      if (validatedSudoPassword) {
        const escapedPassword = validatedSudoPassword
          .replace(/'/g, "'\\''")
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");
        // macOS: dscacheutil -flushcache; sudo killall -HUP mDNSResponder
        // Use sh -c to run both in one sudo session
        const cmd = `echo '${escapedPassword}' | sudo -S sh -c 'dscacheutil -flushcache; killall -HUP mDNSResponder'`;
        await execAsync(cmd);
        logToFile("INFO", "DNS cache flushed (macOS).");
      } else {
        logToFile("WARN", "Skipping DNS flush: No sudo password available.");
      }
    } else {
      // Linux: resolvectl is common for systemd-resolved
      if (validatedSudoPassword) {
        const escapedPassword = validatedSudoPassword
          .replace(/'/g, "'\\''")
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");
        const cmd = `echo '${escapedPassword}' | sudo -S resolvectl flush-caches`;
        try {
          await execAsync(cmd);
          logToFile("INFO", "DNS cache flushed (Linux - resolvectl).");
        } catch (e) {
          // Fallback or ignore if resolvectl not present
          logToFile(
            "WARN",
            "Failed to flush DNS with resolvectl, trying systemd-resolve...",
          );
          try {
            const cmd2 = `echo '${escapedPassword}' | sudo -S systemd-resolve --flush-caches`;
            await execAsync(cmd2);
            logToFile("INFO", "DNS cache flushed (Linux - systemd-resolve).");
          } catch (ex) {
            logToFile("ERROR", "Failed to flush DNS on Linux.");
          }
        }
      }
    }
  } catch (error) {
    logToFile("ERROR", "Failed to flush DNS:", error.message);
  }
};

const connectVpn = async (data) => {
  try {
    const { serverId, filePath, email, password, saveEmail } = data;

    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: "VPN file not found" };
    }

    // Ensure sudo password is available and valid (only for Linux/macOS)
    if (!isWindows()) {
      if (!validatedSudoPassword) {
        // Try to load from keychain
        const loaded = await loadSudoPasswordFromKeychain();
        if (!loaded) {
          return {
            success: false,
            error: "Sudo password not available. Please enter password first.",
          };
        }
      }

      // Validate password is still valid by refreshing sudo timestamp
      try {
        const escapedPassword = validatedSudoPassword
          .replace(/'/g, "'\\''")
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");
        const validateCommand = `echo '${escapedPassword}' | sudo -S -v 2>&1`;
        const { stderr } = await execAsync(validateCommand, {
          timeout: 5000,
          maxBuffer: 1024,
        });

        if (stderr && stderr.includes("Sorry, try again")) {
          // Password expired or invalid, clear it
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return {
            success: false,
            error: "Sudo password expired. Please enter password again.",
          };
        }
      } catch (error) {
        if (error.stderr && error.stderr.includes("Sorry, try again")) {
          validatedSudoPassword = null;
          await deleteSudoPasswordFromKeychain();
          return {
            success: false,
            error: "Sudo password expired. Please enter password again.",
          };
        }
        // Continue if other error (might be network issue, etc)
      }
    }

    // Note: Credential persistence (save email/password) is now handled
    // via keytar in the tray-auth-submit and connect-vpn IPC handlers,
    // not by modifying .ovpn files.

    // Build OpenVPN command
    const escapedFilePath = filePath.replace(/'/g, "'\\''");

    // Create auth file with email and password
    const tempAuthFile = path.join(
      VPN_DIRECTORY,
      `.vpn_auth_${Date.now()}.tmp`,
    );

    // If password/email are provided, write them.
    // If empty (Tray usage maybe?), we still write them, which might result in empty lines.
    // Ideally if empty, we hope the .ovpn handles it, but openvpn requires auth-user-pass file to have 2 lines if used.
    fs.writeFileSync(tempAuthFile, `${email || ""}\n${password || ""}`, "utf8");

    // Set file permissions (Unix only)
    if (!isWindows()) {
      fs.chmodSync(tempAuthFile, 0o600);
    }
    const escapedAuthFile = tempAuthFile.replace(/'/g, "'\\''");

    // Find OpenVPN executable path
    let openvpnPath;
    try {
      openvpnPath = await findOpenVpnPath();
      logToFile("INFO", "Using OpenVPN path:", openvpnPath);
    } catch (error) {
      logToFile("ERROR", "Failed to find OpenVPN:", error.message);
      return {
        success: false,
        error: error.message || "OpenVPN not found. Please install OpenVPN.",
      };
    }

    // Build command based on platform
    // Check if running as Admin on Windows
    const isWindowsAdmin = async () => {
      try {
        await execAsync("net session");
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
        // ALREADY ADMIN
        const winOpenVpn = openvpnPath;
        const winConfig = filePath;
        const winAuth = tempAuthFile;

        const command = `"${winOpenVpn}" --config "${winConfig}" --auth-user-pass "${winAuth}"`;

        logToFile("INFO", "Executing OpenVPN command (Already Admin)...");

        const execOptions = {
          cwd: VPN_DIRECTORY,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
          env: { ...process.env },
        };

        // Start process
        return new Promise((resolve) => {
          const openvpnProcess = exec(
            command,
            execOptions,
            async (error, stdout, stderr) => {
              if (serverId && openvpnProcesses.has(serverId)) {
                openvpnProcesses.delete(serverId);
              }
            },
          );

          if (openvpnProcess.stdout) {
            openvpnProcess.stdout.on("data", (d) => {
              const message = d.toString();
              console.log("OpenVPN stdout:", message);
              if (serverId && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("vpn-log", { serverId, message });
              }
            });
          }
          if (openvpnProcess.stderr) {
            openvpnProcess.stderr.on("data", (d) => {
              const message = d.toString();
              console.error("OpenVPN stderr:", message);
              if (serverId && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("vpn-log", { serverId, message });
              }
            });
          }

          if (!openvpnProcess.pid) {
            resolve({
              success: false,
              error: "Failed to start OpenVPN process.",
            });
            return;
          }

          console.log("OpenVPN process started with PID:", openvpnProcess.pid);
          openvpnProcess.unref();

          if (serverId) {
            openvpnProcesses.set(serverId, {
              process: openvpnProcess,
              filePath: filePath,
              tempAuthFile: tempAuthFile,
              startTime: Date.now(),
            });

            // Start Duration Ticker
            // Only supports showing one active duration in Tray Title (MacOS constraint usually)
            // If multiple are connected, we might need a strategy. For now, last connected wins or just the single one.
            if (tray) {
              const startTime = Date.now();
              const ticker = setInterval(() => {
                const showTimer = getPreference("showDurationTimer", true);
                if (!showTimer) {
                  if (isMacOS()) tray.setTitle("");
                  return;
                }
                const diff = Date.now() - startTime;
                const seconds = Math.floor((diff / 1000) % 60);
                const minutes = Math.floor((diff / (1000 * 60)) % 60);
                const hours = Math.floor(diff / (1000 * 60 * 60));

                const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

                if (isMacOS()) {
                  tray.setTitle(timeString);
                } else {
                  tray.setToolTip(`RCP Network: ${timeString}`);
                }
              }, 1000);
              durationIntervals.set(serverId, ticker);
            }

            openvpnProcess.on("exit", (code, signal) => {
              if (openvpnProcesses.has(serverId)) {
                openvpnProcesses.delete(serverId);
                // Clear tickers
                if (durationIntervals.has(serverId)) {
                  clearInterval(durationIntervals.get(serverId));
                  durationIntervals.delete(serverId);
                  durationIntervals.delete(serverId);
                  if (tray && durationIntervals.size === 0) tray.setTitle("");
                }
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send("vpn-disconnected", {
                    serverId,
                    reason: `Process exited with code ${code}`,
                  });
                }
                try {
                  fs.unlinkSync(tempAuthFile);
                } catch (e) { }
                updateTrayMenu(); // Update tray on exit
              }
            });
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("vpn-connected", {
              serverId,
              startTime: Date.now(),
            });
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("vpn-connected", {
              serverId,
              startTime: Date.now(),
            });
          }

          startTrafficMonitor();
          flushDns().then(() => {
            resolve({
              success: true,
              message: "VPN connection started (Admin Mode)",
              serverId: serverId,
            });
          });
        });
      } else {
        // NOT ADMIN: Must trigger UAC
        const logPath = path.join(
          VPN_DIRECTORY,
          `openvpn_${serverId || Date.now()}.log`,
        );

        if (fs.existsSync(logPath)) {
          try {
            fs.unlinkSync(logPath);
          } catch (e) { }
        }

        const winOpenVpn = openvpnPath;
        const winConfig = filePath;
        const winAuth = tempAuthFile;

        const openVpnArgs = `--config "${winConfig}" --auth-user-pass "${winAuth}"`;

        const psCommand = `
            $p = Start-Process "${winOpenVpn}" -ArgumentList '${openVpnArgs}' -Verb RunAs -PassThru -RedirectStandardOutput "${logPath}" -RedirectStandardError "${logPath}" -WindowStyle Hidden;
            if ($p) { Write-Output $p.Id } else { exit 1 }
          `
          .replace(/\n/g, " ")
          .trim();

        logToFile(
          "INFO",
          "Executing elevated OpenVPN command (Requesting UAC)...",
          psCommand,
        );
        logToFile("INFO", "Log file:", logPath);

        try {
          const { stdout, stderr } = await execAsync(
            `powershell -Command "${psCommand}"`,
          );

          const pid = parseInt(stdout.trim());
          if (!pid || isNaN(pid)) {
            throw new Error("Failed to get PID from elevated process");
          }

          console.log("OpenVPN process started with PID (elevated):", pid);

          // Log tailing and monitoring
          let lastSize = 0;
          const logPoller = setInterval(() => {
            try {
              if (fs.existsSync(logPath)) {
                const stats = fs.statSync(logPath);
                if (stats.size > lastSize) {
                  const stream = fs.createReadStream(logPath, {
                    start: lastSize,
                    end: stats.size,
                  });
                  stream.on("data", (chunk) => {
                    const message = chunk.toString();
                    console.log("OpenVPN stdout:", message);
                    if (serverId && mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send("vpn-log", {
                        serverId,
                        message,
                      });
                    }
                  });
                  lastSize = stats.size;
                }
              }
            } catch (e) { }
          }, 500);

          // Monitor exit
          const exitMonitor = setInterval(async () => {
            try {
              const { stdout } = await execAsync(
                `tasklist /FI "PID eq ${pid}" /NH`,
              );
              if (!stdout.includes(pid.toString())) {
                clearInterval(exitMonitor);
                clearInterval(logPoller);
                if (serverId && openvpnProcesses.has(serverId)) {
                  openvpnProcesses.delete(serverId);
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("vpn-disconnected", {
                      serverId,
                      reason: "Elevated process exited",
                    });
                  }
                  try {
                    fs.unlinkSync(tempAuthFile);
                  } catch (e) { }
                  updateTrayMenu();
                }
              }
            } catch (e) { }
          }, 2000);

          if (serverId) {
            openvpnProcesses.set(serverId, {
              process: {
                pid: pid,
                kill: () => {
                  clearInterval(logPoller);
                  clearInterval(exitMonitor);
                },
                unref: () => { },
              },
              filePath: filePath,
              tempAuthFile: tempAuthFile,
              logPath: logPath,
              startTime: Date.now(),
            });

            // Duration Ticker
            if (tray) {
              const startTime = Date.now();
              const ticker = setInterval(() => {
                const showTimer = getPreference("showDurationTimer", true);
                if (!showTimer) {
                  if (isMacOS()) tray.setTitle("");
                  return;
                }
                const diff = Date.now() - startTime;
                const timeString = new Date(diff).toISOString().substr(11, 8);

                if (isMacOS()) {
                  tray.setTitle(timeString);
                } else {
                  tray.setToolTip(`RCP Network: ${timeString}`);
                }
              }, 1000);
              durationIntervals.set(serverId, ticker);
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("vpn-connected", {
                serverId,
                startTime: Date.now(),
              });
            }
          }

          startTrafficMonitor();
          await flushDns();
          return {
            success: true,
            message: "VPN connection started (Elevated)",
            serverId: serverId,
          };
        } catch (error) {
          logToFile(
            "ERROR",
            "Failed to start elevated process:",
            error.message,
          );
          // Error handling
          if (
            error.message &&
            (error.message.toLowerCase().includes("powershell") ||
              error.message.includes("not recognized"))
          ) {
            return {
              success: false,
              error: "PowerShell is required. Please restart as Administrator.",
            };
          }
          return { success: false, error: "Failed to start OpenVPN as Admin." };
        }
      }
    }

    // Linux/macOS Implementation
    let command;
    let envPath;

    // Linux/macOS: use sudo
    const escapedPassword = validatedSudoPassword
      .replace(/'/g, "'\\''")
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");
    envPath =
      process.env.PATH ||
      "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";
    command = `echo '${escapedPassword}' | sudo -S '${escapedOpenvpnPath}' --config '${escapedFilePath}' --auth-user-pass '${escapedAuthFile}'`;

    logToFile("INFO", "Executing OpenVPN command...");
    // ... logging ...

    // Execute OpenVPN in background
    const execOptions = {
      cwd: VPN_DIRECTORY,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: envPath,
      },
    };

    return new Promise((resolve) => {
      const openvpnProcess = exec(
        command,
        execOptions,
        async (error, stdout, stderr) => {
          if (error) {
            console.error("OpenVPN execution error:", error);
          }
          if (serverId) {
            openvpnProcesses.delete(serverId);
          }
        },
      );

      // Log stderr/stdout listeners ...
      if (openvpnProcess.stderr) {
        openvpnProcess.stderr.on("data", (d) => {
          const message = d.toString();
          console.error("OpenVPN stderr:", message);
          if (serverId && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("vpn-log", { serverId, message });
          }
        });
      }
      if (openvpnProcess.stdout) {
        openvpnProcess.stdout.on("data", (d) => {
          const message = d.toString();
          console.log("OpenVPN stdout:", message);
          if (serverId && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("vpn-log", { serverId, message });
          }
        });
      }

      if (!openvpnProcess.pid) {
        resolve({ success: false, error: "Failed to start OpenVPN process." });
        return;
      }

      console.log("OpenVPN process started with PID:", openvpnProcess.pid);
      openvpnProcess.unref();

      if (serverId) {
        openvpnProcesses.set(serverId, {
          process: openvpnProcess,
          filePath: filePath,
          tempAuthFile: tempAuthFile,
          startTime: Date.now(),
        });

        // Duration Ticker
        if (tray) {
          const startTime = Date.now();
          const ticker = setInterval(() => {
            const showTimer = getPreference("showDurationTimer", true);
            if (!showTimer) {
              if (isMacOS()) tray.setTitle("");
              return;
            }
            const diff = Date.now() - startTime;
            const timeString = new Date(diff).toISOString().substr(11, 8);

            if (isMacOS()) {
              tray.setTitle(timeString);
            } else {
              tray.setToolTip(`RCP Network: ${timeString}`);
            }
          }, 1000);
          durationIntervals.set(serverId, ticker);
        }

        openvpnProcess.on("exit", (code, signal) => {
          console.log(`OpenVPN process exited with code ${code}`);
          if (openvpnProcesses.has(serverId)) {
            openvpnProcesses.delete(serverId);

            // Clear tickers
            if (durationIntervals.has(serverId)) {
              clearInterval(durationIntervals.get(serverId));
              durationIntervals.delete(serverId);
              if (tray && durationIntervals.size === 0) tray.setTitle("");
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("vpn-disconnected", {
                serverId,
                reason: `Process exited with code ${code}`,
              });
            }
            try {
              fs.unlinkSync(tempAuthFile);
            } catch (e) { }
            updateTrayMenu();
          }
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("vpn-connected", {
            serverId,
            startTime: Date.now(),
          });
        }
      }
      startTrafficMonitor();
      flushDns().then(() => {
        resolve({
          success: true,
          message: "VPN connection started",
          serverId: serverId,
        });
      });
    });
  } catch (error) {
    console.error("Error connecting VPN:", error);
    return { success: false, error: error.message || "Failed to connect VPN" };
  }
};

// VPN Credential IPC Handlers
ipcMain.handle("save-vpn-credentials", async (event, filename, credentials) => {
  const success = await saveVpnCredentials(filename, credentials);
  return { success };
});

ipcMain.handle("load-vpn-credentials", async (event, filename) => {
  return await loadVpnCredentials(filename);
});

ipcMain.handle("delete-vpn-credentials", async (event, filename) => {
  const success = await deleteVpnCredentials(filename);
  return { success };
});

// Bulk Save VPN Credentials IPC
ipcMain.handle("bulk-save-vpn-credentials", async (event, credentials) => {
  try {
    const { email, password, saveEmail, savePassword } = credentials;
    if (!fs.existsSync(VPN_DIRECTORY)) {
      return { success: false, error: "VPN directory not found", count: 0 };
    }
    const files = fs.readdirSync(VPN_DIRECTORY).filter((f) => f.endsWith(".ovpn"));
    const credsToSave = {};
    if (saveEmail && email) credsToSave.email = email;
    if (savePassword && password) credsToSave.password = password;

    if (Object.keys(credsToSave).length === 0) {
      return { success: false, error: "No credentials to save", count: 0 };
    }

    await Promise.all(files.map((file) => saveVpnCredentials(file, credsToSave)));
    logToFile("INFO", `Bulk saved credentials to ${files.length} configs`);
    return { success: true, count: files.length };
  } catch (error) {
    console.error("Error bulk saving credentials:", error);
    return { success: false, error: error.message, count: 0 };
  }
});

// Timer Preference IPC
ipcMain.handle("get-timer-preference", async () => {
  return getPreference("showDurationTimer", true);
});

ipcMain.handle("set-timer-preference", async (event, value) => {
  setPreference("showDurationTimer", value);
  // Immediately clear or restore tray title
  if (!value && tray) {
    tray.setTitle("");
  }
  return { success: true };
});

// Connect VPN IPC
ipcMain.handle("connect-vpn", async (event, data) => {
  const result = await connectVpn(data);
  updateTrayMenu();
  return result;
});

// Get active connections with duration
ipcMain.handle("get-active-connections", async () => {
  const connections = {};
  for (const [id, info] of openvpnProcesses.entries()) {
    connections[id] = {
      startTime: info.startTime,
      duration: Date.now() - info.startTime,
    };
  }
  return connections;
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

const disconnectVpn = async (serverId) => {
  try {
    // Clear duration and ticker timers
    if (serverId) {
      if (connectionTimers.has(serverId)) {
        clearTimeout(connectionTimers.get(serverId));
        connectionTimers.delete(serverId);
      }
      if (durationIntervals.has(serverId)) {
        clearInterval(durationIntervals.get(serverId));
        durationIntervals.delete(serverId);
        // Reset tray title on disconnect
        if (tray && durationIntervals.size === 0) tray.setTitle("");
      }
    } else {
      // Clear all timers
      for (const [id, timer] of connectionTimers.entries()) {
        clearTimeout(timer);
      }
      connectionTimers.clear();
      for (const [id, interval] of durationIntervals.entries()) {
        clearInterval(interval);
      }
      durationIntervals.clear();
      if (tray) tray.setTitle("");
    }

    if (isWindows()) {
      // Windows: use taskkill
      if (serverId) {
        // Disconnect specific server
        const processInfo = openvpnProcesses.get(serverId);
        if (processInfo && processInfo.process && processInfo.process.pid) {
          // Cleanup custom process handlers (pollers)
          if (processInfo.process.kill) {
            try {
              processInfo.process.kill();
            } catch (e) { }
          }

          try {
            await execAsync(`taskkill /F /PID ${processInfo.process.pid}`, {
              timeout: 5000,
              shell: true,
            });
          } catch (e) {
            // Process might already be terminated
            logToFile("WARN", "Error killing process:", e.message);
          }

          // Clean up temp auth file
          if (
            processInfo.tempAuthFile &&
            fs.existsSync(processInfo.tempAuthFile)
          ) {
            try {
              fs.unlinkSync(processInfo.tempAuthFile);
            } catch (e) {
              console.error("Error deleting temp auth file:", e);
            }
          }

          // Clean up log file if exists (from elevated process)
          if (processInfo.logPath && fs.existsSync(processInfo.logPath)) {
            try {
              fs.unlinkSync(processInfo.logPath);
            } catch (e) { }
          }

          openvpnProcesses.delete(serverId);
          return { success: true, message: "VPN disconnected" };
        } else {
          openvpnProcesses.delete(serverId); // Ensure removed even if pid missing
          return { success: false, error: "VPN connection not found" };
        }
      } else {
        // Disconnect all VPNs
        if (openvpnProcesses.size > 0) {
          // Cleanup all processes including pollers
          for (const [id, processInfo] of openvpnProcesses.entries()) {
            if (processInfo.process && processInfo.process.kill) {
              try {
                processInfo.process.kill();
              } catch (e) { }
            }
            if (processInfo.logPath && fs.existsSync(processInfo.logPath)) {
              try {
                fs.unlinkSync(processInfo.logPath);
              } catch (e) { }
            }
          }

          try {
            await execAsync("taskkill /F /IM openvpn.exe", {
              timeout: 5000,
              shell: true,
            });
          } catch (e) {
            // Process might already be terminated or not running
            logToFile("WARN", "Error killing OpenVPN processes:", e.message);
          }

          // Clean up all temp auth files
          for (const [id, processInfo] of openvpnProcesses.entries()) {
            if (
              processInfo.tempAuthFile &&
              fs.existsSync(processInfo.tempAuthFile)
            ) {
              try {
                fs.unlinkSync(processInfo.tempAuthFile);
              } catch (e) {
                console.error("Error deleting temp auth file:", e);
              }
            }
          }

          openvpnProcesses.clear();
          return { success: true, message: "All VPNs disconnected" };
        } else {
          return { success: true, message: "No active VPN connections" };
        }
      }
    } else {
      // Linux/macOS: use pkill with sudo if needed

      // Ensure sudo password is loaded for disconnect
      if (!validatedSudoPassword) {
        try {
          await loadSudoPasswordFromKeychain();
        } catch (e) { }
      }

      const escapedPassword = validatedSudoPassword
        ? validatedSudoPassword
          .replace(/'/g, "'\\''")
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`")
        : "";

      if (serverId) {
        // Disconnect specific server
        const processInfo = openvpnProcesses.get(serverId);
        if (processInfo) {
          // Kill specific OpenVPN process by file path
          const escapedFilePath = processInfo.filePath.replace(/'/g, "'\\''");

          let killSuccess = false;

          // First try to kill by PID if available (more reliable if we have it)
          // But our openvpnProcess.pid is likely the sudo process wrapper.
          // In 'connectVpn', we spawn: `echo ... | sudo -S openvpn ...`
          // The PID is the SHELL.
          // Killing the shell usually does NOT kill the sudo process or openvpn.
          // So we MUST use pkill/pkill.

          // Try pkill with sudo
          if (escapedPassword) {
            try {
              await execAsync(
                `echo '${escapedPassword}' | sudo -S pkill -f "openvpn.*${escapedFilePath}"`,
                { timeout: 5000 },
              );
              killSuccess = true;
            } catch (e) {
              console.error("Failed to pkill:", e.message);
            }
          } else {
            // If no password, try current user pkill (might work if we own the process, but unlikely if started with sudo)
            try {
              await execAsync(`pkill -f "openvpn.*${escapedFilePath}"`, {
                timeout: 5000,
              });
              killSuccess = true;
            } catch (e) {
              console.error("Failed to pkill (no sudopass):", e.message);
            }
          }

          // Clean up temp auth file
          if (
            processInfo.tempAuthFile &&
            fs.existsSync(processInfo.tempAuthFile)
          ) {
            try {
              fs.unlinkSync(processInfo.tempAuthFile);
            } catch (e) {
              console.error("Error deleting temp auth file:", e);
            }
          }

          openvpnProcesses.delete(serverId);
          return { success: true, message: "VPN disconnected" };
        } else {
          openvpnProcesses.delete(serverId);
          return { success: false, error: "VPN connection not found" };
        }
      } else {
        // Disconnect all VPNs
        if (openvpnProcesses.size > 0) {
          if (escapedPassword) {
            await execAsync(
              `echo '${escapedPassword}' | sudo -S pkill -f openvpn`,
              { timeout: 5000 },
            );
          } else {
            await execAsync("pkill -f openvpn", { timeout: 5000 });
          }

          // Clean up all temp auth files
          for (const [id, processInfo] of openvpnProcesses.entries()) {
            if (
              processInfo.tempAuthFile &&
              fs.existsSync(processInfo.tempAuthFile)
            ) {
              try {
                fs.unlinkSync(processInfo.tempAuthFile);
              } catch (e) {
                console.error("Error deleting temp auth file:", e);
              }
            }
          }

          openvpnProcesses.clear();
          return { success: true, message: "All VPNs disconnected" };
        } else {
          return { success: true, message: "No active VPN connections" };
        }
      }
    }
  } catch (error) {
    console.error("Disconnect error:", error);
    return { success: false, error: error.message };
  }
};

// Disconnect VPN IPC
ipcMain.handle("disconnect-vpn", async (event, serverId) => {
  const result = await disconnectVpn(serverId);
  updateTrayMenu();
  return result;
});

// Delete VPN file
ipcMain.handle("delete-vpn-file", async (event, filePath) => {
  try {
    if (!filePath) {
      return { success: false, error: "File path is required" };
    }

    logToFile("INFO", "Attempting to delete file:", filePath);

    // Normalize paths to fix potential delimiter issues
    const normalizedPath = path.normalize(filePath);
    const normalizedVpnDir = path.normalize(VPN_DIRECTORY);

    // Verify file is in VPN directory (security check)
    // Use startsWith checking, but ensure case safety on Windows if needed
    if (!normalizedPath.startsWith(normalizedVpnDir)) {
      console.error(
        "Security check failed:",
        normalizedPath,
        "not in",
        normalizedVpnDir,
      );
      return { success: false, error: "File is not in VPN directory" };
    }

    // Verify file exists
    if (!fs.existsSync(normalizedPath)) {
      console.error("File not found at:", normalizedPath);
      // If file is gone, we can consider it "deleted" from the user's perspective
      // But let's return error so UI knows it was already gone (or maybe just success)
      // User complaint: "error shown file/config not available"
      // Let's assume they want it gone. If it's gone, it's success.
      return { success: true, message: "File already deleted or not found" };
    }

    // Delete the file
    try {
      fs.unlinkSync(normalizedPath);
      return { success: true, message: "File deleted successfully" };
    } catch (error) {
      console.error("Error deleting file:", error);
      return {
        success: false,
        error: error.message || "Failed to delete file",
      };
    }
  } catch (error) {
    console.error("Error in delete-vpn-file handler:", error);
    return { success: false, error: error.message || "Failed to delete file" };
  }
});

// Rename VPN file
ipcMain.handle("rename-vpn-file", async (event, filePath, newName) => {
  try {
    if (!filePath || !newName) {
      return { success: false, error: "File path and new name are required" };
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }

    // Verify file is in VPN directory (security check)
    if (!filePath.startsWith(VPN_DIRECTORY)) {
      return { success: false, error: "File is not in VPN directory" };
    }

    // Sanitize new name (remove invalid characters)
    const sanitizedName = newName.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (sanitizedName.length === 0) {
      return { success: false, error: "Invalid file name" };
    }

    // Get directory and extension
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const newFilePath = path.join(dir, `${sanitizedName}${ext}`);

    // Check if new file already exists
    if (fs.existsSync(newFilePath) && newFilePath !== filePath) {
      return { success: false, error: "A file with this name already exists" };
    }

    // Rename the file
    try {
      fs.renameSync(filePath, newFilePath);
      return {
        success: true,
        message: "File renamed successfully",
        newFilePath: newFilePath,
        newName: sanitizedName,
      };
    } catch (error) {
      console.error("Error renaming file:", error);
      return {
        success: false,
        error: error.message || "Failed to rename file",
      };
    }
  } catch (error) {
    console.error("Error in rename-vpn-file handler:", error);
    return { success: false, error: error.message || "Failed to rename file" };
  }
});

// Awake Mode (Amphetamine-like) implementation
let awakeFooterId = null;
let awakeTimer = null;
let awakeDuration = null; // Store the original duration
let awakeExpiry = null; // Store the expiry timestamp
let awakeTrayInterval = null; // Store interval for tray updates

function stopAwakeMode() {
  if (awakeFooterId !== null && powerSaveBlocker.isStarted(awakeFooterId)) {
    powerSaveBlocker.stop(awakeFooterId);
    awakeFooterId = null;
  }
  if (awakeTimer) {
    clearTimeout(awakeTimer);
    awakeTimer = null;
  }
  if (awakeTrayInterval) {
    clearInterval(awakeTrayInterval);
    awakeTrayInterval = null;
  }
  awakeDuration = null;
  awakeExpiry = null;

  // settings.setSync('awakeMode', { enabled: false }); // Optional persistence
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("awake-status-change", { enabled: false });
  }
  updateTrayMenu();
  updateTrayIcon();
}

function startAwakeMode(duration = null) {
  // Stop previous if exists (but don't emit 'false' event yet to avoid flicker)
  if (awakeFooterId !== null && powerSaveBlocker.isStarted(awakeFooterId)) {
    powerSaveBlocker.stop(awakeFooterId);
    awakeFooterId = null;
  }
  if (awakeTimer) {
    clearTimeout(awakeTimer);
    awakeTimer = null;
  }

  // Start blocker: prevent-display-sleep (highest level)
  awakeFooterId = powerSaveBlocker.start("prevent-display-sleep");
  awakeDuration = duration;

  // Duration handling
  let expiry = null;

  // Clear any existing interval for tray updates
  if (awakeTrayInterval) {
    clearInterval(awakeTrayInterval);
    awakeTrayInterval = null;
  }

  if (duration && duration > 0) {
    expiry = Date.now() + duration;
    awakeExpiry = expiry; // Global tracking

    awakeTimer = setTimeout(() => {
      stopAwakeMode();
      if (Notification.isSupported()) {
        new Notification({
          title: "RCP Network",
          body: "Awake Mode session expired. System can now sleep.",
        }).show();
      }
    }, duration);

    // Update Tray Title or Menu Item periodically
    awakeTrayInterval = setInterval(() => {
      updateTrayMenu();
    }, 60000); // Update every minute to keep menu fresh?
    // Or simpler: We just update menu when opened? No, Tray doesn't have on-open event easily.
    // We will update the label in updateTrayMenu dynamically based on current time.
  } else {
    awakeExpiry = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("awake-status-change", {
      enabled: true,
      duration,
      expiry,
    });
  }
  updateTrayMenu();
  updateTrayIcon();
  return { success: true };
}

ipcMain.handle("enable-awake-mode", (event, duration) => {
  startAwakeMode(duration);
  return { success: true };
});

ipcMain.handle("disable-awake-mode", () => {
  stopAwakeMode();
  return { success: true };
});

function updateTrayIcon() {
  if (!tray) return;

  const isAwake = awakeFooterId !== null;
  let iconPath;

  // Determine base icon name
  const platform = process.platform;
  let iconName = "";

  if (platform === "darwin") {
    iconName = "24x24"; // Start with base name
  } else if (platform === "win32") {
    iconName = "48x48";
  } else {
    iconName = "48x48";
  }

  if (isAwake) {
    iconName += "-green";
  }

  iconPath = path.join(__dirname, `../icons/tray/${iconName}.png`);

  // Fallback if green icon doesn't exist
  if (isAwake && !fs.existsSync(iconPath)) {
    console.log("Green icon not found, reverting to default");
    iconPath = getTrayIconPath();
  }

  let icon = nativeImage.createFromPath(iconPath);

  if (isMacOS()) {
    // Resize to tray standard (usually 22x22 or 18x18 is best for thin bars)
    // Original code used 17x17 for sleek look.
    icon = icon.resize({ width: 17, height: 17, quality: "best" });

    // Don't setTemplateImage(true) for colored icon, otherwise macOS masks it to black/white
    if (!isAwake) {
      icon.setTemplateImage(true);
    } else {
      icon.setTemplateImage(false);
    }
  }

  tray.setImage(icon);
}
