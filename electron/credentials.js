// Per-profile VPN credentials, saved only when the person ticks "Save Email"
// or "Save Password". They live in <dir>/credentials.json (mode 0600, folder
// 0700), not in the macOS keychain: the app is signed ad hoc, so every
// keychain read raised a login-password prompt on each profile switch.
//
// File shape: { "<file>.ovpn": { "email": "...", "password": "..." } }
const fs = require("fs");
const path = require("path");

const FIELDS = ["email", "password"];

const createCredentialStore = (dir, { log = () => { } } = {}) => {
  const file = path.join(dir, "credentials.json");

  // A missing, empty or malformed file means nothing is saved
  const readAll = () => {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      return {};
    }
    try {
      const data = JSON.parse(text);
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (e) {
      log("WARN", "credentials.json is not valid JSON; treating it as empty");
      return {};
    }
  };

  // Write a temp file next to it and rename, so a crash never leaves half a file
  const writeAll = (data) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  };

  const apply = (data, filename, creds) => {
    const entry = { ...(data[filename] || {}) };
    for (const field of FIELDS) {
      const value = creds[field];
      if (value !== undefined && value !== null) entry[field] = value;
    }
    if (Object.keys(entry).length > 0) data[filename] = entry;
  };

  const load = (filename) => {
    const entry = readAll()[filename] || {};
    return { email: entry.email || null, password: entry.password || null };
  };

  const save = (filename, creds) => {
    const data = readAll();
    const before = JSON.stringify(data[filename] || {});
    apply(data, filename, creds);
    if (JSON.stringify(data[filename] || {}) === before) return false;
    writeAll(data);
    return true;
  };

  // Removes the given fields (both by default); drops an empty profile entry
  const remove = (filename, fields = FIELDS) => {
    const data = readAll();
    if (!data[filename]) return false;
    for (const field of fields) delete data[filename][field];
    if (Object.keys(data[filename]).length === 0) delete data[filename];
    writeAll(data);
    return true;
  };

  // "Apply to all configs": every .ovpn in dir, in one write
  const saveToAll = (creds) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ovpn"));
    const data = readAll();
    for (const f of files) apply(data, f, creds);
    writeAll(data);
    return files.length;
  };

  return { file, load, save, remove, saveToAll };
};

module.exports = { createCredentialStore };
