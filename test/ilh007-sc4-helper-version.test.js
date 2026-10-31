// ilh-007 SC-4: the fixed helper is version 3, the version the app expects,
// so an installed version-2 helper counts as outdated and is replaced.
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const privileged = require("../electron/privileged");
const { HELPER } = require("./openvpn-fixture");

test("helper --version prints 3", () => {
  const r = spawnSync("/bin/sh", [HELPER, "--version"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), "3");
});

test("the app expects version 3", () => {
  assert.strictEqual(privileged.HELPER_VERSION, 3);
});
