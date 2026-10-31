// ilh-007 SC-2: disconnect stops only its own profile; disconnect-all stops
// every profile.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const p = require("./profiles-fixture");

test.after(p.cleanup);

test("disconnect A stops only A, disconnect-all stops the rest", { skip: p.skip }, () => {
  const t = p.setup();
  const a = p.seedRunning(t, t.config("a.ovpn"));
  const bPath = t.config("b.ovpn");
  const b = p.seedRunning(t, bPath);

  let r = p.runHelper(t, "disconnect", `${t.dir}/a.ovpn`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(p.waitGone(a.pid), "A's OpenVPN is still running");
  assert.deepStrictEqual(p.entryFiles(t, a.id), []);
  assert.ok(p.isAlive(b.pid), "B's OpenVPN was stopped by disconnecting A");
  assert.deepStrictEqual(p.entryFiles(t, b.id), ["pid", "conf", "auth"]);

  r = p.runHelper(t, "disconnect-all");
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(p.waitGone(b.pid), "B's OpenVPN is still running");
  assert.deepStrictEqual(fs.readdirSync(t.pidDir), []);
});
