// The detached helper that installs a staged update after the app quits.
// Each script waits for the app's PID to exit, installs, relaunches, and
// logs to <work dir>/install.log.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Arguments: pid, new app, target app, work dir. Restores the old app on failure.
const MAC_SCRIPT = `#!/bin/bash
PID="$1"; NEW="$2"; TARGET="$3"; WORK="$4"
exec >>"$WORK/install.log" 2>&1
echo "== $(date) pid=$PID new=$NEW target=$TARGET"
for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done
if kill -0 "$PID" 2>/dev/null; then echo "app did not quit"; exit 1; fi
BACKUP="$WORK/previous.app"
rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then echo "cannot move old app"; open "$TARGET"; exit 1; fi
if ! ditto "$NEW" "$TARGET"; then
    echo "copy failed, restoring"; rm -rf "$TARGET"; mv "$BACKUP" "$TARGET"; open "$TARGET"; exit 1
fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
open "$TARGET"
rm -rf "$BACKUP" "$NEW"
echo "done"
`;

// Arguments: pid, new AppImage, target ($APPIMAGE), work dir.
const LINUX_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"; WORK="$4"
exec >>"$WORK/install.log" 2>&1
echo "== $(date) pid=$PID new=$NEW target=$TARGET"
i=0
while [ $i -lt 100 ] && kill -0 "$PID" 2>/dev/null; do i=$((i + 1)); sleep 0.3; done
if kill -0 "$PID" 2>/dev/null; then echo "app did not quit"; exit 1; fi
BACKUP="$WORK/previous.AppImage"
TMP="$TARGET.new"
relaunch() { nohup "$TARGET" >/dev/null 2>&1 & }
if ! cp -p "$TARGET" "$BACKUP"; then echo "cannot back up old AppImage"; relaunch; exit 1; fi
if ! cp "$NEW" "$TMP" || ! chmod +x "$TMP" || ! mv -f "$TMP" "$TARGET"; then
    echo "copy failed, restoring"; rm -f "$TMP"; cp -p "$BACKUP" "$TARGET"; relaunch; exit 1
fi
relaunch
rm -f "$BACKUP" "$NEW"
echo "done"
`;

// Windows has no positional-argument script here: the values are written
// into the .cmd file. /D= must be last and unquoted, as NSIS requires.
const windowsScript = ({ pid, newFile, installDir, workDir }) => {
  const log = path.join(workDir, "install.log");
  const exe = path.join(installDir, "RCP Network.exe");
  return [
    "@echo off",
    `set LOG="${log}"`,
    `echo == %date% %time% pid=${pid} new=${newFile} target=${installDir} >> %LOG%`,
    "set /a n=0",
    ":wait",
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
    "if errorlevel 1 goto install",
    "set /a n+=1",
    "if %n% geq 100 (",
    "  echo app did not quit >> %LOG%",
    "  exit /b 1",
    ")",
    "ping -n 2 127.0.0.1 >nul",
    "goto wait",
    ":install",
    `"${newFile}" /S /D=${installDir}`,
    "if errorlevel 1 (",
    "  echo installer failed with %errorlevel% >> %LOG%",
    `  start "" "${exe}"`,
    "  exit /b 1",
    ")",
    `start "" "${exe}"`,
    `del "${newFile}"`,
    "echo done >> %LOG%",
    "",
  ].join("\r\n");
};

const buildScript = (platform, values = {}) => {
  if (platform === "darwin") return MAC_SCRIPT;
  if (platform === "linux") return LINUX_SCRIPT;
  if (platform === "win32") return windowsScript(values);
  throw new Error(`Unsupported platform: ${platform}`);
};

// What the update replaces: the enclosing .app on macOS, the AppImage file
// on Linux, the install folder on Windows.
const installTarget = (platform, { execPath = process.execPath, env = process.env } = {}) => {
  if (platform === "darwin") {
    let dir = execPath;
    while (dir !== path.dirname(dir)) {
      if (dir.endsWith(".app")) return dir;
      dir = path.dirname(dir);
    }
    return null;
  }
  if (platform === "linux") return env.APPIMAGE || null;
  if (platform === "win32") return path.dirname(execPath);
  return null;
};

// Writes the script into the work folder and starts it detached
const startInstall = ({ platform, pid, newPath, target, workDir, spawnFn = spawn }) => {
  const options = { detached: true, stdio: "ignore", windowsHide: true };
  let child;
  if (platform === "win32") {
    const file = path.join(workDir, "install.cmd");
    fs.writeFileSync(file, buildScript("win32", { pid, newFile: newPath, installDir: target, workDir }));
    child = spawnFn("cmd.exe", ["/c", file], options);
  } else {
    const file = path.join(workDir, "install.sh");
    fs.writeFileSync(file, buildScript(platform), { mode: 0o700 });
    child = spawnFn(platform === "darwin" ? "/bin/bash" : "/bin/sh", [file, String(pid), newPath, target, workDir], options);
  }
  if (child && child.unref) child.unref();
  return child;
};

module.exports = { MAC_SCRIPT, LINUX_SCRIPT, windowsScript, buildScript, installTarget, startInstall };
