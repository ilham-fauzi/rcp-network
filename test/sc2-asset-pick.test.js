// SC-2: a release is installable only with this platform and arch's asset
// and its .sig; otherwise it is "no installable download".
const test = require("node:test");
const assert = require("node:assert");
const { assetNameFor, parseRelease, NO_INSTALLABLE_DOWNLOAD } = require("../electron/updater/logic");
const { updateView } = require("../src/updateView");
const { releaseJson, fakeUpdater } = require("./update-fixture");

const pick = (platform, arch, json = releaseJson()) =>
  parseRelease(json, { platform, arch, currentVersion: "1.0.6" });

test("asset names per platform", () => {
  assert.strictEqual(assetNameFor({ platform: "darwin", arch: "x64", version: "1.0.7" }), "RCP-Network-1.0.7-x64.zip");
  assert.strictEqual(assetNameFor({ platform: "darwin", arch: "arm64", version: "1.0.7" }), "RCP-Network-1.0.7-arm64.zip");
  assert.strictEqual(assetNameFor({ platform: "win32", arch: "x64", version: "1.0.7" }), "RCP-Network-Setup-1.0.7.exe");
  assert.strictEqual(assetNameFor({ platform: "linux", arch: "x64", version: "1.0.7" }), "RCP-Network-1.0.7.AppImage");
  assert.throws(() => assetNameFor({ platform: "darwin", arch: "ia32", version: "1.0.7" }));
});

test("each platform picks its own asset and signature", () => {
  for (const [platform, arch, name] of [
    ["darwin", "x64", "RCP-Network-1.0.7-x64.zip"],
    ["darwin", "arm64", "RCP-Network-1.0.7-arm64.zip"],
    ["win32", "x64", "RCP-Network-Setup-1.0.7.exe"],
    ["linux", "x64", "RCP-Network-1.0.7.AppImage"],
  ]) {
    const result = pick(platform, arch);
    assert.strictEqual(result.asset.name, name);
    assert.ok(result.asset.url.endsWith(`/${name}`));
    assert.ok(result.asset.sigUrl.endsWith(`/${name}.sig`));
  }
});

test("an Intel build never picks the arm64 zip, and the reverse", () => {
  const armOnly = releaseJson({ names: ["RCP-Network-1.0.7-arm64.zip", "RCP-Network-1.0.7-arm64.zip.sig"] });
  assert.strictEqual(pick("darwin", "x64", armOnly).asset, null);
  const intelOnly = releaseJson({ names: ["RCP-Network-1.0.7-x64.zip", "RCP-Network-1.0.7-x64.zip.sig"] });
  assert.strictEqual(pick("darwin", "arm64", intelOnly).asset, null);
  assert.strictEqual(pick("darwin", "x64", intelOnly).asset.name, "RCP-Network-1.0.7-x64.zip");
});

test("a missing signature or asset means no installable download", () => {
  const noSig = releaseJson({ names: ["RCP-Network-1.0.7.AppImage"] });
  const result = pick("linux", "x64", noSig);
  assert.strictEqual(result.status, "available");
  assert.strictEqual(result.asset, null);
  assert.strictEqual(result.reason, NO_INSTALLABLE_DOWNLOAD);

  const sigOnly = releaseJson({ names: ["RCP-Network-Setup-1.0.7.exe.sig"] });
  assert.strictEqual(pick("win32", "x64", sigOnly).asset, null);
});

test("no installable download offers Open Download Page, not Update and Restart", async () => {
  const noAsset = releaseJson({ names: ["RCP-Network-1.0.7-arm64.zip", "RCP-Network-1.0.7-arm64.zip.sig"] });
  const { updater, calls } = fakeUpdater({ deps: { fetchText: async () => noAsset } });
  const state = await updater.check();
  assert.strictEqual(state.state, "available");
  assert.strictEqual(state.installable, false);
  assert.strictEqual(state.noDownloadReason, NO_INSTALLABLE_DOWNLOAD);
  const view = updateView(state);
  assert.strictEqual(view.showOpenPage, true);
  assert.strictEqual(view.showInstall, false);

  await updater.installAndRestart();
  assert.strictEqual(calls.download, 0);
  assert.strictEqual(calls.quit, 0);
});
