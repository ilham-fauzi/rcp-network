// Shared by the ilh007 tests: profiles running through the helper's real
// connect, disconnect and cleanup paths, without root. The PID folder is a
// temp folder (RCP_HELPER_TEST_PID_DIR) and a "running profile" is /bin/sleep
// started through a symlink named openvpn, so the helper's process check
// accepts it.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const fixture = require("./openvpn-fixture");

const { HELPER, isMac, isRoot } = fixture;

// connect execs OpenVPN; only the macOS fake (/usr/bin/true) is safe to exec
const skip = isRoot
  ? "test mode is ignored as root"
  : !isMac
    ? "connect would exec the real OpenVPN outside macOS"
    : false;

const GOOD = "client\ndev tun\nproto udp\nremote vpn.example.com 1194\n";

const started = [];
const tempDirs = [];
const cleanup = () => {
  for (const child of started.splice(0)) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch (e) {
      // already gone
    }
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  fixture.cleanup();
};

// The helper tells a running OpenVPN by `ps`; a sandbox that blocks it (as
// sfa verify's does) would make every profile look stopped.
const requirePs = () => {
  const r = spawnSync("/bin/ps", ["-p", String(process.pid), "-o", "pid="], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`needs /bin/ps, which cannot run here (${(r.stderr || r.error || "").toString().trim()}); run verify with --sandbox none`);
  }
};

const setup = () => {
  requirePs();
  const openvpn = fixture.trustedOpenVpn();
  if (openvpn.skip) throw new Error(openvpn.skip);
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rcp-profiles-")));
  const dir = path.join(home, ".rcp-network");
  fs.mkdirSync(dir);
  const pidDir = path.join(home, "pids");
  fs.mkdirSync(pidDir, { mode: 0o700 });
  const auth = path.join(dir, ".vpn_auth_1.tmp");
  fs.writeFileSync(auth, "user\npass\n", { mode: 0o600 });
  // A symlink, not a copy: macOS kills a copied system binary on launch
  const sleep = path.join(home, "openvpn");
  fs.symlinkSync("/bin/sleep", sleep);
  tempDirs.push(home);
  const env = { ...process.env, ...openvpn.env, RCP_HELPER_TEST_HOME: home, RCP_HELPER_TEST_PID_DIR: pidDir };
  const config = (name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, GOOD);
    return file;
  };
  return { home, dir, pidDir, auth, sleep, env, config };
};

// The helper's entry name: the first 32 hex of SHA-256 of the real path.
const entryId = (configPath) =>
  crypto.createHash("sha256").update(fs.realpathSync(configPath)).digest("hex").slice(0, 32);

// Start a fake OpenVPN for a config and record it as the helper would.
const seedRunning = (t, configPath) => {
  const child = spawn(t.sleep, ["300"], { stdio: "ignore" });
  started.push(child);
  const id = entryId(configPath);
  fs.writeFileSync(path.join(t.pidDir, `${id}.pid`), `${child.pid}\n`);
  fs.writeFileSync(path.join(t.pidDir, `${id}.conf`), GOOD);
  fs.writeFileSync(path.join(t.pidDir, `${id}.auth`), "user\npass\n");
  return { id, pid: child.pid, child };
};

// A leftover entry whose OpenVPN ended on its own.
const seedStale = (t, configPath) => {
  const id = entryId(configPath);
  fs.writeFileSync(path.join(t.pidDir, `${id}.pid`), "999999\n");
  fs.writeFileSync(path.join(t.pidDir, `${id}.conf`), GOOD);
  fs.writeFileSync(path.join(t.pidDir, `${id}.auth`), "user\npass\n");
  return { id };
};

const runHelper = (t, ...args) => spawnSync("/bin/sh", [HELPER, ...args], { encoding: "utf8", env: t.env });

const isAlive = (pid) => {
  const r = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return r.status === 0 && !r.stdout.trim().startsWith("Z");
};

// kill -TERM is asynchronous; wait briefly for the process to go.
const waitGone = (pid, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    spawnSync("sleep", ["0.05"]);
  }
  return !isAlive(pid);
};

const entryFiles = (t, id) =>
  ["pid", "conf", "auth"].filter((ext) => fs.existsSync(path.join(t.pidDir, `${id}.${ext}`)));

module.exports = { skip, setup, cleanup, entryId, seedRunning, seedStale, runHelper, isAlive, waitGone, entryFiles };
