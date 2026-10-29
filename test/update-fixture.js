// Shared pieces for the updater tests: a throwaway signing key, a GitHub
// release JSON, and an updater wired to fakes.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUpdater } = require("../electron/updater");

const makeKey = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicBase64 = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
  const sign = (data) => crypto.sign(null, data, privateKey).toString("base64");
  return { privateKey, publicBase64, sign };
};

const asset = (name) => ({ name, browser_download_url: `https://example.invalid/download/${name}`, size: 10 });

// A release with every platform's asset and signature unless `names` says otherwise
const releaseJson = ({ tag = "v1.0.7", draft = false, prerelease = false, names } = {}) => {
  const version = tag.replace(/^v/, "").replace(/-.*/, "");
  const all = names || [
    `RCP-Network-${version}-x64.zip`,
    `RCP-Network-${version}-arm64.zip`,
    `RCP-Network-Setup-${version}.exe`,
    `RCP-Network-${version}.AppImage`,
  ].flatMap((n) => [n, `${n}.sig`]);
  return JSON.stringify({
    tag_name: tag,
    draft,
    prerelease,
    body: "What's new",
    html_url: `https://github.com/ilham-fauzi/rcp-network/releases/tag/${tag}`,
    assets: all.map(asset),
  });
};

const tempDir = (prefix = "rcp-update-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// An updater for a packaged Linux AppImage in a writable temp folder, with
// every outside effect recorded in `calls`.
const fakeUpdater = (overrides = {}) => {
  const dir = tempDir();
  const appImage = path.join(dir, "RCP-Network.AppImage");
  fs.writeFileSync(appImage, "old");
  const prefsStore = {};
  const calls = { fetch: [], download: 0, stage: 0, install: [], quit: 0, disconnectAll: 0, confirm: [], sent: [], order: [] };
  let active = overrides.active || 0;

  const deps = {
    platform: "linux",
    arch: "x64",
    currentVersion: "1.0.6",
    isPackaged: true,
    env: { APPIMAGE: appImage },
    userDataDir: path.join(dir, "userData"),
    pid: 4242,
    now: () => 1000000000000,
    prefs: {
      get: (key, fallback) => (key in prefsStore ? prefsStore[key] : fallback),
      set: (key, value) => {
        prefsStore[key] = value;
      },
    },
    fetchText: async (url) => {
      calls.fetch.push(url);
      if (url.endsWith(".sig")) return "c2ln";
      return releaseJson();
    },
    download: async (url, dest, onProgress) => {
      calls.download += 1;
      calls.order.push("download");
      fs.writeFileSync(dest, "new");
      onProgress(50);
      onProgress(100);
      return dest;
    },
    stage: async ({ file }) => {
      calls.stage += 1;
      calls.order.push("stage");
      return file;
    },
    startInstall: (args) => {
      calls.install.push(args);
      calls.order.push("install");
    },
    getActiveCount: () => active,
    disconnectAll: async () => {
      calls.disconnectAll += 1;
      calls.order.push("disconnect");
      if (!overrides.disconnectLeaves) active = 0;
    },
    confirm: async (message) => {
      calls.confirm.push(message);
      return overrides.confirm !== undefined ? overrides.confirm : true;
    },
    quit: () => {
      calls.quit += 1;
      calls.order.push("quit");
    },
    send: (state) => calls.sent.push(state),
    ...overrides.deps,
  };

  return { updater: createUpdater(deps), calls, prefsStore, dir, appImage, deps };
};

module.exports = { makeKey, releaseJson, tempDir, fakeUpdater };
