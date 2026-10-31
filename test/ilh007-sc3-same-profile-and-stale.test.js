// ilh-007 SC-3: reconnecting a profile replaces its own old OpenVPN, and
// leftovers of runs that ended on their own are still cleaned up on connect.
const test = require("node:test");
const assert = require("node:assert");
const p = require("./profiles-fixture");

test.after(p.cleanup);

test("connecting the same profile again replaces its old OpenVPN", { skip: p.skip }, () => {
  const t = p.setup();
  const a = t.config("a.ovpn");
  const old = p.seedRunning(t, a);

  const r = p.runHelper(t, "connect", a, t.auth);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(p.waitGone(old.pid), "the old OpenVPN for A is still running");
  assert.deepStrictEqual(p.entryFiles(t, old.id), ["conf", "auth"]);
});

test("connect removes a stale entry and keeps a running one", { skip: p.skip }, () => {
  const t = p.setup();
  const a = p.seedRunning(t, t.config("a.ovpn"));
  const c = p.seedStale(t, t.config("c.ovpn"));

  const r = p.runHelper(t, "connect", t.config("b.ovpn"), t.auth);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(p.entryFiles(t, c.id), []);
  assert.ok(p.isAlive(a.pid), "A's OpenVPN was stopped");
  assert.deepStrictEqual(p.entryFiles(t, a.id), ["pid", "conf", "auth"]);
});
