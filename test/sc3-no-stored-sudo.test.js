// SC-3: the app no longer stores, reads or pipes the sudo password.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainJs = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });

test("electron/main.js contains no sudo -S", () => {
  assert.doesNotMatch(mainJs, /sudo\s+-S/);
});

test("electron/main.js never writes or reads the sudo password keychain item", () => {
  assert.doesNotMatch(mainJs, /setPassword\(\s*KEYCHAIN_SERVICE/);
  assert.doesNotMatch(mainJs, /getPassword\(\s*KEYCHAIN_SERVICE/);
});

test("startup deletes the old sudo password keychain item", () => {
  const start = mainJs.indexOf("app.whenReady()");
  assert.ok(start >= 0, "app.whenReady() block not found");
  const end = mainJs.indexOf("\n});", start);
  const startup = mainJs.slice(start, end);
  assert.match(startup, /deletePassword\(KEYCHAIN_SERVICE/);
});

test("preload and renderer have no SudoPassword", () => {
  assert.doesNotMatch(preloadJs, /SudoPassword/);
  for (const file of listFiles(path.join(root, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /SudoPassword/, `${path.relative(root, file)} mentions SudoPassword`);
  }
  assert.ok(!fs.existsSync(path.join(root, "src", "components", "SudoPasswordDialog.js")));
});

test("every sudo in electron/main.js is sudo -n", () => {
  const uses = [...mainJs.matchAll(/sudo /g)];
  assert.ok(uses.length > 0, "expected sudo -n call sites");
  for (const use of uses) {
    const rest = mainJs.slice(use.index, use.index + 7);
    assert.strictEqual(rest, "sudo -n", `non -n sudo near: ${mainJs.slice(use.index - 40, use.index + 40)}`);
  }
});

test("privileged actions go through the helper", () => {
  assert.match(mainJs, /sudo -n '\$\{escapedHelperPath\}' connect /);
  assert.match(mainJs, /runHelper\(\["disconnect", /);
  assert.match(mainJs, /runHelper\(\["disconnect-all"\]\)/);
  assert.match(mainJs, /runHelper\(\["flush-dns"\]\)/);
  assert.doesNotMatch(mainJs, /pkill/);
});
