// ilh-009 SC-3: saved values pre-fill a profile; "Apply to all configs" covers
// every .ovpn; a missing or broken file means nothing saved.
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
  return { dir, store: createCredentialStore(dir) };
};
const NOTHING = { email: null, password: null };

test("load returns what save stored", () => {
  const { store } = setup();
  store.save("prod.ovpn", { email: "a@x.id", password: "tok" });
  assert.deepStrictEqual(store.load("prod.ovpn"), { email: "a@x.id", password: "tok" });
  assert.deepStrictEqual(store.load("dev.ovpn"), NOTHING);
});

test("missing, empty or malformed file reads as nothing saved", () => {
  const { store } = setup();
  assert.deepStrictEqual(store.load("prod.ovpn"), NOTHING);
  for (const text of ["", "{not json", "[1,2]", "null"]) {
    fs.writeFileSync(store.file, text);
    assert.deepStrictEqual(store.load("prod.ovpn"), NOTHING, JSON.stringify(text));
  }
  // and a save over a broken file still works
  store.save("prod.ovpn", { email: "a@x.id" });
  assert.deepStrictEqual(store.load("prod.ovpn"), { email: "a@x.id", password: null });
});

test("apply to all covers every .ovpn and nothing else, in one write", () => {
  const { dir, store } = setup();
  for (const f of ["a.ovpn", "b.ovpn", "c.ovpn", "a.log", "notes.txt"]) fs.writeFileSync(path.join(dir, f), "");
  store.save("a.ovpn", { password: "old" });
  let renames = 0;
  const rename = fs.renameSync;
  fs.renameSync = (...args) => {
    renames++;
    return rename(...args);
  };
  try {
    assert.strictEqual(store.saveToAll({ email: "a@x.id", password: "tok" }), 3);
  } finally {
    fs.renameSync = rename;
  }
  assert.strictEqual(renames, 1);
  const data = JSON.parse(fs.readFileSync(store.file, "utf8"));
  assert.deepStrictEqual(Object.keys(data).sort(), ["a.ovpn", "b.ovpn", "c.ovpn"]);
  for (const f of ["a.ovpn", "b.ovpn", "c.ovpn"]) assert.deepStrictEqual(data[f], { email: "a@x.id", password: "tok" });
});
