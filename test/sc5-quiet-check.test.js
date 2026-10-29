// SC-5: at launch, a quiet check at most once every 24 hours when the
// preference is on; a quiet failure shows nothing; a newer version shows a
// thin banner; nothing downloads until Update and Restart.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DAY_MS, LAST_CHECK_KEY, AUTO_CHECK_KEY } = require("../electron/updater");
const { updateView } = require("../src/updateView");
const { fakeUpdater } = require("./update-fixture");

const NOW = 1000000000000;

test("no check within 24 hours of the last one", async () => {
  const { updater, calls, prefsStore } = fakeUpdater();
  prefsStore[LAST_CHECK_KEY] = NOW - DAY_MS + 60000;
  assert.strictEqual(await updater.checkIfDue(), null);
  assert.strictEqual(calls.fetch.length, 0);
});

test("one quiet check after 24 hours, and the time is saved", async () => {
  const { updater, calls, prefsStore } = fakeUpdater();
  prefsStore[LAST_CHECK_KEY] = NOW - DAY_MS - 1;
  const state = await updater.checkIfDue();
  assert.strictEqual(calls.fetch.length, 1);
  assert.strictEqual(state.state, "available");
  assert.strictEqual(prefsStore[LAST_CHECK_KEY], NOW);
  assert.ok(!calls.sent.some((s) => s.state === "checking"), "a quiet check shows no checking state");
});

test("the first launch checks, because there is no last check yet", async () => {
  const { updater, calls } = fakeUpdater();
  await updater.checkIfDue();
  assert.strictEqual(calls.fetch.length, 1);
});

test("the preference defaults to on, and off means no check", async () => {
  const on = fakeUpdater();
  assert.strictEqual(on.deps.prefs.get(AUTO_CHECK_KEY, true), true);

  const off = fakeUpdater();
  off.prefsStore[AUTO_CHECK_KEY] = false;
  assert.strictEqual(await off.updater.checkIfDue(), null);
  assert.strictEqual(off.calls.fetch.length, 0);
});

test("a quiet check that fails shows nothing", async () => {
  const { updater, calls } = fakeUpdater({
    deps: {
      fetchText: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.github.com");
      },
    },
  });
  const state = await updater.checkIfDue();
  assert.strictEqual(state.state, "idle");
  assert.ok(!calls.sent.some((s) => s.state === "failed" || s.error));
  const view = updateView(state);
  assert.strictEqual(view.text, null);
  assert.strictEqual(view.banner, null);
});

test("a newer version shows the banner text", () => {
  const view = updateView({ state: "available", version: "1.0.7", installable: true, canSelfInstall: true });
  assert.strictEqual(view.banner, "RCP Network 1.0.7 is available");
  assert.strictEqual(updateView({ state: "up-to-date" }).banner, null);
});

test("the banner links to the update section", () => {
  const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "UpdateSection.js"), "utf8");
  assert.match(section, /export const UpdateBanner/);
  assert.match(section, /dispatchEvent\(new Event\(OPEN_UPDATE_SECTION\)\)/);
  assert.match(section, /addEventListener\(OPEN_UPDATE_SECTION, show\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8"), /<UpdateBanner \/>/);
});

test("checking never downloads; only Update and Restart does", async () => {
  const { updater, calls } = fakeUpdater();
  await updater.checkIfDue();
  await updater.check();
  assert.strictEqual(calls.download, 0);
  await updater.installAndRestart();
  assert.strictEqual(calls.download, 1);
});

test("startup runs the once-a-day check", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const start = main.indexOf("app.whenReady()");
  const startup = main.slice(start, main.indexOf("\n});", start));
  assert.match(startup, /getUpdater\(\)\.checkIfDue\(\)/);
});
