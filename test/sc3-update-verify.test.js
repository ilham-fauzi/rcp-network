// SC-3: a download is used only if its Ed25519 signature verifies; on macOS
// the unpacked app must also have the right bundle ID and version. Any
// failure discards the download and gives the reason.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { verifySignature, PUBLIC_KEY } = require("../electron/updater/logic");
const { stage, BAD_SIGNATURE, APP_ID } = require("../electron/updater/stage");
const { makeKey, tempDir, fakeUpdater } = require("./update-fixture");

const key = makeKey();
const other = makeKey();

const signedFile = (contents = "release bytes") => {
  const dir = tempDir();
  const file = path.join(dir, "asset.bin");
  fs.writeFileSync(file, contents);
  return { dir, file, sig: key.sign(Buffer.from(contents)) };
};

test("a good signature verifies; a changed byte, wrong key or bad text does not", () => {
  const data = Buffer.from("release bytes");
  const sig = key.sign(data);
  assert.strictEqual(verifySignature(data, sig, key.publicBase64), true);
  assert.strictEqual(verifySignature(Buffer.from("release byteS"), sig, key.publicBase64), false);
  assert.strictEqual(verifySignature(data, sig, other.publicBase64), false);
  assert.strictEqual(verifySignature(data, "not base64!!", key.publicBase64), false);
  assert.strictEqual(verifySignature(data, "", key.publicBase64), false);
});

test("the embedded placeholder key verifies nothing", () => {
  const data = Buffer.from("x");
  assert.strictEqual(verifySignature(data, key.sign(data), PUBLIC_KEY), false);
});

test("a verified Windows or Linux download is staged as is", async () => {
  for (const platform of ["win32", "linux"]) {
    const { dir, file, sig } = signedFile();
    const staged = await stage({ file, sigText: sig, platform, version: "1.0.7", workDir: dir, publicKey: key.publicBase64 });
    assert.strictEqual(staged, file);
    assert.ok(fs.existsSync(file));
  }
});

test("a bad signature discards the download and says why", async () => {
  const { dir, file } = signedFile();
  const badSig = other.sign(Buffer.from("release bytes"));
  await assert.rejects(
    stage({ file, sigText: badSig, platform: "linux", version: "1.0.7", workDir: dir, publicKey: key.publicBase64 }),
    { message: BAD_SIGNATURE },
  );
  assert.strictEqual(fs.existsSync(file), false);
});

// Fake ditto and plutil: ditto makes `appName` in the unpack folder,
// plutil answers from `plist`.
const macRun = ({ appName = "RCP Network.app", plist }) => async (file, args) => {
  if (file === "ditto") {
    const dest = args[args.length - 1];
    if (appName) fs.mkdirSync(path.join(dest, appName, "Contents"), { recursive: true });
    return { stdout: "", stderr: "" };
  }
  if (file === "plutil") {
    const value = plist[args[1]];
    if (value === undefined) throw new Error("No value at that key path");
    return { stdout: `${value}\n`, stderr: "" };
  }
  throw new Error(`unexpected ${file}`);
};

const stageMac = (plist, appName) => {
  const { dir, file, sig } = signedFile();
  const run = macRun({ plist, appName });
  const promise = stage({ file, sigText: sig, platform: "darwin", version: "1.0.7", workDir: dir, run, publicKey: key.publicBase64 });
  return { dir, file, promise };
};

test("macOS: a verified zip with the right bundle ID and version is staged", async () => {
  const { dir, promise } = stageMac({ CFBundleIdentifier: APP_ID, CFBundleShortVersionString: "1.0.7" });
  assert.strictEqual(await promise, path.join(dir, "new", "RCP Network.app"));
});

test("macOS: a wrong bundle ID, wrong version or no app is refused and discarded", async () => {
  for (const [plist, appName, reason] of [
    [{ CFBundleIdentifier: "com.example.other", CFBundleShortVersionString: "1.0.7" }, undefined, /bundle ID is com\.example\.other/],
    [{ CFBundleIdentifier: APP_ID, CFBundleShortVersionString: "1.0.6" }, undefined, /version is 1\.0\.6, not 1\.0\.7/],
    [{}, null, /expected one \.app, found 0/],
  ]) {
    const { dir, file, promise } = stageMac(plist, appName);
    await assert.rejects(promise, (error) => {
      assert.match(error.message, /^The downloaded app is not valid: /);
      assert.match(error.message, reason);
      return true;
    });
    assert.strictEqual(fs.existsSync(file), false);
    assert.strictEqual(fs.existsSync(path.join(dir, "new")), false);
  }
});

test("a staging failure shows the reason and does not quit", async () => {
  const { updater, calls } = fakeUpdater({
    deps: {
      stage: async () => {
        throw new Error(BAD_SIGNATURE);
      },
    },
  });
  await updater.check();
  const state = await updater.installAndRestart();
  assert.strictEqual(state.state, "failed");
  assert.strictEqual(state.error, BAD_SIGNATURE);
  assert.strictEqual(calls.install.length, 0);
  assert.strictEqual(calls.quit, 0);
});
