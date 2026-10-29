// Pure pieces of the updater (no I/O), so they can be tested.
const crypto = require("crypto");

const FEED_URL = "https://api.github.com/repos/ilham-fauzi/rcp-network/releases/latest";
const DOWNLOAD_PAGE = "https://github.com/ilham-fauzi/rcp-network/releases/latest";

// Ed25519 public key (raw 32 bytes, base64) matching the private key that
// scripts/release.sh signs releases with. Print it with
// `node scripts/update-key.js public`. scripts/release.sh refuses to run
// while this placeholder is here.
const PUBLIC_KEY = "3K476VHSa/hDelgiGwoPJqSWyoHNm3HU/Dd6fgzlvTg=";

const NO_INSTALLABLE_DOWNLOAD = "no installable download";

// SPKI DER prefix for a raw Ed25519 public key
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const publicKeyObject = (key = PUBLIC_KEY) => {
  const raw = Buffer.from(key, "base64");
  if (raw.length !== 32) throw new Error("Update public key is not a 32-byte Ed25519 key");
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
};

// "v1.2.3", "1.2" or "1.2.3-beta" -> [1, 2, 3]. Non-numeric parts count as 0.
const components = (version) => {
  let text = String(version || "").trim();
  if (text.startsWith("v") || text.startsWith("V")) text = text.slice(1);
  const dash = text.indexOf("-");
  if (dash >= 0) text = text.slice(0, dash);
  return text.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
};

const isNewer = (remote, local) => {
  const a = components(remote);
  const b = components(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
};

// The release asset this platform and arch installs from
const assetNameFor = ({ platform, arch, version }) => {
  if (platform === "darwin") {
    if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported macOS arch: ${arch}`);
    return `RCP-Network-${version}-${arch}.zip`;
  }
  if (platform === "win32") return `RCP-Network-Setup-${version}.exe`;
  if (platform === "linux") return `RCP-Network-${version}.AppImage`;
  throw new Error(`Unsupported platform: ${platform}`);
};

// Reads GitHub's "latest release" JSON
const parseRelease = (json, { platform, arch, currentVersion }) => {
  const release = typeof json === "string" ? JSON.parse(json) : json;
  if (!release || release.draft || release.prerelease || !release.tag_name) {
    return { status: "up-to-date" };
  }
  if (!isNewer(release.tag_name, currentVersion)) return { status: "up-to-date" };

  const version = components(release.tag_name).join(".");
  const base = {
    status: "available",
    version,
    notes: release.body || "",
    pageUrl: release.html_url || DOWNLOAD_PAGE,
  };

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const name = assetNameFor({ platform, arch, version });
  const asset = assets.find((a) => a.name === name);
  const sig = assets.find((a) => a.name === `${name}.sig`);
  if (!asset || !sig) return { ...base, asset: null, reason: NO_INSTALLABLE_DOWNLOAD };

  return {
    ...base,
    asset: { name, url: asset.browser_download_url, sigUrl: sig.browser_download_url, size: asset.size || 0 },
  };
};

// `sigText` is the base64 text of the .sig file
const verifySignature = (data, sigText, key = PUBLIC_KEY) => {
  try {
    const signature = Buffer.from(String(sigText).trim(), "base64");
    if (signature.length !== 64) return false;
    return crypto.verify(null, data, publicKeyObject(key), signature);
  } catch (e) {
    return false;
  }
};

module.exports = {
  FEED_URL,
  DOWNLOAD_PAGE,
  PUBLIC_KEY,
  NO_INSTALLABLE_DOWNLOAD,
  publicKeyObject,
  components,
  isNewer,
  assetNameFor,
  parseRelease,
  verifySignature,
};
