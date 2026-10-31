// SC-10: the helper runs only an OpenVPN the user cannot change. Runs as the
// current (non-root) user; RCP_HELPER_TEST_TRUSTED_UID makes a tree owned by
// that user count as root-owned.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fixture = require("./openvpn-fixture");
const privileged = require("../electron/privileged");

const { HELPER, BUNDLE_SCRIPT, isMac, isRoot, runHelper, trustedEnv, trustedTempDir } = fixture;

const skip = isRoot ? "test mode is ignored as root" : false;

const tempDirs = [];
test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  fixture.cleanup();
});

const expectRefused = (r, pattern) => {
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /^refused: /m);
  if (pattern) assert.match(r.stderr, pattern);
};

// A trusted folder with one file in it.
const trustedTree = () => {
  const root = trustedTempDir("rcp-tree-");
  assert.ok(root, "no temporary folder passes the ownership check");
  const dir = path.join(root, "sub");
  fs.mkdirSync(dir, { mode: 0o755 });
  const file = path.join(dir, "file");
  fs.writeFileSync(file, "x", { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { root, dir, file };
};

// --- the ownership check ------------------------------------------------------

test("check_trusted: a file in a tree owned by the test user passes", { skip }, () => {
  const t = trustedTree();
  const r = runHelper(["check-trusted", t.file]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("check_trusted: without the test uid, a user-owned tree fails (only root is trusted)", { skip }, () => {
  const t = trustedTree();
  expectRefused(runHelper(["check-trusted", t.file], { RCP_HELPER_TEST_TRUSTED_UID: "" }));
});

test("check_trusted: a chmod g+w file fails", { skip }, () => {
  const t = trustedTree();
  fs.chmodSync(t.file, 0o775);
  expectRefused(runHelper(["check-trusted", t.file]));
});

test("check_trusted: a file writable by others fails", { skip }, () => {
  const t = trustedTree();
  fs.chmodSync(t.file, 0o757);
  expectRefused(runHelper(["check-trusted", t.file]));
});

test("check_trusted: a chmod o+w parent folder fails", { skip }, () => {
  const t = trustedTree();
  fs.chmodSync(t.dir, 0o757);
  expectRefused(runHelper(["check-trusted", t.file]));
});

test("check_trusted: a chmod g+w folder higher up fails", { skip }, () => {
  const t = trustedTree();
  fs.chmodSync(t.root, 0o775);
  expectRefused(runHelper(["check-trusted", t.file]));
});

test("check_trusted: a symlink is checked at its real path", { skip }, () => {
  const good = trustedTree();
  const bad = trustedTree();
  fs.chmodSync(bad.dir, 0o777);

  // trusted link -> untrusted target: fails
  const toBad = path.join(good.dir, "to-bad");
  fs.symlinkSync(bad.file, toBad);
  expectRefused(runHelper(["check-trusted", toBad]));

  // link in an untrusted folder -> trusted target: passes (the real path is)
  const toGood = path.join(bad.dir, "to-good");
  fs.symlinkSync(good.file, toGood);
  assert.strictEqual(runHelper(["check-trusted", toGood]).status, 0);
});

test("check_trusted: a file the user owns in /tmp fails (world-writable folder)", { skip }, () => {
  // /tmp (/private/tmp on macOS) is 1777
  const dir = fs.mkdtempSync("/tmp/rcp-tmp-");
  tempDirs.push(dir);
  fs.chmodSync(dir, 0o755);
  const file = path.join(dir, "file");
  fs.writeFileSync(file, "x", { mode: 0o755 });
  expectRefused(runHelper(["check-trusted", file]));
});

test("check-trusted and check-libs are test-only commands", () => {
  const script = fs.readFileSync(HELPER, "utf8");
  assert.match(script, /test command not available as root/);
  // the test uid is honoured only when not root
  assert.match(script, /if \[ "\$RUN_UID" -ne 0 \]; then\n\s+case \$\{RCP_HELPER_TEST_TRUSTED_UID/);
});

// --- connect --dry-run ----------------------------------------------------------

const GOOD = "client\ndev tun\nproto udp\nremote vpn.example.com 1194\n";

const connectSetup = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-helper-sc10-"));
  const dir = path.join(home, ".rcp-network");
  fs.mkdirSync(dir);
  const auth = path.join(dir, ".vpn_auth_1.tmp");
  fs.writeFileSync(auth, "user\npass\n", { mode: 0o600 });
  const config = path.join(dir, "good.ovpn");
  fs.writeFileSync(config, GOOD);
  tempDirs.push(home);
  return { home, config, auth };
};

const connect = (env) => {
  const t = connectSetup();
  return spawnSync("/bin/sh", [HELPER, "--dry-run", "connect", t.config, t.auth], {
    encoding: "utf8",
    env: { ...process.env, RCP_HELPER_TEST_HOME: t.home, ...env },
  });
};

test("connect --dry-run is refused when the OpenVPN's tree fails the ownership check", { skip: skip || (!isMac && "macOS bundle path; Linux is covered below") }, () => {
  const o = fixture.trustedOpenVpn();
  assert.ok(!o.skip, o.skip);
  fs.chmodSync(path.join(o.bundle, "bin"), 0o777);
  expectRefused(connect(o.env), /untrusted openvpn .*\/bin\/openvpn/);

  fs.chmodSync(path.join(o.bundle, "bin"), 0o755);
  fs.chmodSync(o.binary, 0o775);
  expectRefused(connect(o.env), /untrusted openvpn/);
});

test("connect --dry-run is refused for a copy that still loads Homebrew libraries", { skip: skip || (!isMac && "macOS only") }, (t) => {
  const source = privileged.MAC_OPENVPN_PATHS.filter((p) => fs.existsSync(p))
    .find((p) => /\t\/(opt\/homebrew|usr\/local)\//.test(spawnSync("otool", ["-L", p], { encoding: "utf8" }).stdout));
  if (!source) {
    t.skip("no OpenVPN that loads Homebrew libraries");
    return;
  }
  const o = fixture.trustedOpenVpn();
  assert.ok(!o.skip, o.skip);
  assert.strictEqual(connect(o.env).status, 0);
  // the binary itself is trusted, but its libraries are not in the bundle
  fs.copyFileSync(fs.realpathSync(source), o.binary);
  fs.chmodSync(o.binary, 0o755);
  expectRefused(connect(o.env), /untrusted openvpn/);
});

test("connect --dry-run on macOS names only the private copy", { skip: skip || (!isMac && "macOS only") }, () => {
  // The real location: missing or root-owned, never a Homebrew path
  const real = connect(trustedEnv);
  const realOut = `${real.stdout}${real.stderr}`;
  assert.ok(realOut.includes(privileged.MAC_OPENVPN_BUNDLE_BINARY), realOut);
  assert.doesNotMatch(realOut, /\/opt\/homebrew\/|\/usr\/local\//);
  if (real.status === 0) {
    assert.strictEqual(real.stdout.trim().split(/\s+/)[0], privileged.MAC_OPENVPN_BUNDLE_BINARY);
  } else {
    expectRefused(real);
  }

  // A trusted copy in test mode is used, and only it
  const o = fixture.trustedOpenVpn();
  const r = connect(o.env);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim().split(/\s+/)[0], o.binary);
  assert.doesNotMatch(r.stdout, /\/opt\/homebrew\/|\/usr\/local\//);
});

test("helper on macOS uses only the private copy path", () => {
  const script = fs.readFileSync(HELPER, "utf8");
  assert.match(script, /^MAC_BUNDLE_DIR=\/Library\/PrivilegedHelperTools\/rcp-network$/m);
  assert.strictEqual(privileged.MAC_OPENVPN_BUNDLE_BINARY, "/Library/PrivilegedHelperTools/rcp-network/bin/openvpn");
  const findOpenVpn = script.slice(script.indexOf("find_openvpn() {"));
  const macBranch = findOpenVpn.slice(0, findOpenVpn.indexOf("  fi\n"));
  assert.match(macBranch, /c=\$MAC_BUNDLE_DIR\/bin\/openvpn/);
  assert.doesNotMatch(macBranch, /OPENVPN_CANDIDATES/);
});

test("Linux: connect --dry-run uses only a fixed-list OpenVPN that passes the checks", { skip: skip || (isMac && "Linux only") }, () => {
  const r = connect({ RCP_HELPER_TEST_TRUSTED_UID: "" });
  const first = fixture.FIXED_OPENVPN.find((p) => fs.existsSync(p));
  if (r.status === 0) {
    const bin = r.stdout.trim().split(/\s+/)[0];
    assert.ok(fixture.FIXED_OPENVPN.includes(bin));
    assert.strictEqual(spawnSync("/bin/sh", [HELPER, "check-trusted", bin]).status, 0);
    assert.strictEqual(spawnSync("/bin/sh", [HELPER, "check-libs", bin]).status, 0);
  } else if (first) {
    expectRefused(r, /untrusted openvpn/);
  } else {
    expectRefused(r, /OpenVPN not found/);
  }
});

test("Linux: check-libs reads ldd and checks every library", { skip: skip || (isMac && "Linux only") }, () => {
  assert.strictEqual(spawnSync("/bin/sh", [HELPER, "check-libs", "/bin/sh"], { encoding: "utf8" }).status, 0);
});

// --- bundling for real (macOS) ------------------------------------------------------

const homebrewOpenVpn = () => {
  const found = privileged.MAC_OPENVPN_PATHS.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch (e) {
      return false;
    }
  });
  return found;
};

test("macOS: bundle-openvpn makes a self-contained copy that passes check_libs", { skip: skip || (!isMac && "macOS only: bundles a Homebrew OpenVPN with otool and install_name_tool"), timeout: 120000 }, () => {
  const source = homebrewOpenVpn();
  assert.ok(
    source,
    `SC-10 needs a Homebrew OpenVPN to bundle (looked in ${privileged.MAC_OPENVPN_PATHS.join(", ")}). Install it with 'brew install openvpn'.`,
  );
  const dest = trustedTempDir("rcp-bundle-real-");
  assert.ok(dest, "no temporary folder passes the ownership check");

  const b = spawnSync("/bin/sh", [BUNDLE_SCRIPT, source, dest], { encoding: "utf8" });
  assert.strictEqual(b.status, 0, `${b.stdout}${b.stderr}`);

  const binary = path.join(dest, "bin", "openvpn");
  const v = spawnSync(binary, ["--version"], { encoding: "utf8" });
  assert.strictEqual(v.status, 0, `${v.stdout}${v.stderr}`);
  assert.match(v.stdout, /^OpenVPN /);

  const files = [binary, ...fs.readdirSync(path.join(dest, "lib")).map((f) => path.join(dest, "lib", f))];
  for (const file of files) {
    const o = spawnSync("otool", ["-L", file], { encoding: "utf8" });
    assert.strictEqual(o.status, 0, o.stderr);
    const refs = o.stdout.split("\n").filter((l) => /^\s/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
    for (const ref of refs) {
      assert.doesNotMatch(ref, /^\/(opt\/homebrew|usr\/local)\//, `${file} still loads ${ref}`);
    }
  }

  const libs = runHelper(["check-libs", binary]);
  assert.strictEqual(libs.status, 0, libs.stderr);
  const trusted = runHelper(["check-trusted", binary]);
  assert.strictEqual(trusted.status, 0, trusted.stderr);

  // and the helper would run it
  const env = { ...trustedEnv, RCP_HELPER_TEST_OPENVPN_BUNDLE: dest };
  const r = connect(env);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim().split(/\s+/)[0], binary);

  // a bundled library the user could change makes it untrusted
  const lib = files.find((f) => f.endsWith(".dylib"));
  assert.ok(lib, "the copy has no bundled libraries");
  fs.chmodSync(lib, 0o664);
  expectRefused(runHelper(["check-libs", binary]));
  expectRefused(connect(env), /untrusted openvpn/);
  fs.chmodSync(lib, 0o644);
});

test("bundle-openvpn is valid sh and fails on a missing source", () => {
  assert.strictEqual(spawnSync("/bin/sh", ["-n", BUNDLE_SCRIPT]).status, 0);
  const r = spawnSync("/bin/sh", [BUNDLE_SCRIPT, "/nonexistent/openvpn", os.tmpdir()], { encoding: "utf8" });
  assert.notStrictEqual(r.status, 0);
});

test("bundle-openvpn asks for xcode-select --install when the tools are missing", () => {
  const script = fs.readFileSync(BUNDLE_SCRIPT, "utf8");
  assert.match(script, /xcode-select --install/);
  assert.match(script, /install_name_tool -change "\$dep" "@loader_path\/\.\.\/lib\//);
  assert.match(script, /install_name_tool -id "@loader_path\/\.\.\/lib\//);
  assert.match(script, /codesign --force -s -/);
});

// --- setup ----------------------------------------------------------------------------

const macScript = () =>
  privileged.buildInstallScript({
    platform: "darwin",
    user: "alice",
    sourceHelper: "/Applications/RCP Network.app/Contents/Resources/helper/rcp-network-helper",
    helperPath: privileged.helperInstallPath("darwin"),
    openvpnSource: "/opt/homebrew/sbin/openvpn",
  });

test("macOS install script bundles OpenVPN before the visudo and mv steps", () => {
  const script = macScript();
  const bundle = script.indexOf('/bin/sh "$BUNDLE_TOOL" "$OPENVPN_SRC" "$BUNDLE_NEW"');
  const visudo = script.indexOf('visudo -c -f "$RULE_NEW"');
  const mvBundle = script.indexOf('mv "$BUNDLE_NEW" "$BUNDLE_DST"');
  const mvHelper = script.indexOf('mv -f "$HELPER_NEW" "$HELPER_DST"');
  const mvRule = script.indexOf('mv -f "$RULE_NEW" "$RULE_DST"');
  for (const [name, at] of Object.entries({ bundle, visudo, mvBundle, mvHelper, mvRule })) {
    assert.ok(at > 0, `${name} missing`);
  }
  assert.ok(bundle < visudo, "bundling runs before visudo");
  assert.ok(bundle < mvHelper && bundle < mvRule && bundle < mvBundle, "bundling runs before anything is moved into place");
  assert.ok(visudo < mvBundle, "the copy replaces the old one only after every check");

  assert.match(script, /OPENVPN_SRC='\/opt\/homebrew\/sbin\/openvpn'/);
  assert.match(script, /BUNDLE_DST='\/Library\/PrivilegedHelperTools\/rcp-network'/);
  assert.match(script, /BUNDLE_SCRIPT_SRC='\/Applications\/RCP Network\.app\/Contents\/Resources\/helper\/bundle-openvpn'/);
});

test("macOS install script sets root:wheel and the modes on the copy", () => {
  const script = macScript();
  assert.match(script, /chown -R root:wheel "\$BUNDLE_NEW"/);
  assert.match(script, /chmod 755 "\$BUNDLE_NEW" "\$BUNDLE_NEW\/bin" "\$BUNDLE_NEW\/lib"/);
  assert.match(script, /chmod 755 "\$BUNDLE_NEW\/bin\/openvpn"/);
  assert.match(script, /chmod 644 "\$f"/);
  // the staging folder is root-only while the copy is made
  assert.match(script, /mkdir -m 700 "\$BUNDLE_NEW"\nchown root:wheel "\$BUNDLE_NEW"/);
});

test("macOS install script stops between the bundle step and the sudoers step", () => {
  const script = macScript();
  assert.match(script, /^set -e$/m);
  const setE = script.indexOf("\nset -e\n");
  const bundle = script.indexOf('/bin/sh "$BUNDLE_TOOL"');
  const visudo = script.indexOf('visudo -c -f "$RULE_NEW"');
  assert.ok(setE > 0 && setE < bundle);
  // nothing turns set -e off before the sudoers step
  assert.doesNotMatch(script.slice(setE + 1, visudo), /set \+e/);
  // a failed bundle exits on its own as well
  assert.match(script, /\/bin\/sh "\$BUNDLE_TOOL" "\$OPENVPN_SRC" "\$BUNDLE_NEW" \|\| fail /);
  // the staged copy is removed on any exit
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /cleanup\(\) \{[^}]*rm -rf "\$BUNDLE_NEW"/);
});

test("macOS install script is valid sh; Linux script has no bundle step", () => {
  assert.strictEqual(spawnSync("/bin/sh", ["-n"], { input: macScript(), encoding: "utf8" }).status, 0);
  const linux = privileged.buildInstallScript({
    platform: "linux",
    user: "alice",
    sourceHelper: "/opt/RCP Network/resources/helper/rcp-network-helper",
    helperPath: privileged.helperInstallPath("linux"),
  });
  assert.doesNotMatch(linux, /BUNDLE/);
});

// --- version ------------------------------------------------------------------------

test("HELPER_VERSION is 3 in the module and the script", () => {
  assert.strictEqual(privileged.HELPER_VERSION, 3);
  const script = fs.readFileSync(HELPER, "utf8");
  assert.match(script, /^HELPER_VERSION=3$/m);
});

test("package.json ships bundle-openvpn outside app.asar", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(
    pkg.build.extraResources.some((r) => r.from === "electron/helper/bundle-openvpn" && r.to === "helper/bundle-openvpn"),
  );
  assert.strictEqual(
    privileged.bundleScriptSourcePath("/x/Resources/helper/rcp-network-helper"),
    "/x/Resources/helper/bundle-openvpn",
  );
});
