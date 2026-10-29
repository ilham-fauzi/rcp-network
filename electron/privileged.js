// One-time privileged setup for macOS and Linux.
//
// Installs a root-owned helper script plus a sudoers rule that lets the user
// who ran setup run only that helper without a password. On macOS it also
// makes a root-owned private copy of the Homebrew OpenVPN and its libraries,
// the only OpenVPN the helper runs there. After that the app
// runs every privileged action as `sudo -n <helper> <command>` and never
// needs, stores or pipes the person's password.
//
// Nothing here requires Electron, and every process is started through the
// `run` function passed in, so tests can replace it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// Must match HELPER_VERSION in helper/rcp-network-helper. Bump both when the
// helper changes, so installed copies are upgraded (and only then).
const HELPER_VERSION = 2;

const SUDOERS_PATH = "/etc/sudoers.d/rcp-network";

// macOS: the private OpenVPN copy the helper uses (MAC_BUNDLE_DIR there).
const MAC_OPENVPN_BUNDLE_DIR = "/Library/PrivilegedHelperTools/rcp-network";
const MAC_OPENVPN_BUNDLE_BINARY = `${MAC_OPENVPN_BUNDLE_DIR}/bin/openvpn`;

// macOS: where findOpenVpnPath looks for the Homebrew (or system) OpenVPN
// that setup copies.
const MAC_OPENVPN_PATHS = [
  "/opt/homebrew/sbin/openvpn", // Homebrew Apple Silicon (sbin)
  "/opt/homebrew/bin/openvpn", // Homebrew Apple Silicon (bin)
  "/usr/local/sbin/openvpn", // Homebrew Intel (sbin)
  "/usr/local/bin/openvpn", // Homebrew Intel (bin)
  "/usr/sbin/openvpn", // System sbin
  "/usr/bin/openvpn", // System bin
];

const SETUP_INCOMPLETE_ERROR =
  "One-time setup was not completed. Connect again to set up.";

const USER_NAME_PATTERN = /^[a-z_][a-z0-9_.-]*$/;

// Default process runner: execFile semantics, resolves { stdout, stderr },
// rejects with the error (carrying code, stdout, stderr) on failure.
const defaultRun = (file, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10000, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const helperInstallPath = (platform = process.platform) => {
  if (platform === "darwin") {
    return "/Library/PrivilegedHelperTools/rcp-network-helper";
  }
  return "/usr/local/libexec/rcp-network/rcp-network-helper";
};

// Where the helper ships with the app: outside app.asar when packaged
// (build.extraResources), next to this file in development.
const helperSourcePath = ({ isPackaged = false, resourcesPath = process.resourcesPath } = {}) => {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, "helper", "rcp-network-helper");
  }
  return path.join(__dirname, "helper", "rcp-network-helper");
};

// The macOS bundling script ships next to the helper.
const bundleScriptSourcePath = (sourceHelper = helperSourcePath()) =>
  path.join(path.dirname(sourceHelper), "bundle-openvpn");

const rootGroup = (platform) => (platform === "darwin" ? "wheel" : "root");

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const assertUser = (user) => {
  if (typeof user !== "string" || !USER_NAME_PATTERN.test(user)) {
    throw new Error(`Invalid user name for sudoers rule: ${JSON.stringify(user)}`);
  }
};

const assertHelperPath = (helperPath) => {
  if (typeof helperPath !== "string" || !/^\/[A-Za-z0-9_./-]+$/.test(helperPath)) {
    throw new Error(`Invalid helper path: ${JSON.stringify(helperPath)}`);
  }
};

const buildSudoersRule = (user, helperPath) => {
  assertUser(user);
  assertHelperPath(helperPath);
  return [
    "# RCP Network: lets this user run only the RCP Network helper as root.",
    "# Installed by the app's one-time setup. Remove with:",
    `#   sudo rm ${SUDOERS_PATH} ${helperPath}`,
    `${user} ALL=(root) NOPASSWD: ${helperPath}`,
    "",
  ].join("\n");
};

// macOS only: stage the private OpenVPN copy before the sudoers rule.
const macBundleStep = ({ openvpnSource, bundleScript }) => `
# 2b. Make the private OpenVPN copy in a root-owned staging folder: the
#     binary and its Homebrew libraries, pointed at each other, re-signed.
OPENVPN_SRC=${shellQuote(openvpnSource)}
BUNDLE_SCRIPT_SRC=${shellQuote(bundleScript)}
[ -f "$OPENVPN_SRC" ] || fail "OpenVPN not found: $OPENVPN_SRC"
[ -f "$BUNDLE_SCRIPT_SRC" ] || fail "bundle script not found: $BUNDLE_SCRIPT_SRC"
rm -rf "$BUNDLE_NEW" "$BUNDLE_TOOL"
cp "$BUNDLE_SCRIPT_SRC" "$BUNDLE_TOOL"
chown root:wheel "$BUNDLE_TOOL"
chmod 700 "$BUNDLE_TOOL"
mkdir -m 700 "$BUNDLE_NEW"
chown root:wheel "$BUNDLE_NEW"
/bin/sh "$BUNDLE_TOOL" "$OPENVPN_SRC" "$BUNDLE_NEW" || fail "could not copy OpenVPN"

# 2c. Everything root:wheel; folders and the binary 755, libraries 644.
chown -R root:wheel "$BUNDLE_NEW"
chmod 755 "$BUNDLE_NEW" "$BUNDLE_NEW/bin" "$BUNDLE_NEW/lib"
chmod 755 "$BUNDLE_NEW/bin/openvpn"
for f in "$BUNDLE_NEW"/lib/*; do
  if [ -f "$f" ]; then chmod 644 "$f"; fi
done
check_root_folder "$BUNDLE_NEW/bin"
check_root_folder "$BUNDLE_NEW/lib"
`;

// macOS only: replace any old copy only once the new one is complete.
const macBundleMove = () => `mv -f "$HELPER_NEW" "$HELPER_DST"
if [ -e "$BUNDLE_DST" ] || [ -L "$BUNDLE_DST" ]; then
  rm -rf "$BUNDLE_OLD"
  mv "$BUNDLE_DST" "$BUNDLE_OLD"
fi
mv "$BUNDLE_NEW" "$BUNDLE_DST"
rm -rf "$BUNDLE_OLD"
`;

// Shell script run once as root. It stages everything first and only moves
// the helper, the OpenVPN copy (macOS) and the rule into place after every
// check passed, so a failing step installs nothing.
const buildInstallScript = ({
  platform,
  user,
  sourceHelper,
  helperPath,
  openvpnSource,
  bundleScript = bundleScriptSourcePath(sourceHelper),
}) => {
  const rule = buildSudoersRule(user, helperPath);
  const mac = platform === "darwin";
  if (mac && (typeof openvpnSource !== "string" || !path.isAbsolute(openvpnSource))) {
    throw new Error("OpenVPN not found. Install OpenVPN (brew install openvpn), then connect again to finish setup.");
  }
  const group = rootGroup(platform);
  const statFormat =
    platform === "darwin" ? "stat -f '%u %Lp'" : "stat -c '%u %a'";
  const helperDir = path.posix.dirname(helperPath);

  return `#!/bin/sh
# RCP Network one-time setup (runs as root).
set -e
umask 022
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

HELPER_SRC=${shellQuote(sourceHelper)}
HELPER_DST=${shellQuote(helperPath)}
HELPER_DIR=${shellQuote(helperDir)}
RULE_DST=${shellQuote(SUDOERS_PATH)}
HELPER_NEW="$HELPER_DST.new"
RULE_NEW=/etc/sudoers.d/.rcp-network.new
${mac ? `BUNDLE_DST=${shellQuote(MAC_OPENVPN_BUNDLE_DIR)}
BUNDLE_NEW="$BUNDLE_DST.new"
BUNDLE_OLD="$BUNDLE_DST.old"
BUNDLE_TOOL="$BUNDLE_DST.bundle-openvpn"

cleanup() { rm -f "$HELPER_NEW" "$RULE_NEW" "$BUNDLE_TOOL"; rm -rf "$BUNDLE_NEW"; }` : `
cleanup() { rm -f "$HELPER_NEW" "$RULE_NEW"; }`}
trap cleanup EXIT

fail() { echo "rcp-network setup: $*" >&2; exit 1; }

# A folder is safe when it is owned by root and not writable by group or others.
check_root_folder() {
  [ -d "$1" ] && [ ! -L "$1" ] || fail "$1 is not a plain folder"
  set -- "$1" $(${statFormat} "$1")
  [ "$2" = 0 ] || fail "$1 is not owned by root"
  [ $(( 0$3 & 022 )) -eq 0 ] || fail "$1 is writable by group or others"
}

# Check $1 and every folder above it.
check_chain() {
  d=$1
  while :; do
    check_root_folder "$d"
    [ "$d" = / ] && break
    d=$(dirname "$d")
  done
}

# 1. Every parent folder of the helper must be root-owned and not writable by
#    group or others: first the ones that already exist, then the whole chain
#    once the helper folder is created.
d=$(dirname "$HELPER_DIR")
while [ ! -e "$d" ]; do d=$(dirname "$d"); done
check_chain "$d"
[ ! -L "$HELPER_DIR" ] || fail "$HELPER_DIR is a symlink"
mkdir -p "$HELPER_DIR"
chown root:${group} "$HELPER_DIR"
chmod 755 "$HELPER_DIR"
check_chain "$HELPER_DIR"

# 2. Stage the helper, owned by root and not writable by the user.
[ -f "$HELPER_SRC" ] || fail "helper source not found: $HELPER_SRC"
rm -f "$HELPER_NEW"
cp "$HELPER_SRC" "$HELPER_NEW"
chown root:${group} "$HELPER_NEW"
chmod 755 "$HELPER_NEW"
${mac ? macBundleStep({ openvpnSource, bundleScript }) : ""}
# 3. Write the rule to a temporary file and check it with visudo.
#    (sudo ignores files in sudoers.d whose name contains a dot.)
mkdir -p /etc/sudoers.d
rm -f "$RULE_NEW"
cat > "$RULE_NEW" <<'RCP_NETWORK_RULE'
${rule}RCP_NETWORK_RULE
visudo -c -f "$RULE_NEW"

# 4. The rule file is owned by root with mode 0440.
chown root:${group} "$RULE_NEW"
chmod 0440 "$RULE_NEW"

# 5. Move everything into place.
${mac ? macBundleMove() : `mv -f "$HELPER_NEW" "$HELPER_DST"
`}mv -f "$RULE_NEW" "$RULE_DST"
echo "rcp-network setup: installed"
`;
};

const errorText = (error) =>
  `${(error && error.stderr) || ""}\n${(error && error.message) || ""}`;

// The private OpenVPN copy must be there and run; OpenVPN before 2.6 exits 1
// after printing its version.
const checkOpenVpnCopy = async (run, binary, exists) => {
  if (!exists(binary)) return false;
  try {
    await run(binary, ["--version"]);
    return true;
  } catch (error) {
    return /^OpenVPN /.test(String((error && error.stdout) || ""));
  }
};

const checkHelper = async (run = defaultRun, options = {}) => {
  const platform = options.platform || process.platform;
  const helperPath = options.helperPath || helperInstallPath(platform);
  const exists = options.exists || fs.existsSync;

  if (!exists(helperPath)) {
    return { ok: false, reason: "missing" };
  }

  let stdout;
  try {
    ({ stdout } = await run("sudo", ["-n", helperPath, "--version"]));
  } catch (error) {
    if (/command not found|No such file/i.test(errorText(error))) {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "denied" };
  }

  const version = parseInt(String(stdout || "").trim(), 10);
  if (!Number.isInteger(version) || version < HELPER_VERSION) {
    return { ok: false, reason: "outdated", version: Number.isInteger(version) ? version : null };
  }
  if (platform === "darwin") {
    const binary = options.openvpnBundle || MAC_OPENVPN_BUNDLE_BINARY;
    if (!(await checkOpenVpnCopy(run, binary, exists))) {
      return { ok: false, reason: "outdated", version };
    }
  }
  return { ok: true, version };
};

const isCancelled = (platform, error) => {
  if (platform === "darwin") {
    return /User cancell?ed|\(-128\)/i.test(errorText(error));
  }
  // pkexec exits 126 when the authentication dialog is dismissed.
  return error && error.code === 126;
};

const runSetup = async (run = defaultRun, platform = process.platform, options = {}) => {
  const helperPath = options.helperPath || helperInstallPath(platform);
  const sourceHelper = options.sourceHelper || helperSourcePath();
  const user = options.user || os.userInfo().username;
  const tmpDir = options.tmpDir || os.tmpdir();

  let script;
  try {
    script = buildInstallScript({
      platform,
      user,
      sourceHelper,
      helperPath,
      openvpnSource: options.openvpnSource,
      bundleScript: options.bundleScript,
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const dir = fs.mkdtempSync(path.join(tmpDir, "rcp-network-setup-"));
  const scriptFile = path.join(dir, "install.sh");
  fs.writeFileSync(scriptFile, script, { mode: 0o600 });
  let keepScript = false;

  try {
    if (platform === "darwin") {
      const appleScript =
        `do shell script "/bin/sh " & quoted form of "${scriptFile.replace(/[\\"]/g, "\\$&")}"` +
        ` with prompt "RCP Network needs to install its helper once, so it can connect without asking for your password again."` +
        ` with administrator privileges`;
      await run("osascript", ["-e", appleScript], { timeout: 300000 });
    } else {
      try {
        await run("pkexec", ["/bin/sh", scriptFile], { timeout: 300000 });
      } catch (error) {
        if (error && error.code === "ENOENT") {
          keepScript = true;
          const manualCommand = `sudo sh ${shellQuote(scriptFile)}`;
          return {
            ok: false,
            manualCommand,
            error: `pkexec is not available. Run this once in a terminal to finish setup: ${manualCommand}`,
          };
        }
        throw error;
      }
    }
    return { ok: true };
  } catch (error) {
    if (isCancelled(platform, error)) {
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: (error && (error.stderr || error.message)) || "Setup failed" };
  } finally {
    if (!keepScript) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
};

// Check the helper; if it is missing, denied or outdated, run setup once
// (one admin prompt) and check again.
const ensureHelper = async (run = defaultRun, platform = process.platform, options = {}) => {
  const checkOptions = { ...options, platform };
  const first = await checkHelper(run, checkOptions);
  if (first.ok) {
    return { ok: true, setupRan: false };
  }

  const setup = await runSetup(run, platform, options);
  if (!setup.ok) {
    return { ...setup, ok: false, reason: first.reason, setupRan: true };
  }

  const second = await checkHelper(run, checkOptions);
  if (!second.ok) {
    return { ok: false, reason: second.reason, setupRan: true, error: SETUP_INCOMPLETE_ERROR };
  }
  return { ok: true, setupRan: true };
};

module.exports = {
  HELPER_VERSION,
  SUDOERS_PATH,
  MAC_OPENVPN_BUNDLE_DIR,
  MAC_OPENVPN_BUNDLE_BINARY,
  MAC_OPENVPN_PATHS,
  SETUP_INCOMPLETE_ERROR,
  defaultRun,
  helperInstallPath,
  helperSourcePath,
  bundleScriptSourcePath,
  buildSudoersRule,
  buildInstallScript,
  checkHelper,
  runSetup,
  ensureHelper,
  shellQuote,
};
