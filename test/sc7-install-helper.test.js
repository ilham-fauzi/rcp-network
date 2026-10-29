// SC-7: download progress, and the detached helper that installs after the
// app quits: macOS swaps the .app (restoring it if the copy fails), Linux
// swaps the AppImage the same way, Windows runs the NSIS installer silently.
// Each run logs to install.log. The macOS and Linux scripts run here for
// real against fake apps in a temp folder, with `open` replaced on PATH.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { buildScript, installTarget, startInstall } = require("../electron/updater/install");
const { download } = require("../electron/updater/stage");
const { tempDir, fakeUpdater } = require("./update-fixture");

// A PID that has already exited
const deadPid = () => spawnSync("true").pid;

const waitFor = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
};

const macFixture = () => {
  const dir = tempDir("rcp-install-mac-");
  const work = path.join(dir, "work");
  const target = path.join(dir, "Applications", "RCP Network.app");
  const fresh = path.join(work, "new", "RCP Network.app");
  for (const [app, marker] of [[target, "old"], [fresh, "new"]]) {
    fs.mkdirSync(path.join(app, "Contents"), { recursive: true });
    fs.writeFileSync(path.join(app, "Contents", "marker"), marker);
  }
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$@" >> "${dir}/open.log"\n`, { mode: 0o755 });
  const script = path.join(work, "install.sh");
  fs.writeFileSync(script, buildScript("darwin"), { mode: 0o700 });
  const run = (newPath) =>
    spawnSync("/bin/bash", [script, String(deadPid()), newPath, target, work], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
  const log = () => fs.readFileSync(path.join(work, "install.log"), "utf8");
  const opened = () => (fs.existsSync(path.join(dir, "open.log")) ? fs.readFileSync(path.join(dir, "open.log"), "utf8") : "");
  return { dir, work, target, fresh, run, log, opened };
};

const darwinOnly = { skip: process.platform !== "darwin" && "needs ditto (macOS)" };

test("macOS: the new app replaces the old one and is relaunched", darwinOnly, () => {
  const f = macFixture();
  const r = f.run(f.fresh);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(f.target, "Contents", "marker"), "utf8"), "new");
  assert.strictEqual(fs.existsSync(path.join(f.work, "previous.app")), false);
  assert.strictEqual(fs.existsSync(f.fresh), false);
  assert.strictEqual(f.opened().trim(), f.target);
  assert.match(f.log(), /done\n$/);
});

test("macOS: a failed copy restores and relaunches the old app", darwinOnly, () => {
  const f = macFixture();
  const r = f.run(path.join(f.work, "missing.app"));
  assert.strictEqual(r.status, 1);
  assert.strictEqual(fs.readFileSync(path.join(f.target, "Contents", "marker"), "utf8"), "old");
  assert.match(f.log(), /copy failed, restoring/);
  assert.strictEqual(f.opened().trim(), f.target);
});

const linuxFixture = () => {
  const dir = tempDir("rcp-install-linux-");
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  const launched = path.join(dir, "launched");
  const appImage = (label) => `#!/bin/sh\necho ${label} > "${launched}"\n`;
  const target = path.join(dir, "RCP-Network.AppImage");
  fs.writeFileSync(target, appImage("old"), { mode: 0o755 });
  const fresh = path.join(work, "RCP-Network-1.0.7.AppImage");
  fs.writeFileSync(fresh, appImage("new"), { mode: 0o644 });
  const script = path.join(work, "install.sh");
  fs.writeFileSync(script, buildScript("linux"), { mode: 0o700 });
  const run = (newPath) => spawnSync("/bin/sh", [script, String(deadPid()), newPath, target, work], { encoding: "utf8" });
  const log = () => fs.readFileSync(path.join(work, "install.log"), "utf8");
  return { dir, work, target, fresh, launched, run, log, appImage };
};

test("Linux: the AppImage is replaced, made executable and relaunched", async () => {
  const f = linuxFixture();
  const r = f.run(f.fresh);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(f.target, "utf8"), f.appImage("new"));
  assert.ok(fs.statSync(f.target).mode & 0o100, "AppImage is not executable");
  assert.strictEqual(fs.existsSync(path.join(f.work, "previous.AppImage")), false);
  assert.strictEqual(fs.existsSync(f.fresh), false);
  assert.ok(await waitFor(() => fs.existsSync(f.launched)), "not relaunched");
  assert.strictEqual(fs.readFileSync(f.launched, "utf8").trim(), "new");
  assert.match(f.log(), /done\n$/);
});

test("Linux: a failed copy keeps and relaunches the old AppImage", async () => {
  const f = linuxFixture();
  const r = f.run(path.join(f.work, "missing.AppImage"));
  assert.strictEqual(r.status, 1);
  assert.strictEqual(fs.readFileSync(f.target, "utf8"), f.appImage("old"));
  assert.match(f.log(), /copy failed, restoring/);
  assert.ok(await waitFor(() => fs.existsSync(f.launched)), "not relaunched");
  assert.strictEqual(fs.readFileSync(f.launched, "utf8").trim(), "old");
});

test("both shell scripts wait for the app's PID before touching anything", () => {
  for (const platform of ["darwin", "linux"]) {
    const script = buildScript(platform);
    assert.ok(script.indexOf('kill -0 "$PID"') < script.indexOf("BACKUP="), platform);
    assert.match(script, /app did not quit/);
    assert.match(script, /exec >>"\$WORK\/install\.log" 2>&1/);
    const r = spawnSync(platform === "darwin" ? "/bin/bash" : "/bin/sh", ["-n"], { input: script, encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
  }
});

test("Windows: waits for the PID, runs the installer silently into the install folder, relaunches", () => {
  const script = buildScript("win32", {
    pid: 4242,
    newFile: "C:\\Users\\me\\AppData\\Roaming\\RCP Network\\updates\\1.0.7\\RCP-Network-Setup-1.0.7.exe",
    installDir: "C:\\Program Files\\RCP Network",
    workDir: "C:\\Users\\me\\AppData\\Roaming\\RCP Network\\updates\\1.0.7",
  });
  const lines = script.split("\r\n");
  assert.ok(lines.includes('tasklist /FI "PID eq 4242" 2>nul | find "4242" >nul'));
  const install = lines.find((l) => l.includes("/S "));
  assert.strictEqual(
    install,
    '"C:\\Users\\me\\AppData\\Roaming\\RCP Network\\updates\\1.0.7\\RCP-Network-Setup-1.0.7.exe" /S /D=C:\\Program Files\\RCP Network',
  );
  assert.ok(lines.indexOf(install) > lines.indexOf(":install"));
  assert.ok(lines.includes('start "" "C:\\Program Files\\RCP Network\\RCP Network.exe"'));
  assert.ok(lines.includes('set LOG="C:\\Users\\me\\AppData\\Roaming\\RCP Network\\updates\\1.0.7\\install.log"'));
  assert.ok(lines.includes("echo done >> %LOG%"));
});

test("the install target per platform", () => {
  assert.strictEqual(
    installTarget("darwin", { execPath: "/Applications/RCP Network.app/Contents/MacOS/RCP Network" }),
    "/Applications/RCP Network.app",
  );
  assert.strictEqual(installTarget("darwin", { execPath: "/usr/local/bin/electron" }), null);
  assert.strictEqual(installTarget("linux", { env: { APPIMAGE: "/home/me/RCP.AppImage" } }), "/home/me/RCP.AppImage");
  assert.strictEqual(installTarget("linux", { env: {} }), null);
  assert.strictEqual(path.basename(installTarget("win32", { execPath: path.join("C:", "RCP Network", "RCP Network.exe") })), "RCP Network");
});

test("startInstall writes the script and starts it detached", () => {
  const work = tempDir();
  for (const [platform, shell] of [["darwin", "/bin/bash"], ["linux", "/bin/sh"], ["win32", "cmd.exe"]]) {
    const spawned = [];
    let unrefed = false;
    startInstall({
      platform,
      pid: 4242,
      newPath: "/new",
      target: "/target",
      workDir: work,
      spawnFn: (file, args, options) => {
        spawned.push({ file, args, options });
        return { unref: () => { unrefed = true; } };
      },
    });
    assert.strictEqual(spawned.length, 1);
    assert.strictEqual(spawned[0].file, shell);
    assert.strictEqual(spawned[0].options.detached, true);
    assert.strictEqual(spawned[0].options.stdio, "ignore");
    assert.ok(unrefed);
    if (platform === "win32") {
      assert.deepStrictEqual(spawned[0].args, ["/c", path.join(work, "install.cmd")]);
    } else {
      assert.deepStrictEqual(spawned[0].args, [path.join(work, "install.sh"), "4242", "/new", "/target", work]);
      assert.strictEqual(fs.readFileSync(path.join(work, "install.sh"), "utf8"), buildScript(platform));
    }
  }
});

const fakeGet = (chunks, length) => async () => {
  const stream = Readable.from(chunks.map((c) => Buffer.from(c)));
  stream.headers = { "content-length": String(length) };
  return stream;
};

test("the download reports whole percentages", async () => {
  const dest = path.join(tempDir(), "asset");
  const seen = [];
  await download("https://example.invalid/a", dest, (p) => seen.push(p), fakeGet(["aaaa", "bbbb", "cccc", "dddd"], 16));
  assert.deepStrictEqual(seen, [25, 50, 75, 100]);
  assert.strictEqual(fs.readFileSync(dest, "utf8"), "aaaabbbbccccdddd");
});

test("an incomplete download is removed", async () => {
  const dest = path.join(tempDir(), "asset");
  await assert.rejects(download("https://example.invalid/a", dest, () => {}, fakeGet(["aaaa"], 16)), /incomplete/);
  assert.strictEqual(fs.existsSync(dest), false);
});

test("the window gets the download percentage", async () => {
  const { updater, calls } = fakeUpdater();
  await updater.check();
  await updater.installAndRestart();
  const percents = calls.sent.filter((s) => s.state === "downloading").map((s) => s.percent);
  assert.deepStrictEqual(percents, [0, 50, 100]);
  assert.ok(calls.sent.some((s) => s.state === "installing"));
  assert.strictEqual(calls.install[0].pid, 4242);
});
