// ilh-009 SC-4: the temporary auth file goes once the connect ends, and
// leftovers from earlier runs go at launch; other files stay.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { authFileDone, removeAuthFile, removeLeftoverAuthFiles } = require("../electron/auth-file");

const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("launch cleanup removes only this app's auth files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-auth-"));
  dirs.push(dir);
  const ours = [".vpn_auth_1790775682126.tmp", ".vpn_auth_1793242273051.tmp"];
  const others = [".tmp_auth_dev", "prod.cred", ".tmp_test_auth", "a.ovpn", "credentials.json", "vpn_auth_1.tmp", ".vpn_auth_x.tmp"];
  for (const f of [...ours, ...others]) fs.writeFileSync(path.join(dir, f), "user\npass");
  assert.deepStrictEqual(removeLeftoverAuthFiles(dir).sort(), ours.sort());
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), others.sort());
});

test("a missing folder is not an error", () => {
  assert.deepStrictEqual(removeLeftoverAuthFiles(path.join(os.tmpdir(), "rcp-no-such-folder-x")), []);
});

test("the file is done once OpenVPN reports the connection, not before", () => {
  assert.strictEqual(authFileDone("2026-10-31 11:06:27 Initialization Sequence Completed\n"), true);
  for (const line of ["UDPv4 link remote: [AF_INET]1.2.3.4:1194", "Peer Connection Initiated", "", undefined]) {
    assert.strictEqual(authFileDone(line), false, String(line));
  }
});

test("removeAuthFile deletes the file and ignores one already gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-auth-"));
  dirs.push(dir);
  const file = path.join(dir, ".vpn_auth_1.tmp");
  fs.writeFileSync(file, "user\npass");
  removeAuthFile(file);
  assert.strictEqual(fs.existsSync(file), false);
  removeAuthFile(file);
  removeAuthFile(null);
});

test("main.js deletes it on connect, start failure and exit, and at launch", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.match(main, /function noteVpnOutput[\s\S]*?authFileDone\(message\)[\s\S]*?removeAuthFile\(procInfo\.tempAuthFile\)/);
  // macOS/Linux output and the Windows log tail; the Windows admin branch
  // stays byte-identical (ilh-005 SC-8) and relies on exit and launch cleanup
  assert.ok((main.match(/noteVpnOutput\(serverId, message\)/g) || []).length >= 3, "OpenVPN output paths check for the connection");
  assert.strictEqual((main.match(/removeAuthFile\(tempAuthFile\);\n\s+resolve\(/g) || []).length, 1, "a start failure deletes it");
  assert.match(main, /function handleVpnExit[\s\S]*?fs\.unlinkSync\(procInfo\.tempAuthFile\)/);
  assert.match(main, /removeLeftoverAuthFiles\(VPN_DIRECTORY\)/);
});
