// SC-9: scripts/release.sh signs every release asset with the local key,
// refuses a key that does not match the app or a missing platform asset,
// and with --publish tags and uploads everything. It runs here against a
// copy of the repo's scripts in a temp folder, with a temp HOME for the key
// and fake git and gh on PATH.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifySignature } = require("../electron/updater/logic");
const { tempDir } = require("./update-fixture");

const root = path.join(__dirname, "..");
const VERSION = "1.0.7";
const DMGS = [`RCP-Network-${VERSION}-x64.dmg`, `RCP-Network-${VERSION}-arm64.dmg`];
const SIGNED = [
  `RCP-Network-${VERSION}-x64.zip`,
  `RCP-Network-${VERSION}-arm64.zip`,
  `RCP-Network-Setup-${VERSION}.exe`,
  `RCP-Network-${VERSION}.AppImage`,
];

const setup = ({ embed = "match", skip = [], dirty = false } = {}) => {
  const repo = tempDir("rcp-release-");
  const home = path.join(repo, "home");
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, "scripts"));
  for (const f of ["release.sh", "update-key.js"]) {
    fs.copyFileSync(path.join(root, "scripts", f), path.join(repo, "scripts", f));
  }
  fs.chmodSync(path.join(repo, "scripts", "release.sh"), 0o755);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ version: VERSION }));

  const env = { ...process.env, HOME: home };
  const keygen = spawnSync("node", [path.join(repo, "scripts", "update-key.js"), "keygen"], { env, encoding: "utf8" });
  assert.strictEqual(keygen.status, 0, keygen.stderr);
  const publicKey = keygen.stdout.match(/Public key:\s+(\S+)/)[1];

  const embedded = embed === "match" ? publicKey : embed === "placeholder" ? "TODO-REPLACE-WITH-update-key.js-public" : embed;
  const logic = fs.readFileSync(path.join(root, "electron", "updater", "logic.js"), "utf8")
    .replace(/PUBLIC_KEY = "[^"]*"/, `PUBLIC_KEY = "${embedded}"`);
  fs.mkdirSync(path.join(repo, "electron", "updater"), { recursive: true });
  fs.writeFileSync(path.join(repo, "electron", "updater", "logic.js"), logic);

  fs.mkdirSync(path.join(repo, "dist"));
  for (const name of [...DMGS, ...SIGNED]) {
    if (!skip.includes(name)) fs.writeFileSync(path.join(repo, "dist", name), `contents of ${name}`);
  }

  // Fake git and gh that record their arguments
  const bin = path.join(repo, "bin");
  fs.mkdirSync(bin);
  const record = path.join(repo, "calls.log");
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh\necho "git $*" >> "${record}"\nif [ "$1" = status ]; then ${dirty ? 'echo " M x"' : "true"}; fi\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "gh $*" >> "${record}"\n`, { mode: 0o755 });

  const run = (...args) =>
    spawnSync(path.join(repo, "scripts", "release.sh"), args, {
      env: { ...env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
  const calls = () => (fs.existsSync(record) ? fs.readFileSync(record, "utf8") : "");
  return { repo, publicKey, run, calls };
};

test("signs the zips, the exe and the AppImage; every signature verifies", () => {
  const s = setup();
  const r = s.run();
  assert.strictEqual(r.status, 0, r.stderr);
  for (const name of SIGNED) {
    const file = path.join(s.repo, "dist", name);
    const sig = fs.readFileSync(`${file}.sig`, "utf8");
    assert.strictEqual(verifySignature(fs.readFileSync(file), sig, s.publicKey), true, name);
  }
  for (const name of DMGS) assert.strictEqual(fs.existsSync(path.join(s.repo, "dist", `${name}.sig`)), false);
  assert.strictEqual(s.calls(), "", "nothing is tagged or uploaded without --publish");
});

test("refuses while the app still has the placeholder key", () => {
  const s = setup({ embed: "placeholder" });
  const r = s.run();
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no public key yet/);
});

test("refuses a key that does not match the app", () => {
  const s = setup({ embed: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
  const r = s.run();
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /does not match PUBLIC_KEY/);
  assert.strictEqual(fs.existsSync(path.join(s.repo, "dist", `${SIGNED[0]}.sig`)), false);
});

test("refuses when any platform asset is missing", () => {
  for (const missing of [...SIGNED, DMGS[0]]) {
    const s = setup({ skip: [missing] });
    const r = s.run();
    assert.notStrictEqual(r.status, 0, missing);
    assert.match(r.stderr, new RegExp(`missing dist/${missing.replace(/\./g, "\\.")}`));
    assert.strictEqual(fs.existsSync(path.join(s.repo, "dist", `${SIGNED[1]}.sig`)), false);
  }
});

test("--publish tags, pushes the tag and uploads the dmgs, the signed assets and every .sig", () => {
  const s = setup();
  const r = s.run("--publish");
  assert.strictEqual(r.status, 0, r.stderr);
  const calls = s.calls();
  assert.match(calls, /^git tag v1\.0\.7$/m);
  assert.match(calls, /^git push origin v1\.0\.7$/m);
  const upload = calls.split("\n").find((l) => l.startsWith("gh release create"));
  assert.ok(upload, "gh release create not called");
  assert.match(upload, /^gh release create v1\.0\.7 /);
  assert.match(upload, /--repo ilham-fauzi\/rcp-network/);
  for (const name of [...DMGS, ...SIGNED, ...SIGNED.map((n) => `${n}.sig`)]) {
    assert.ok(upload.includes(`dist/${name} `), `${name} not uploaded`);
  }
});

test("--publish refuses a dirty tree", () => {
  const s = setup({ dirty: true });
  const r = s.run("--publish");
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /commit your changes/);
  assert.doesNotMatch(s.calls(), /git tag|gh release/);
});

test("keygen refuses to overwrite an existing key", () => {
  const s = setup();
  const again = spawnSync("node", [path.join(s.repo, "scripts", "update-key.js"), "keygen"], {
    env: { ...process.env, HOME: path.join(s.repo, "home") },
    encoding: "utf8",
  });
  assert.notStrictEqual(again.status, 0);
  assert.match(again.stderr, /refusing to overwrite/);
});
