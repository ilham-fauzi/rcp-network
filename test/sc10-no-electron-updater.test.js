// SC-10: the old electron-updater wiring and its UpdateNotification toast are gone.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });

const sources = [...listFiles(path.join(root, "electron")), ...listFiles(path.join(root, "src"))].filter((f) => f.endsWith(".js"));

test("no source mentions electron-updater, autoDownload, checkForUpdatesAndNotify or UpdateNotification", () => {
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const word of ["electron-updater", "autoDownload", "checkForUpdatesAndNotify", "UpdateNotification", "autoUpdater"]) {
      assert.ok(!text.includes(word), `${path.relative(root, file)} mentions ${word}`);
    }
  }
});

test("package.json no longer depends on electron-updater or publishes from electron-builder", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.strictEqual(pkg.dependencies["electron-updater"], undefined);
  assert.strictEqual(pkg.build.publish, undefined);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /--publish always/);
});

test("preload no longer exposes the old update events", () => {
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  for (const name of ["onUpdateAvailable", "onUpdateProgress", "onUpdateDownloaded", "onUpdateError"]) {
    assert.ok(!preload.includes(name), name);
  }
});

test("nothing in the update UI closes the window", () => {
  for (const file of ["src/components/UpdateSection.js", "src/App.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /window\.close\(\)/, file);
  }
});
