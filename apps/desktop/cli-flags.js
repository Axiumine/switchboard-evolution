// The flags the app answers in a terminal without opening a window: -h/--help
// and -v/--version. main.js asks this before anything else, so it touches no
// database, log or single-instance lock, and answers while the app is running
// too.
//
// Only whole arguments count. Any other argument starts the app, Chromium's and
// Electron's switches included (`--v=1` is Chromium's verbose logging).

const fs = require('fs');
const path = require('path');

const HELP_FLAGS = ['-h', '--help'];
const VERSION_FLAGS = ['-v', '--version'];

function helpText(program, name, version) {
  return `${name} ${version}

Usage: ${program} [options]

With no options, opens the app.

Options:
  -h, --help     Print this help and exit
  -v, --version  Print the version and exit
`;
}

/** The text `argv` asks for, or null when it asks for none. Help wins over version. */
function flagAnswer(argv, app) {
  const args = argv.slice(1);
  const asks = (flags) => args.some((arg) => flags.includes(arg));
  if (asks(HELP_FLAGS)) return helpText(path.basename(argv[0]), app.getName(), app.getVersion());
  if (asks(VERSION_FLAGS)) return `${app.getVersion()}\n`;
  return null;
}

/**
 * When `argv` holds one of the flags, write the answer to stdout and exit.
 * Synchronous, so it is out before the process ends, also when stdout is a pipe.
 */
function answerCliFlags(argv, app, write = (text) => fs.writeSync(1, text)) {
  const answer = flagAnswer(argv, app);
  if (answer === null) return false;
  write(answer);
  app.exit(0);
  return true;
}

module.exports = { flagAnswer, answerCliFlags };
