// SC-6: a missing, denied or outdated helper is detected through sudo -n and
// setup is offered once; a connect never fails silently.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const privileged = require("../electron/privileged");

const { HELPER_VERSION, SETUP_INCOMPLETE_ERROR, MAC_OPENVPN_BUNDLE_BINARY, checkHelper, ensureHelper } = privileged;
const HELPER_PATH = privileged.helperInstallPath("darwin");

// Fake system: `state` says what sudo -n --version does before and after
// setup; `copy` says whether the macOS OpenVPN copy is there and runs
// ("ok", "missing" or "broken") before setup.
const fakeSystem = ({ before, after = "ok", setup = "ok", platform = "darwin", copy = "ok" }) => {
  const calls = { sudo: 0, setup: 0, args: [] };
  let installed = false;
  const current = () => (installed ? after : before);
  const currentCopy = () => (installed ? "ok" : copy);
  const run = async (file, args) => {
    calls.args.push([file, ...args]);
    if (file === MAC_OPENVPN_BUNDLE_BINARY) {
      calls.copy = (calls.copy || 0) + 1;
      assert.deepStrictEqual(args, ["--version"]);
      if (currentCopy() === "broken") {
        const error = new Error("Command failed");
        error.code = 134;
        error.stdout = "";
        error.stderr = "dyld: Library not loaded\n";
        throw error;
      }
      return { stdout: "OpenVPN 2.7.4 aarch64-apple-darwin\n", stderr: "" };
    }
    if (file === "sudo") {
      calls.sudo += 1;
      assert.deepStrictEqual(args, ["-n", HELPER_PATH, "--version"]);
      const state = current();
      if (state === "denied") {
        const error = new Error("Command failed");
        error.code = 1;
        error.stderr = "sudo: a password is required\n";
        throw error;
      }
      if (state === "outdated") return { stdout: `${HELPER_VERSION - 1}\n`, stderr: "" };
      return { stdout: `${HELPER_VERSION}\n`, stderr: "" };
    }
    if (file === "osascript" || file === "pkexec") {
      calls.setup += 1;
      if (file === "osascript") {
        assert.match(args[1], /with administrator privileges/);
      }
      if (setup === "cancel") {
        const error = new Error("Command failed");
        error.code = file === "pkexec" ? 126 : 1;
        error.stderr = "execution error: User canceled. (-128)\n";
        throw error;
      }
      if (setup === "missing-pkexec") {
        const error = new Error("spawn pkexec ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      installed = true;
      return { stdout: "rcp-network setup: installed\n", stderr: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  const options = {
    helperPath: HELPER_PATH,
    sourceHelper: path.join(__dirname, "..", "electron", "helper", "rcp-network-helper"),
    user: "alice",
    openvpnSource: "/opt/homebrew/sbin/openvpn",
    platform,
    exists: (p) =>
      p === MAC_OPENVPN_BUNDLE_BINARY ? currentCopy() !== "missing" : current() !== "missing",
  };
  return { run, calls, options, platform };
};

for (const reason of ["missing", "denied", "outdated"]) {
  test(`${reason} helper: one setup, then a re-check`, async () => {
    const sys = fakeSystem({ before: reason });
    const first = await checkHelper(sys.run, sys.options);
    assert.deepStrictEqual({ ok: first.ok, reason: first.reason }, { ok: false, reason });

    const result = await ensureHelper(sys.run, sys.platform, sys.options);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(sys.calls.setup, 1);
    // ensureHelper re-checks after setup (helper, then the OpenVPN copy)
    const setupAt = sys.calls.args.findIndex(([file]) => file === "osascript");
    const after = sys.calls.args.slice(setupAt + 1);
    assert.deepStrictEqual(after, [
      ["sudo", "-n", HELPER_PATH, "--version"],
      [MAC_OPENVPN_BUNDLE_BINARY, "--version"],
    ]);
  });
}

for (const copy of ["missing", "broken"]) {
  test(`macOS: a ${copy} OpenVPN copy is reported outdated and set up once`, async () => {
    const sys = fakeSystem({ before: "ok", copy });
    const first = await checkHelper(sys.run, sys.options);
    assert.deepStrictEqual({ ok: first.ok, reason: first.reason }, { ok: false, reason: "outdated" });

    const result = await ensureHelper(sys.run, "darwin", sys.options);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(sys.calls.setup, 1);
  });
}

test("macOS: an OpenVPN copy that exits 1 after printing its version is accepted", async () => {
  const run = async (file) => {
    if (file === "sudo") return { stdout: `${HELPER_VERSION}\n`, stderr: "" };
    const error = new Error("Command failed");
    error.code = 1;
    error.stdout = "OpenVPN 2.5.9 x86_64-apple-darwin\n";
    throw error;
  };
  const result = await checkHelper(run, { platform: "darwin", helperPath: HELPER_PATH, exists: () => true });
  assert.strictEqual(result.ok, true);
});

test("macOS: setup without an OpenVPN to copy fails without a prompt", async () => {
  const sys = fakeSystem({ before: "missing" });
  delete sys.options.openvpnSource;
  const result = await ensureHelper(sys.run, "darwin", sys.options);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /OpenVPN not found/);
  assert.strictEqual(sys.calls.setup, 0);
});

test("setup cancelled gives { ok: false } and no second prompt", async () => {
  const sys = fakeSystem({ before: "denied", setup: "cancel" });
  const result = await ensureHelper(sys.run, "darwin", sys.options);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(sys.calls.setup, 1);
});

test("setup that leaves the helper broken still reports failure", async () => {
  const sys = fakeSystem({ before: "denied", after: "denied" });
  const result = await ensureHelper(sys.run, "darwin", sys.options);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, SETUP_INCOMPLETE_ERROR);
  assert.strictEqual(sys.calls.setup, 1);
});

test("Linux uses pkexec and cancelling is reported", async () => {
  const sys = fakeSystem({ before: "missing", setup: "cancel", platform: "linux" });
  const result = await ensureHelper(sys.run, "linux", sys.options);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.cancelled, true);
  assert.ok(sys.calls.args.some(([file]) => file === "pkexec"));
});

test("Linux without pkexec returns a clear error with the manual command", async () => {
  const sys = fakeSystem({ before: "missing", setup: "missing-pkexec", platform: "linux" });
  const result = await ensureHelper(sys.run, "linux", sys.options);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /pkexec/);
  assert.match(result.manualCommand, /^sudo sh '.+install\.sh'$/);
  fs.rmSync(path.dirname(result.manualCommand.replace(/^sudo sh '|'$/g, "")), { recursive: true, force: true });
});

test("an already-OK helper never calls setup", async () => {
  const sys = fakeSystem({ before: "ok" });
  const result = await ensureHelper(sys.run, "darwin", sys.options);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(sys.calls.setup, 0);
  assert.strictEqual(sys.calls.sudo, 1);
  assert.strictEqual(sys.calls.copy, 1);
});

test("a newer installed helper is accepted (app updates do not prompt)", async () => {
  const run = async (file) =>
    file === "sudo"
      ? { stdout: `${HELPER_VERSION + 1}\n`, stderr: "" }
      : { stdout: "OpenVPN 2.7.4\n", stderr: "" };
  const result = await checkHelper(run, { platform: "darwin", helperPath: HELPER_PATH, exists: () => true });
  assert.strictEqual(result.ok, true);
});

test("connect's setup error text is exported and used by connectVpn", () => {
  assert.strictEqual(SETUP_INCOMPLETE_ERROR, "One-time setup was not completed. Connect again to set up.");
  const mainJs = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const connect = mainJs.slice(mainJs.indexOf("const connectVpn = async"));
  assert.match(connect, /ensurePrivilegedHelper\(\)/);
  assert.match(connect, /privileged\.SETUP_INCOMPLETE_ERROR/);
});

test("HELPER_VERSION matches the helper script", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "electron", "helper", "rcp-network-helper"), "utf8");
  const match = script.match(/^HELPER_VERSION=(\d+)$/m);
  assert.ok(match, "HELPER_VERSION not found in the script");
  assert.strictEqual(Number(match[1]), HELPER_VERSION);
});
