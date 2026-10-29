// Shared by the helper tests: a trusted OpenVPN the helper accepts in test
// mode, without root. The helper trusts RCP_HELPER_TEST_TRUSTED_UID next to
// uid 0 when it does not run as root, so a folder tree owned by the test user
// (and not writable by group or others) passes its ownership check.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELPER = path.join(__dirname, "..", "electron", "helper", "rcp-network-helper");
const BUNDLE_SCRIPT = path.join(__dirname, "..", "electron", "helper", "bundle-openvpn");

const isMac = process.platform === "darwin";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";

const FIXED_OPENVPN = [
  "/opt/homebrew/sbin/openvpn",
  "/usr/local/sbin/openvpn",
  "/usr/sbin/openvpn",
  "/usr/local/bin/openvpn",
  "/usr/bin/openvpn",
];

const trustedEnv = { RCP_HELPER_TEST_TRUSTED_UID: uid };

const runHelper = (args, env = {}) =>
  spawnSync("/bin/sh", [HELPER, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...trustedEnv, ...env },
  });

const isTrusted = (p) => runHelper(["check-trusted", p]).status === 0;

const tempDirs = [];
const cleanup = () => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
};

// A new temporary folder whose whole chain passes the ownership check
// (/tmp itself is world-writable on Linux, so it may not).
let base;
const trustedTempDir = (prefix = "rcp-trusted-") => {
  if (base === undefined) {
    base = null;
    for (const candidate of [os.tmpdir(), os.homedir(), path.join(__dirname, "..")]) {
      let dir;
      try {
        dir = fs.mkdtempSync(path.join(fs.realpathSync(candidate), ".rcp-trusted-probe-"));
      } catch (e) {
        continue;
      }
      fs.chmodSync(dir, 0o755);
      const ok = isTrusted(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      if (ok) {
        base = fs.realpathSync(candidate);
        break;
      }
    }
  }
  if (!base) return null;
  const dir = fs.mkdtempSync(path.join(base, prefix));
  fs.chmodSync(dir, 0o755);
  tempDirs.push(dir);
  return dir;
};

// macOS: a fake private OpenVPN copy (a system Mach-O that loads only
// /usr/lib) in a trusted temporary folder, used through
// RCP_HELPER_TEST_OPENVPN_BUNDLE. Linux: the fixed list, as the helper uses.
const trustedOpenVpn = () => {
  if (isMac) {
    const bundle = trustedTempDir("rcp-bundle-");
    if (!bundle) return { skip: "no temporary folder passes the ownership check" };
    fs.mkdirSync(path.join(bundle, "bin"), { mode: 0o755 });
    fs.mkdirSync(path.join(bundle, "lib"), { mode: 0o755 });
    const binary = path.join(bundle, "bin", "openvpn");
    fs.copyFileSync("/usr/bin/true", binary);
    fs.chmodSync(binary, 0o755);
    return {
      binary,
      bundle,
      env: { ...trustedEnv, RCP_HELPER_TEST_OPENVPN_BUNDLE: bundle },
    };
  }
  const found = FIXED_OPENVPN.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch (e) {
      return false;
    }
  });
  if (!found) return { skip: "no OpenVPN in the fixed locations" };
  return { binary: found, env: {} };
};

module.exports = {
  HELPER,
  BUNDLE_SCRIPT,
  FIXED_OPENVPN,
  isMac,
  isRoot,
  uid,
  trustedEnv,
  runHelper,
  isTrusted,
  trustedTempDir,
  trustedOpenVpn,
  cleanup,
};
