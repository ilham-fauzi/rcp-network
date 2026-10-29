// SC-8: when the app cannot replace itself, Update and Restart becomes Open
// Download Page with the reason. The stored sudo password is never used.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { updateView } = require("../src/updateView");
const { fakeUpdater } = require("./update-fixture");

const MAC_EXEC = "/Applications/RCP Network.app/Contents/MacOS/RCP Network";

const check = (deps) => fakeUpdater({ deps }).updater.canSelfInstall();

test("running from source cannot self-install", () => {
  const result = check({ isPackaged: false });
  assert.strictEqual(result.canSelfInstall, false);
  assert.match(result.cannotInstallReason, /Running from source/);
});

test("macOS: a writable /Applications copy can; a root-owned .pkg install cannot", () => {
  assert.strictEqual(check({ platform: "darwin", execPath: MAC_EXEC, isWritable: () => true }).canSelfInstall, true);
  const pkg = check({ platform: "darwin", execPath: MAC_EXEC, isWritable: (p) => p !== "/Applications/RCP Network.app" });
  assert.strictEqual(pkg.canSelfInstall, false);
  assert.match(pkg.cannotInstallReason, /\.pkg/);
  const folder = check({ platform: "darwin", execPath: MAC_EXEC, isWritable: (p) => p !== "/Applications" });
  assert.strictEqual(folder.canSelfInstall, false);
});

test("Linux: not an AppImage, or a read-only AppImage, cannot", () => {
  const none = check({ env: {} });
  assert.strictEqual(none.canSelfInstall, false);
  assert.match(none.cannotInstallReason, /not running from an AppImage/);
  const readOnly = check({ env: { APPIMAGE: "/opt/RCP.AppImage" }, isWritable: () => false });
  assert.strictEqual(readOnly.canSelfInstall, false);
  assert.match(readOnly.cannotInstallReason, /not writable/);
  assert.strictEqual(check({ env: { APPIMAGE: "/home/me/RCP.AppImage" }, isWritable: () => true }).canSelfInstall, true);
});

test("Windows can, even under Program Files (the installer asks for UAC itself)", () => {
  assert.strictEqual(
    check({ platform: "win32", execPath: "C:\\Program Files\\RCP Network\\RCP Network.exe", isWritable: () => false }).canSelfInstall,
    true,
  );
});

test("the window shows Open Download Page and why, and Update and Restart does nothing", async () => {
  const { updater, calls } = fakeUpdater({ deps: { isPackaged: false } });
  const state = await updater.check();
  const view = updateView(state);
  assert.strictEqual(view.showInstall, false);
  assert.strictEqual(view.showOpenPage, true);
  assert.match(view.note, /Running from source/);
  await updater.installAndRestart();
  assert.strictEqual(calls.download, 0);
  assert.strictEqual(calls.quit, 0);
});

test("the updater never touches sudo, the keychain or the stored password", () => {
  const dir = path.join(__dirname, "..", "electron", "updater");
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(source, /sudo|keytar|KEYCHAIN|password/i, file);
  }
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const start = main.indexOf("const getUpdater = () => {");
  const block = main.slice(start, main.indexOf("\n};", start));
  assert.doesNotMatch(block, /sudo|keytar|KEYCHAIN|password|runHelper/i);
});
