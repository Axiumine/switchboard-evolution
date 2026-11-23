// after-pack.js — electron-builder's afterPack hook (package.json
// build.afterPack). Every packed app gets the programs it carries in
// resources/bin: herdr-core (after-pack-herdr.js), which keeps the sessions
// running when the app quits, and the GitHub CLI (after-pack-gh.js), which the
// Pull Requests view uses when the computer has no gh of its own.

const herdr = require('./after-pack-herdr');
const gh = require('./after-pack-gh');

async function afterPack(context) {
  await herdr.afterPack(context);
  await gh.afterPack(context);
}

module.exports = afterPack;
module.exports.default = afterPack;
