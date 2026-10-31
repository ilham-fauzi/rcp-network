// SC-1: the latest GitHub release is "available" only when its tag is a
// higher version than the running app; drafts and prereleases are ignored.
const test = require("node:test");
const assert = require("node:assert");
const { FEED_URL, components, isNewer, parseRelease } = require("../electron/updater/logic");
const { releaseJson, fakeUpdater } = require("./update-fixture");

const linux = { platform: "linux", arch: "x64", currentVersion: "1.0.6" };

test("the feed is GitHub's releases/latest for ilham-fauzi/rcp-network", () => {
  assert.strictEqual(FEED_URL, "https://api.github.com/repos/ilham-fauzi/rcp-network/releases/latest");
});

test("version parts ignore the v prefix and a -suffix", () => {
  assert.deepStrictEqual(components("v1.2.3"), [1, 2, 3]);
  assert.deepStrictEqual(components("V1.2"), [1, 2]);
  assert.deepStrictEqual(components("1.2.3-beta.1"), [1, 2, 3]);
  assert.deepStrictEqual(components("1.x.3"), [1, 0, 3]);
});

test("isNewer compares part by part", () => {
  assert.strictEqual(isNewer("v1.0.7", "1.0.6"), true);
  assert.strictEqual(isNewer("1.1", "1.0.9"), true);
  assert.strictEqual(isNewer("2.0.0", "1.9.9"), true);
  assert.strictEqual(isNewer("1.0.7-beta", "1.0.6"), true);
  assert.strictEqual(isNewer("1.0.6", "1.0.6"), false);
  assert.strictEqual(isNewer("1.0", "1.0.0"), false);
  assert.strictEqual(isNewer("v1.0.6-rc1", "1.0.6"), false);
  assert.strictEqual(isNewer("1.0.5", "1.0.6"), false);
  assert.strictEqual(isNewer("0.9.10", "1.0.0"), false);
});

test("a newer tag is available", () => {
  const result = parseRelease(releaseJson({ tag: "v1.0.7" }), linux);
  assert.strictEqual(result.status, "available");
  assert.strictEqual(result.version, "1.0.7");
  assert.strictEqual(result.notes, "What's new");
});

test("an equal or older tag is up to date", () => {
  assert.strictEqual(parseRelease(releaseJson({ tag: "v1.0.6" }), linux).status, "up-to-date");
  assert.strictEqual(parseRelease(releaseJson({ tag: "v1.0.5" }), linux).status, "up-to-date");
});

test("drafts and prereleases are ignored", () => {
  assert.strictEqual(parseRelease(releaseJson({ tag: "v9.0.0", draft: true }), linux).status, "up-to-date");
  assert.strictEqual(parseRelease(releaseJson({ tag: "v9.0.0", prerelease: true }), linux).status, "up-to-date");
});

test("the controller reads the feed and reports available or up to date", async () => {
  const newer = fakeUpdater();
  const state = await newer.updater.check();
  assert.deepStrictEqual(newer.calls.fetch, [FEED_URL]);
  assert.strictEqual(state.state, "available");
  assert.strictEqual(state.version, "1.0.7");

  const same = fakeUpdater({ deps: { currentVersion: "1.0.7" } });
  assert.strictEqual((await same.updater.check()).state, "up-to-date");
});
