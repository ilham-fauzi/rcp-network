// ilh-009 SC-1: VPN credentials never touch the keychain; every credential
// path, from the main window and the tray, goes through the local file.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");

const sources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : /\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);

test("no keychain service for VPN credentials anywhere", () => {
  for (const file of [...sources(path.join(root, "electron")), ...sources(path.join(root, "src"))]) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /VPN_CRED_SERVICE|_vpn_credentials/, file);
  }
});

test("the only keytar call left removes the old admin-password item", () => {
  const calls = main.match(/keytar\.\w+\([^)]*\)/g) || [];
  assert.deepStrictEqual(calls, ["keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)"]);
});

const handler = (name) => {
  const at = main.indexOf(name);
  assert.ok(at >= 0, `${name} not found`);
  const next = main.indexOf("ipcMain.", at + name.length);
  return main.slice(at, next < 0 ? undefined : next);
};

test("credential functions and IPC handlers use the local store", () => {
  assert.match(main, /const credentialStore = createCredentialStore\(VPN_DIRECTORY/);
  assert.match(main, /const saveVpnCredentials = [\s\S]*?credentialStore\.save\(/);
  assert.match(main, /const loadVpnCredentials = [\s\S]*?credentialStore\.load\(/);
  assert.match(main, /const deleteVpnCredentials = [\s\S]*?credentialStore\.remove\(/);
  assert.match(handler('ipcMain.handle("bulk-save-vpn-credentials"'), /credentialStore\.saveToAll\(/);
  assert.match(handler('ipcMain.handle("delete-vpn-credentials"'), /deleteVpnCredentials\(filename, /);
  const tray = handler('ipcMain.on("tray-auth-submit"');
  assert.match(tray, /saveVpnCredentials\(filename, credsToSave\)/);
  assert.match(tray, /deleteVpnCredentials\(filename, unticked\)/);
  assert.match(tray, /credentialStore\.saveToAll\(bulkCreds\)/);
});

test("the main window removes only the unticked field", () => {
  const control = fs.readFileSync(path.join(root, "src", "components", "ConnectionControl.js"), "utf8");
  assert.match(control, /deleteVpnCredentials\(filename, \['email'\]\)/);
  assert.match(control, /deleteVpnCredentials\(filename, \['password'\]\)/);
  assert.doesNotMatch(control, /deleteVpnCredentials\(filename\)/);
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  assert.match(preload, /deleteVpnCredentials: \(filename, fields\) => ipcRenderer\.invoke\('delete-vpn-credentials', filename, fields\)/);
});
