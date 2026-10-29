// SC-5: the sudoers rule and the root install script.
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const {
  buildSudoersRule,
  buildInstallScript,
  helperInstallPath,
} = require("../electron/privileged");

const ruleLines = (rule) =>
  rule.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: helper path is absolute and root-owned location`, () => {
    const p = helperInstallPath(platform);
    assert.ok(p.startsWith("/"));
    assert.ok(!p.startsWith("/usr/local/bin"), "must not live in a possibly user-owned folder");
    assert.ok(!p.includes(" "));
  });

  test(`${platform}: rule is exactly one line naming only the user and helper`, () => {
    const helperPath = helperInstallPath(platform);
    const lines = ruleLines(buildSudoersRule("alice", helperPath));
    assert.deepStrictEqual(lines, [`alice ALL=(root) NOPASSWD: ${helperPath}`]);
  });
}

test("bad user names throw", () => {
  const helperPath = helperInstallPath("darwin");
  for (const user of ["", "Root", "1alice", "a b", "alice,bob", "alice;rm", "ALL", "%admin", "alice ALL=(ALL) ALL", "al\nice", undefined, null]) {
    assert.throws(() => buildSudoersRule(user, helperPath), `accepted ${JSON.stringify(user)}`);
  }
});

test("helper paths with spaces or relative paths throw", () => {
  assert.throws(() => buildSudoersRule("alice", "relative/helper"));
  assert.throws(() => buildSudoersRule("alice", "/path with space/helper"));
  assert.throws(() => buildSudoersRule("alice", "/x/helper, /bin/sh"));
});

const scriptFor = (platform) =>
  buildInstallScript({
    platform,
    user: "alice",
    sourceHelper: "/Applications/RCP Network.app/Contents/Resources/helper/rcp-network-helper",
    helperPath: helperInstallPath(platform),
  });

for (const [platform, group] of [["darwin", "wheel"], ["linux", "root"]]) {
  test(`${platform}: install script checks, owns and moves in the right order`, () => {
    const script = scriptFor(platform);

    assert.match(script, /^set -e$/m);
    assert.match(script, /visudo -c -f "\$RULE_NEW"/);
    assert.match(script, /chmod 0440 "\$RULE_NEW"/);
    assert.match(script, new RegExp(`chown root:${group} "\\$RULE_NEW"`));
    assert.match(script, new RegExp(`chown root:${group} "\\$HELPER_NEW"`));
    assert.match(script, new RegExp(`chown root:${group} "\\$HELPER_DIR"`));
    assert.match(script, /chmod 755 "\$HELPER_NEW"/);
    assert.match(script, /chmod 755 "\$HELPER_DIR"/);
    if (group === "root") assert.doesNotMatch(script, /wheel/);

    // parent-folder owner check
    assert.match(script, /is not owned by root/);
    assert.match(script, /writable by group or others/);
    assert.match(script, /check_chain "\$d"/);

    const parentCheck = script.indexOf('check_chain "$d"');
    const copy = script.indexOf('cp "$HELPER_SRC" "$HELPER_NEW"');
    const visudo = script.indexOf('visudo -c -f "$RULE_NEW"');
    const chmodRule = script.indexOf('chmod 0440 "$RULE_NEW"');
    const mvHelper = script.indexOf('mv -f "$HELPER_NEW" "$HELPER_DST"');
    const mvRule = script.indexOf('mv -f "$RULE_NEW" "$RULE_DST"');
    for (const [name, at] of Object.entries({ parentCheck, copy, visudo, chmodRule, mvHelper, mvRule })) {
      assert.ok(at > 0, `${name} missing`);
    }
    assert.ok(parentCheck < copy, "parent folders are checked before copying");
    assert.ok(copy < visudo);
    assert.ok(visudo < chmodRule);
    assert.ok(visudo < mvRule, "rule is moved into /etc/sudoers.d only after visudo -c");
    assert.ok(visudo < mvHelper, "helper is moved into place only after visudo -c");
    assert.ok(chmodRule < mvRule);
    assert.match(script, /RULE_DST='\/etc\/sudoers\.d\/rcp-network'/);
    // the staged rule is in sudoers.d under a name sudo ignores
    assert.match(script, /RULE_NEW=\/etc\/sudoers\.d\/\.rcp-network\.new/);

    // the rule text in the script is the single rule line
    assert.ok(script.includes(`alice ALL=(root) NOPASSWD: ${helperInstallPath(platform)}\nRCP_NETWORK_RULE`));
    // source path with spaces is quoted
    assert.match(script, /HELPER_SRC='\/Applications\/RCP Network\.app\/[^']+'/);
  });

  test(`${platform}: install script is valid sh`, () => {
    const r = spawnSync("/bin/sh", ["-n"], { input: scriptFor(platform), encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
  });
}

test("install script rejects a bad user", () => {
  assert.throws(() =>
    buildInstallScript({ platform: "darwin", user: "x'; rm -rf /", sourceHelper: "/x", helperPath: helperInstallPath("darwin") }),
  );
});
