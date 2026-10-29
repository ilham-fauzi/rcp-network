// Update controller: checking, the once-a-day quiet check, download,
// staging and handing over to the install helper. Every outside effect is
// passed in, so tests run without Electron or the network.
const fs = require("fs");
const path = require("path");
const logic = require("./logic");
const stageModule = require("./stage");
const installModule = require("./install");

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "updateLastCheck";
const AUTO_CHECK_KEY = "autoUpdateCheck";

const isWritable = (target) => {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
};

const createUpdater = (options) => {
  const deps = {
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    env: process.env,
    pid: process.pid,
    feedUrl: logic.FEED_URL,
    publicKey: logic.PUBLIC_KEY,
    now: () => Date.now(),
    isWritable,
    fetchText: stageModule.fetchText,
    download: stageModule.download,
    stage: stageModule.stage,
    startInstall: installModule.startInstall,
    getActiveCount: () => 0,
    disconnectAll: async () => {},
    // OpenVPN processes still running after disconnectAll
    openvpnLeft: async () => 0,
    confirm: async () => true,
    quit: () => {},
    send: () => {},
    log: () => {},
    ...options,
  };
  // Required: currentVersion, isPackaged, userDataDir, prefs { get, set }

  let state = { state: "idle" };
  let release = null;
  let checking = null;
  let installing = false;

  const setState = (next) => {
    state = { ...next, ...canSelfInstall() };
    deps.send(state);
    return state;
  };

  // SC-8: whether this copy of the app can replace itself in place
  const canSelfInstall = () => {
    if (!deps.isPackaged) return { canSelfInstall: false, cannotInstallReason: "Running from source; updates install only in the packaged app." };
    const target = installModule.installTarget(deps.platform, { execPath: deps.execPath, env: deps.env });
    if (deps.platform === "darwin") {
      if (!target) return { canSelfInstall: false, cannotInstallReason: "The app is not running from an .app bundle." };
      if (!deps.isWritable(path.dirname(target)) || !deps.isWritable(target)) {
        return {
          canSelfInstall: false,
          cannotInstallReason: "RCP Network was installed by the .pkg as administrator, so it can't replace itself. Install the new .dmg to update in place from then on.",
        };
      }
    } else if (deps.platform === "linux") {
      if (!target) return { canSelfInstall: false, cannotInstallReason: "RCP Network is not running from an AppImage." };
      if (!deps.isWritable(target) || !deps.isWritable(path.dirname(target))) {
        return { canSelfInstall: false, cannotInstallReason: "The AppImage file or its folder is not writable." };
      }
    } else if (deps.platform !== "win32") {
      return { canSelfInstall: false, cannotInstallReason: `Updates are not supported on ${deps.platform}.` };
    }
    // Windows: a folder under Program Files is fine, the installer raises UAC itself
    return { canSelfInstall: true, cannotInstallReason: null };
  };

  const getState = () => ({ ...state, ...canSelfInstall() });

  const check = ({ quiet = false } = {}) => {
    if (checking) return checking;
    if (installing) return Promise.resolve(getState());
    if (!quiet) setState({ state: "checking" });
    checking = (async () => {
      try {
        const text = await deps.fetchText(deps.feedUrl);
        const result = logic.parseRelease(text, {
          platform: deps.platform,
          arch: deps.arch,
          currentVersion: deps.currentVersion,
        });
        deps.prefs.set(LAST_CHECK_KEY, deps.now());
        if (result.status === "up-to-date") {
          release = null;
          return quiet ? setState({ state: "idle" }) : setState({ state: "up-to-date" });
        }
        release = result;
        return setState({
          state: "available",
          version: result.version,
          notes: result.notes,
          pageUrl: result.pageUrl,
          installable: Boolean(result.asset),
          noDownloadReason: result.asset ? null : result.reason,
        });
      } catch (error) {
        deps.log("Update check failed:", error.message);
        // A quiet check that fails shows nothing (SC-5)
        if (quiet) return setState(state.state === "available" ? state : { state: "idle" });
        return setState({ state: "failed", error: error.message });
      } finally {
        checking = null;
      }
    })();
    return checking;
  };

  // At launch: at most once a day, and only when the person allows it
  const checkIfDue = () => {
    if (!deps.prefs.get(AUTO_CHECK_KEY, true)) return Promise.resolve(null);
    const last = Number(deps.prefs.get(LAST_CHECK_KEY, 0)) || 0;
    if (deps.now() - last < DAY_MS) return Promise.resolve(null);
    return check({ quiet: true });
  };

  const installAndRestart = async () => {
    if (installing || checking) return getState();
    if (!release || !release.asset) return getState();
    const allowed = canSelfInstall();
    if (!allowed.canSelfInstall) return getState();

    // SC-6: ask before dropping connections; cancel changes nothing
    const active = deps.getActiveCount();
    if (active > 0) {
      const ok = await deps.confirm(`This will disconnect ${active} VPN(s). Continue?`);
      if (!ok) return getState();
    }

    installing = true;
    const workDir = path.join(deps.userDataDir, "updates", release.version);
    const base = { version: release.version, notes: release.notes, pageUrl: release.pageUrl, installable: true };
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });

      setState({ ...base, state: "downloading", percent: 0 });
      const file = path.join(workDir, release.asset.name);
      const sigText = await deps.fetchText(release.asset.sigUrl);
      await deps.download(release.asset.url, file, (percent) => setState({ ...base, state: "downloading", percent }));

      setState({ ...base, state: "installing" });
      const newPath = await deps.stage({
        file,
        sigText,
        platform: deps.platform,
        version: release.version,
        workDir,
        publicKey: deps.publicKey,
      });

      await deps.disconnectAll();
      if (deps.getActiveCount() > 0 || (await deps.openvpnLeft()) > 0) {
        throw new Error("Could not disconnect every VPN");
      }

      const target = installModule.installTarget(deps.platform, { execPath: deps.execPath, env: deps.env });
      deps.startInstall({ platform: deps.platform, pid: deps.pid, newPath, target, workDir });
      deps.quit();
      return getState();
    } catch (error) {
      installing = false;
      deps.log("Update failed:", error.message);
      return setState({ ...base, state: "failed", error: error.message });
    }
  };

  return { check, checkIfDue, installAndRestart, canSelfInstall, getState };
};

module.exports = { createUpdater, DAY_MS, LAST_CHECK_KEY, AUTO_CHECK_KEY };
