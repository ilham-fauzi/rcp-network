// SC-4: the helper's checks, run as the current (non-root) user in test mode.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fixture = require("./openvpn-fixture");

const { HELPER, FIXED_OPENVPN, isMac } = fixture;

// The OpenVPN the helper may use: on macOS a fake private copy in a trusted
// temporary folder, on Linux the fixed list.
const openvpn = fixture.trustedOpenVpn();
const noOpenVpn = openvpn.skip || false;

const FORBIDDEN = [
  "plugin", "up", "down", "route-up", "route-pre-down", "ipchange",
  "learn-address", "tls-verify", "auth-user-pass-verify", "client-connect",
  "client-disconnect", "config", "cd", "chroot", "log", "log-append",
  "status", "writepid", "management",
];

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

const tempDirs = [];
test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  fixture.cleanup();
});

const setup = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-helper-test-"));
  const dir = path.join(home, ".rcp-network");
  fs.mkdirSync(dir);
  const auth = path.join(dir, ".vpn_auth_1.tmp");
  fs.writeFileSync(auth, "user\npass\n", { mode: 0o600 });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-helper-outside-"));
  tempDirs.push(home, outside);
  return { home, dir, auth, outside };
};

const writeConfig = (dir, name, body) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
};

const GOOD = "client\ndev tun\nproto udp\nremote vpn.example.com 1194\ndhcp-option DNS 10.0.0.1\n";

const helper = (env, ...args) =>
  spawnSync("/bin/sh", [HELPER, "--dry-run", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...openvpn.env, ...env },
  });

const skip = isRoot ? "test mode is ignored as root" : false;

test("--version prints an integer", () => {
  const r = spawnSync("/bin/sh", [HELPER, "--version"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+$/);
});

test("good config gives a command with --script-security 1 after --config", { skip: skip || noOpenVpn }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "good.ovpn", GOOD);
  const r = helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth);
  assert.strictEqual(r.status, 0, r.stderr);
  const words = r.stdout.trim().split(/\s+/);
  const configAt = words.indexOf("--config");
  const securityAt = words.indexOf("--script-security");
  assert.ok(configAt > 0, r.stdout);
  assert.ok(securityAt > configAt, "--script-security must come after --config");
  assert.strictEqual(words[securityAt + 1], "1");
  assert.ok(words.includes("--auth-user-pass"));
  assert.ok(words.includes("--writepid"));
  assert.strictEqual(words[0], openvpn.binary);
  if (!isMac) assert.ok(FIXED_OPENVPN.includes(words[0]), `unexpected OpenVPN path ${words[0]}`);
});

test("OpenVPN comes only from the helper's own choice, never from PATH or the environment", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "good.ovpn", GOOD);
  const fakeBin = path.join(t.outside, "bin");
  fs.mkdirSync(fakeBin);
  const fake = path.join(fakeBin, "openvpn");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const r = helper(
    { RCP_HELPER_TEST_HOME: t.home, PATH: `${fakeBin}:${process.env.PATH}`, OPENVPN: fake, OPENVPN_PATH: fake },
    "connect", config, t.auth,
  );
  assert.ok(!r.stdout.includes(fake), "helper used an OpenVPN path it was given");
  if (!noOpenVpn) {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim().split(/\s+/)[0], openvpn.binary);
  } else {
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /^refused: /m);
  }
});

const expectRefused = (r) => {
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /^refused: /m);
};

test("refuses a config outside ~/.rcp-network", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.outside, "outside.ovpn", GOOD);
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth));
});

test("refuses a symlink inside the folder that points outside", { skip }, () => {
  const t = setup();
  const target = writeConfig(t.outside, "target.ovpn", GOOD);
  const link = path.join(t.dir, "link.ovpn");
  fs.symlinkSync(target, link);
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", link, t.auth));
});

test("refuses a config in a subfolder (must be directly inside)", { skip }, () => {
  const t = setup();
  fs.mkdirSync(path.join(t.dir, "sub"));
  const config = writeConfig(path.join(t.dir, "sub"), "nested.ovpn", GOOD);
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth));
});

test("refuses an auth file outside the folder", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "good.ovpn", GOOD);
  const auth = path.join(t.outside, "auth.txt");
  fs.writeFileSync(auth, "user\npass\n");
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, auth));
});

test("refuses an auth file symlink that leaves the folder", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "good.ovpn", GOOD);
  const link = path.join(t.dir, ".vpn_auth_link.tmp");
  fs.symlinkSync("/etc/hosts", link);
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, link));
});

const mixedCase = (word) =>
  word
    .split("")
    .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
    .join("");

for (const directive of FORBIDDEN) {
  const forms = {
    plain: `${directive} /tmp/evil`,
    indented: ` \t  ${directive} /tmp/evil`,
    "mixed-case": `${mixedCase(directive)} /tmp/evil`,
    "dash-prefixed": `--${directive} /tmp/evil`,
    "inline block": `<${directive}>\n/tmp/evil\n</${directive}>`,
  };
  for (const [form, line] of Object.entries(forms)) {
    test(`refuses a config with ${form} '${directive}'`, { skip }, () => {
      const t = setup();
      const config = writeConfig(t.dir, "bad.ovpn", `${GOOD}${line}\n`);
      const r = helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth);
      expectRefused(r);
      assert.match(r.stderr, /forbidden directive/);
    });
  }
}

test("accepts commented-out directives", { skip: skip || noOpenVpn }, () => {
  const t = setup();
  const config = writeConfig(
    t.dir,
    "commented.ovpn",
    `${GOOD}# up /etc/openvpn/update-resolv-conf\n  ; down /x\n#plugin /x.so\n`,
  );
  const r = helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("does not mistake longer directive names for forbidden ones", { skip: skip || noOpenVpn }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "longer.ovpn", `${GOOD}up-delay\nstatus-version 2\nroute-delay 2\n`);
  const r = helper({ RCP_HELPER_TEST_HOME: t.home }, "connect", config, t.auth);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("disconnect refuses a config outside the folder", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.outside, "outside.ovpn", GOOD);
  expectRefused(helper({ RCP_HELPER_TEST_HOME: t.home }, "disconnect", config));
});

test("without --dry-run and not root, connect refuses to run", { skip }, () => {
  const t = setup();
  const config = writeConfig(t.dir, "good.ovpn", GOOD);
  const r = spawnSync("/bin/sh", [HELPER, "connect", config, t.auth], {
    encoding: "utf8",
    env: { ...process.env, RCP_HELPER_TEST_HOME: t.home },
  });
  assert.strictEqual(r.status, 2);
});

test("unknown commands are refused", () => {
  const r = spawnSync("/bin/sh", [HELPER, "run", "/bin/sh"], { encoding: "utf8" });
  expectRefused(r);
});
