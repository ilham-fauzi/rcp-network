#!/usr/bin/env node
// Ed25519 signing for in-app updates.
//   node scripts/update-key.js keygen        create the key pair (private key stays in ~/.config/rcp-network)
//   node scripts/update-key.js public        print the public key to embed in electron/updater/logic.js
//   node scripts/update-key.js sign <file>   write <file>.sig (base64 signature)
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const keyFile = () => path.join(os.homedir(), ".config", "rcp-network", "update-signing.key");

// PKCS#8 DER prefix for a raw 32-byte Ed25519 private key
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const privateKey = () => {
  let raw;
  try {
    raw = Buffer.from(fs.readFileSync(keyFile(), "utf8").trim(), "base64");
  } catch (e) {
    fail(`No signing key at ${keyFile()}. Run: node scripts/update-key.js keygen`);
  }
  if (raw.length !== 32) fail(`The signing key at ${keyFile()} is not a 32-byte Ed25519 key.`);
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
};

const publicKeyBase64 = (key) =>
  Buffer.from(crypto.createPublicKey(key).export({ format: "jwk" }).x, "base64url").toString("base64");

const [command, file] = process.argv.slice(2);

switch (command) {
  case "keygen": {
    if (fs.existsSync(keyFile())) fail(`Key already exists at ${keyFile()}; refusing to overwrite.`);
    const { privateKey: key } = crypto.generateKeyPairSync("ed25519");
    const raw = Buffer.from(key.export({ format: "jwk" }).d, "base64url");
    fs.mkdirSync(path.dirname(keyFile()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyFile(), raw.toString("base64"), { mode: 0o600 });
    console.log(`Private key: ${keyFile()}  (back this up; losing it means users must reinstall manually)`);
    console.log(`Public key:  ${publicKeyBase64(key)}`);
    break;
  }
  case "public":
    console.log(publicKeyBase64(privateKey()));
    break;
  case "sign": {
    if (!file || !fs.existsSync(file)) fail("usage: sign <file>");
    const signature = crypto.sign(null, fs.readFileSync(file), privateKey());
    fs.writeFileSync(`${file}.sig`, signature.toString("base64"));
    console.log(`wrote ${file}.sig`);
    break;
  }
  default:
    fail("usage: keygen | public | sign <file>");
}
