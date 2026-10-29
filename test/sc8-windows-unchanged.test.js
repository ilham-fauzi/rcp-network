// SC-8: Windows behaviour is unchanged in code. There is no Windows device to
// test on, so this compares the Windows branches of electron/main.js with the
// base commit and checks the app packaged for Windows (dist/win-unpacked,
// built by the verification command before this test runs).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BASE = "ec15f12";
const root = path.join(__dirname, "..");
const mainJs = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");

const baseMainJs = () => {
  const r = spawnSync("git", ["show", `${BASE}:electron/main.js`], { cwd: root, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
};

// Every `if (isWindows()) { ... }` block, found by matching braces while
// skipping strings, template literals and comments.
const windowsBlocks = (src) => {
  const blocks = [];
  const re = /if \(isWindows\(\)\) \{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    while (i < src.length && depth > 0) {
      const c = src[i];
      const next = src[i + 1];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === "/" && next === "/") {
        i = src.indexOf("\n", i);
        continue;
      } else if (c === "/" && next === "*") {
        i = src.indexOf("*/", i) + 1;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      }
      i++;
    }
    blocks.push({ start: m.index, text: src.slice(m.index, i) });
  }
  return blocks;
};

// The span of an `ipcMain.handle("<channel>", ...)` handler in `src`.
const handlerSpan = (src, channel) => {
  const start = src.indexOf(`ipcMain.handle("${channel}"`);
  if (start < 0) return null;
  const end = src.indexOf("\n});", start);
  return { start, end };
};

const REMOVED_HANDLERS = ["validate-sudo-password", "check-sudo-password"];

test("every Windows branch in main.js is byte-identical to the base commit", () => {
  const base = baseMainJs();
  const baseTexts = new Set(windowsBlocks(base).map((b) => b.text));
  const current = windowsBlocks(mainJs);
  assert.ok(current.length >= 4, `expected the Windows branches, found ${current.length}`);
  for (const block of current) {
    assert.ok(baseTexts.has(block.text), `Windows branch changed:\n${block.text.slice(0, 200)}`);
  }
});

test("the only Windows branches removed are in the removed sudo-password handlers", () => {
  const base = baseMainJs();
  const currentTexts = new Set(windowsBlocks(mainJs).map((b) => b.text));
  const removed = windowsBlocks(base).filter((b) => !currentTexts.has(b.text));
  const spans = REMOVED_HANDLERS.map((channel) => handlerSpan(base, channel));
  for (const block of removed) {
    assert.ok(
      spans.some((s) => s && block.start > s.start && block.start < s.end),
      `a Windows branch outside the sudo-password handlers was removed:\n${block.text.slice(0, 200)}`,
    );
  }
  for (const channel of REMOVED_HANDLERS) {
    assert.strictEqual(handlerSpan(mainJs, channel), null, `${channel} should be gone on every platform`);
  }
});

test("connect, disconnect and DNS flush keep their Windows branch", () => {
  for (const name of ["flushDns", "connectVpn", "disconnectVpn"]) {
    const start = mainJs.indexOf(`const ${name} = async`);
    assert.ok(start >= 0, `${name} not found`);
    const body = mainJs.slice(start, mainJs.indexOf("\n};", start));
    assert.match(body, /if \(isWindows\(\)\) \{/, `${name} has no Windows branch`);
  }
});

test("on Windows the helper setup is skipped and nothing privileged runs at startup", () => {
  const start = mainJs.indexOf("const ensurePrivilegedHelper = () => {");
  assert.ok(start >= 0, "ensurePrivilegedHelper not found");
  const firstLine = mainJs.slice(start).split("\n")[1].trim();
  assert.strictEqual(firstLine, "if (isWindows()) return Promise.resolve({ ok: true, setupRan: false });");

  const ready = mainJs.indexOf("app.whenReady()");
  const startup = mainJs.slice(ready, mainJs.indexOf("\n});", ready));
  // The VPN folder is created on every platform, before the window
  assert.ok(startup.indexOf("await createVpnDirectory()") < startup.indexOf("createWindow()"));
  // Keychain cleanup and helper setup sit behind `if (!isWindows())`
  for (const call of ["keytar.deletePassword", "ensurePrivilegedHelper()"]) {
    const at = startup.indexOf(call);
    assert.ok(at >= 0, `${call} not found in startup`);
    const guard = startup.lastIndexOf("if (!isWindows()) {", at);
    assert.ok(guard >= 0 && startup.slice(guard, at).split("{").length - startup.slice(guard, at).split("}").length >= 1,
      `${call} is not inside an if (!isWindows()) block`);
  }
});

test("the app packages for Windows with a Windows keytar binary", () => {
  const unpacked = path.join(root, "dist", "win-unpacked");
  assert.ok(fs.existsSync(path.join(unpacked, "RCP Network.exe")), "dist/win-unpacked/RCP Network.exe missing; run the SC-8 build first");
  const keytar = path.join(unpacked, "resources", "app.asar.unpacked", "node_modules", "keytar", "build", "Release", "keytar.node");
  const head = fs.readFileSync(keytar).subarray(0, 2).toString("latin1");
  assert.strictEqual(head, "MZ", "keytar.node is not a Windows (PE) binary");
});
