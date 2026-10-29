// SC-9: the Linux setup and privileged calls, checked without a Linux device.
// The packaged app (dist/linux-unpacked) is built by the verification command
// before this test runs.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const privileged = require("../electron/privileged");

const root = path.join(__dirname, "..");
const mainJs = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
const HELPER_PATH = privileged.helperInstallPath("linux");

const linuxScript = () =>
  privileged.buildInstallScript({ platform: "linux", user: "alice", sourceHelper: "/x", helperPath: HELPER_PATH });

test("the Linux helper lives in a root-owned system folder", () => {
  assert.strictEqual(HELPER_PATH, "/usr/local/libexec/rcp-network/rcp-network-helper");
});

test("the Linux install script makes the rule root:root 0440 after visudo checks it", () => {
  const script = linuxScript();
  const visudo = script.indexOf('visudo -c -f "$RULE_NEW"');
  const chown = script.indexOf('chown root:root "$RULE_NEW"');
  const chmod = script.indexOf('chmod 0440 "$RULE_NEW"');
  const move = script.indexOf('mv -f "$RULE_NEW" "$RULE_DST"');
  assert.ok(visudo >= 0 && chown > visudo && chmod > visudo && move > chown && move > chmod);
  assert.match(script, /RULE_DST='\/etc\/sudoers\.d\/rcp-network'/);
  assert.doesNotMatch(script, /root:wheel/);
});

test("Linux setup asks once through pkexec", async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return { stdout: "", stderr: "" };
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc9-"));
  try {
    const result = await privileged.runSetup(run, "linux", { user: "alice", sourceHelper: "/x", tmpDir });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], "pkexec");
    assert.strictEqual(calls[0][1], "/bin/sh");
    assert.ok(!calls.some(([file]) => file === "osascript" || file === "sudo"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Linux without pkexec gives the manual command instead of failing silently", async () => {
  const run = async () => {
    const error = new Error("spawn pkexec ENOENT");
    error.code = "ENOENT";
    throw error;
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc9-"));
  try {
    const result = await privileged.runSetup(run, "linux", { user: "alice", sourceHelper: "/x", tmpDir });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /pkexec/);
    assert.match(result.manualCommand, /^sudo sh '.+install\.sh'$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("every privileged call in main.js is sudo -n <helper>", () => {
  const code = mainJs
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const sudoUses = code.match(/["'`]sudo\b[^\n]*/g) || [];
  assert.ok(sudoUses.length >= 2, "expected the helper calls");
  for (const use of sudoUses) {
    assert.match(use, /^["'`]sudo["'`]?,?\s*(\[\s*)?["'`]?-n/, `sudo without -n: ${use}`);
    assert.match(use, /HELPER_PATH|escapedHelperPath/, `sudo not running the helper: ${use}`);
  }
  assert.doesNotMatch(code, /pkexec/, "main.js should leave pkexec to privileged.runSetup");
});

test("the app packages for Linux with the helper and a Linux keytar binary", () => {
  const unpacked = path.join(root, "dist", "linux-unpacked");
  const helper = path.join(unpacked, "resources", "helper", "rcp-network-helper");
  assert.ok(fs.existsSync(helper), "dist/linux-unpacked helper missing; run the SC-9 build first");
  assert.ok(fs.statSync(helper).mode & 0o111, "packaged helper is not executable");
  const keytar = path.join(unpacked, "resources", "app.asar.unpacked", "node_modules", "keytar", "build", "Release", "keytar.node");
  const head = fs.readFileSync(keytar).subarray(0, 4);
  assert.deepStrictEqual([...head], [0x7f, 0x45, 0x4c, 0x46], "keytar.node is not a Linux (ELF) binary");
});
