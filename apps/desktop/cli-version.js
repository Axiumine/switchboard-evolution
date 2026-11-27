// `switchboard-e --v` prints the app's version and exits without opening a
// window. main.js asks this before anything else, so it touches no database, log
// or single-instance lock, and answers while the app is running too.
//
// Only the bare flag counts: `--v=1` stays Chromium's verbose-logging switch.

const fs = require('fs');

const VERSION_FLAG = '--v';

function wantsVersion(argv) {
  return argv.slice(1).includes(VERSION_FLAG);
}

/**
 * When `argv` asks for the version, write it to stdout and exit. Synchronous, so
 * the line is out before the process ends, also when stdout is a pipe.
 */
function printVersionAndExit(argv, app, write = (text) => fs.writeSync(1, text)) {
  if (!wantsVersion(argv)) return false;
  write(`${app.getVersion()}\n`);
  app.exit(0);
  return true;
}

module.exports = { wantsVersion, printVersionAndExit };
