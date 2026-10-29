// SC-4: Check for Updates next to the version label and in the tray; the
// check shows its state, and a second check cannot start while one runs.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { updateView } = require("../src/updateView");
const { releaseJson, fakeUpdater } = require("./update-fixture");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("two checks at once make one request", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { updater, calls } = fakeUpdater({
    deps: {
      fetchText: async (url) => {
        calls.fetch.push(url);
        await gate;
        return releaseJson();
      },
    },
  });
  const first = updater.check();
  const second = updater.check();
  assert.strictEqual(first, second);
  release();
  await first;
  assert.strictEqual(calls.fetch.length, 1);
});

test("a manual check goes through checking to available, up to date or failed", async () => {
  const available = fakeUpdater();
  await available.updater.check();
  assert.deepStrictEqual(available.calls.sent.map((s) => s.state), ["checking", "available"]);
  assert.strictEqual(available.calls.sent[1].notes, "What's new");

  const upToDate = fakeUpdater({ deps: { currentVersion: "2.0.0" } });
  await upToDate.updater.check();
  assert.deepStrictEqual(upToDate.calls.sent.map((s) => s.state), ["checking", "up-to-date"]);

  const failed = fakeUpdater({
    deps: {
      fetchText: async () => {
        throw new Error("The update server answered with HTTP 503.");
      },
    },
  });
  await failed.updater.check();
  const last = failed.calls.sent[failed.calls.sent.length - 1];
  assert.strictEqual(last.state, "failed");
  assert.strictEqual(last.error, "The update server answered with HTTP 503.");
});

test("the view text for each state, with the button disabled while checking", () => {
  assert.strictEqual(updateView({ state: "checking" }).text, "Checking for updates…");
  assert.strictEqual(updateView({ state: "checking" }).checkDisabled, true);
  assert.strictEqual(updateView({ state: "up-to-date" }).text, "RCP Network is up to date.");
  assert.strictEqual(updateView({ state: "up-to-date" }).checkDisabled, false);
  const available = updateView({ state: "available", version: "1.0.7", notes: "Fixes", installable: true, canSelfInstall: true });
  assert.strictEqual(available.text, "Version 1.0.7 is available.");
  assert.strictEqual(available.notes, "Fixes");
  assert.strictEqual(available.showInstall, true);
  const failed = updateView({ state: "failed", error: "offline" });
  assert.strictEqual(failed.text, "The update failed.");
  assert.strictEqual(failed.error, "offline");
});

test("the button sits next to the version label", () => {
  const section = read("src/components/UpdateSection.js");
  assert.match(section, /<p>Version \{appVersion\}<\/p>\s*<button[\s\S]*?disabled=\{view\.checkDisabled\}[\s\S]*?Check for Updates\s*<\/button>/);
  assert.match(read("src/components/ConnectionControl.js"), /<UpdateSection appVersion=\{appVersion\} \/>/);
});

test("the tray menu has Check for Updates, which runs a manual check", () => {
  const main = read("electron/main.js");
  const start = main.indexOf("function updateTrayMenu()");
  const end = main.indexOf("tray.setContextMenu(contextMenu)", start);
  const menu = main.slice(start, end);
  const item = menu.indexOf('label: "Check for Updates"');
  assert.ok(item >= 0, "tray item missing");
  assert.match(menu.slice(item, item + 400), /getUpdater\(\)\.check\(\{ quiet: false \}\)/);
});

test("the window and preload expose the manual check", () => {
  assert.match(read("electron/main.js"), /ipcMain\.handle\("update-check", \(\) => getUpdater\(\)\.check\(\{ quiet: false \}\)\)/);
  assert.match(read("electron/preload.js"), /checkForUpdates: \(\) => ipcRenderer\.invoke\('update-check'\)/);
});
