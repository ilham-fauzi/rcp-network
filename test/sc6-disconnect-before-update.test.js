// SC-6: Update and Restart with VPNs connected asks first; on confirm every
// connection is closed through the normal disconnect path before the app
// quits; on cancel nothing happens.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { fakeUpdater } = require("./update-fixture");

test("cancel changes nothing", async () => {
  const { updater, calls } = fakeUpdater({ active: 2, confirm: false });
  await updater.check();
  const before = updater.getState();
  const after = await updater.installAndRestart();
  assert.deepStrictEqual(calls.confirm, ["This will disconnect 2 VPN(s). Continue?"]);
  assert.strictEqual(calls.disconnectAll, 0);
  assert.strictEqual(calls.download, 0);
  assert.strictEqual(calls.quit, 0);
  assert.strictEqual(after.state, before.state);
});

test("confirm disconnects every VPN before the install starts and the app quits", async () => {
  const { updater, calls } = fakeUpdater({ active: 1 });
  await updater.check();
  await updater.installAndRestart();
  assert.deepStrictEqual(calls.confirm, ["This will disconnect 1 VPN(s). Continue?"]);
  assert.strictEqual(calls.disconnectAll, 1);
  assert.deepStrictEqual(calls.order, ["download", "stage", "disconnect", "install", "quit"]);
});

test("with no VPN connected there is no question", async () => {
  const { updater, calls } = fakeUpdater();
  await updater.check();
  await updater.installAndRestart();
  assert.deepStrictEqual(calls.confirm, []);
  assert.strictEqual(calls.quit, 1);
});

test("a connection left after disconnecting stops the update without quitting", async () => {
  const { updater, calls } = fakeUpdater({ active: 1, disconnectLeaves: true });
  await updater.check();
  const state = await updater.installAndRestart();
  assert.strictEqual(state.state, "failed");
  assert.strictEqual(state.error, "Could not disconnect every VPN");
  assert.strictEqual(calls.install.length, 0);
  assert.strictEqual(calls.quit, 0);
});

test("an openvpn process still running stops the update without quitting", async () => {
  const { updater, calls } = fakeUpdater({ active: 1, deps: { openvpnLeft: async () => 1 } });
  await updater.check();
  const state = await updater.installAndRestart();
  assert.strictEqual(state.error, "Could not disconnect every VPN");
  assert.strictEqual(calls.quit, 0);
});

test("main.js wires the normal disconnect path and an OS process check", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.match(main, /getActiveCount: \(\) => openvpnProcesses\.size/);
  assert.match(main, /disconnectAll: \(\) => disconnectVpn\(null\)/);
  assert.match(main, /openvpnLeft: countOpenvpnProcesses/);
  assert.match(main, /pgrep -x openvpn/);
  assert.match(main, /IMAGENAME eq openvpn\.exe/);
});
