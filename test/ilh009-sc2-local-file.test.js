// ilh-009 SC-2: ticked values go to credentials.json (0600, folder 0700,
// replaced atomically); unticked values are removed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCredentialStore } = require("../electron/credentials");

const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-creds-"));
  dirs.push(dir);
  fs.chmodSync(dir, 0o755);
  return { dir, store: createCredentialStore(dir) };
};
const readFile = (store) => JSON.parse(fs.readFileSync(store.file, "utf8"));
const mode = (p) => fs.statSync(p).mode & 0o777;

test("email only, password only, both", () => {
  const { store } = setup();
  store.save("a.ovpn", { email: "a@x.id" });
  store.save("b.ovpn", { password: "tok1" });
  store.save("c.ovpn", { email: "c@x.id", password: "tok2" });
  assert.deepStrictEqual(readFile(store), {
    "a.ovpn": { email: "a@x.id" },
    "b.ovpn": { password: "tok1" },
    "c.ovpn": { email: "c@x.id", password: "tok2" },
  });
});

test("unticking removes only that field, and an empty profile is dropped", () => {
  const { store } = setup();
  store.save("a.ovpn", { email: "a@x.id", password: "tok" });
  store.remove("a.ovpn", ["email"]);
  assert.deepStrictEqual(readFile(store), { "a.ovpn": { password: "tok" } });
  store.remove("a.ovpn", ["password"]);
  assert.deepStrictEqual(readFile(store), {});
});

test("file is 0600 and folder 0700, also over an older 0644 file", () => {
  const { dir, store } = setup();
  fs.writeFileSync(store.file, "{}", { mode: 0o644 });
  fs.chmodSync(store.file, 0o644);
  store.save("a.ovpn", { email: "a@x.id" });
  assert.strictEqual(mode(store.file), 0o600);
  assert.strictEqual(mode(dir), 0o700);
});

test("no temp file is left after a save", () => {
  const { dir, store } = setup();
  store.save("a.ovpn", { email: "a@x.id", password: "tok" });
  assert.deepStrictEqual(fs.readdirSync(dir), ["credentials.json"]);
});

test("nothing is written when no value is given", () => {
  const { store } = setup();
  assert.strictEqual(store.save("a.ovpn", {}), false);
  assert.strictEqual(store.save("a.ovpn", { email: null, password: undefined }), false);
  assert.strictEqual(fs.existsSync(store.file), false);
});
