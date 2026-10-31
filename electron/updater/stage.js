// Download a release asset, check its signature and (macOS) the app inside.
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");
const { verifySignature, PUBLIC_KEY } = require("./logic");

const APP_ID = "com.rcpnetwork.app";
const BAD_SIGNATURE = "The download failed its signature check and was discarded.";

const defaultRun = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

// GET `url`, following redirects (GitHub assets redirect to a CDN)
const defaultGet = (url, redirects = 5) =>
  new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "rcp-network-updater" } }, (response) => {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        if (redirects <= 0) return reject(new Error("Too many redirects"));
        return resolve(defaultGet(new URL(headers.location, url).toString(), redirects - 1));
      }
      if (statusCode !== 200) {
        response.resume();
        return reject(new Error(`The update server answered with HTTP ${statusCode}.`));
      }
      resolve(response);
    });
    request.setTimeout(60000, () => request.destroy(new Error("The download timed out.")));
    request.on("error", reject);
  });

const fetchText = async (url, get = defaultGet) => {
  const response = await get(url);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

// Stream `url` to `dest`, reporting whole percentages
const download = async (url, dest, onProgress = () => {}, get = defaultGet) => {
  const response = await get(url);
  const total = Number(response.headers && response.headers["content-length"]) || 0;
  let received = 0;
  let last = -1;
  const out = fs.createWriteStream(dest);
  try {
    for await (const chunk of response) {
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      if (total > 0) {
        const percent = Math.min(100, Math.floor((received / total) * 100));
        if (percent !== last) {
          last = percent;
          onProgress(percent);
        }
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total > 0 && received !== total) {
    fs.rmSync(dest, { force: true });
    throw new Error("The download was incomplete.");
  }
  return dest;
};

const plistValue = async (run, plist, key) => {
  const { stdout } = await run("plutil", ["-extract", key, "raw", "-o", "-", plist]);
  return String(stdout).trim();
};

// Checks the downloaded file and returns the path to install from.
// Any failure removes what was downloaded and throws with the reason.
const stage = async ({ file, sigText, platform, version, workDir, run = defaultRun, publicKey = PUBLIC_KEY }) => {
  const discard = () => {
    fs.rmSync(file, { force: true });
    fs.rmSync(path.join(workDir, "new"), { recursive: true, force: true });
  };

  if (!verifySignature(fs.readFileSync(file), sigText, publicKey)) {
    discard();
    throw new Error(BAD_SIGNATURE);
  }

  if (platform !== "darwin") return file;

  const unpackDir = path.join(workDir, "new");
  fs.rmSync(unpackDir, { recursive: true, force: true });
  fs.mkdirSync(unpackDir, { recursive: true });
  try {
    await run("ditto", ["-x", "-k", file, unpackDir]);
    const apps = fs.readdirSync(unpackDir).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error(`expected one .app, found ${apps.length}`);
    const appPath = path.join(unpackDir, apps[0]);
    const plist = path.join(appPath, "Contents", "Info.plist");
    const id = await plistValue(run, plist, "CFBundleIdentifier");
    if (id !== APP_ID) throw new Error(`bundle ID is ${id || "missing"}, not ${APP_ID}`);
    const appVersion = await plistValue(run, plist, "CFBundleShortVersionString");
    if (appVersion !== version) throw new Error(`version is ${appVersion || "missing"}, not ${version}`);
    fs.rmSync(file, { force: true });
    return appPath;
  } catch (error) {
    discard();
    throw new Error(`The downloaded app is not valid: ${error.message}`);
  }
};

module.exports = { APP_ID, BAD_SIGNATURE, defaultRun, defaultGet, fetchText, download, stage };
