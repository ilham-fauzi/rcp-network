// `node --test test/` resolves this folder as a module on Node 22+, so load
// every *.test.js file from here.
const fs = require("node:fs");
const path = require("node:path");

for (const file of fs.readdirSync(__dirname).sort()) {
  if (file.endsWith(".test.js")) {
    require(path.join(__dirname, file));
  }
}
