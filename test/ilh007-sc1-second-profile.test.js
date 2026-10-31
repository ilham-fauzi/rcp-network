// ilh-007 SC-1: connecting profile B leaves profile A's OpenVPN running, and
// each profile keeps its own entry in the helper's PID folder.
const test = require("node:test");
const assert = require("node:assert");
const p = require("./profiles-fixture");

test.after(p.cleanup);

test("connecting a second profile keeps the first running", { skip: p.skip }, () => {
  const t = p.setup();
  const a = t.config("a.ovpn");
  const b = t.config("b.ovpn");
  const running = p.seedRunning(t, a);

  const r = p.runHelper(t, "connect", b, t.auth);
  assert.strictEqual(r.status, 0, r.stderr);

  assert.ok(!p.waitGone(running.pid, 300), "A's OpenVPN was stopped by connecting B");
  assert.deepStrictEqual(p.entryFiles(t, running.id), ["pid", "conf", "auth"]);
  const bId = p.entryId(b);
  assert.notStrictEqual(bId, running.id);
  assert.deepStrictEqual(p.entryFiles(t, bId), ["conf", "auth"]);
});
