// The temporary auth file a connect writes for OpenVPN (.vpn_auth_<time>.tmp)
// holds the VPN login in plain text, so it is deleted as soon as the connect
// attempt ends, and leftovers from earlier runs are deleted at launch.
const fs = require("fs");
const path = require("path");

const AUTH_FILE_PATTERN = /^\.vpn_auth_\d+\.tmp$/;

// OpenVPN has read the file (on macOS and Linux the helper copied it even
// earlier) once it reports the connection as up.
const CONNECTED_LINE = "Initialization Sequence Completed";

const authFileDone = (output) => typeof output === "string" && output.includes(CONNECTED_LINE);

const removeAuthFile = (file) => {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // already gone
  }
};

// Deletes only this app's leftover auth files; returns their names
const removeLeftoverAuthFiles = (dir) => {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  const removed = names.filter((name) => AUTH_FILE_PATTERN.test(name));
  for (const name of removed) removeAuthFile(path.join(dir, name));
  return removed;
};

module.exports = { AUTH_FILE_PATTERN, authFileDone, removeAuthFile, removeLeftoverAuthFiles };
