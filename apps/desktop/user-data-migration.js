// user-data-migration.js — on the first start of Switchboard Evolution, the
// Application Support folder of the app it was called before (OmniboardV) is
// copied into its own: the window's preferences, sizes and layout, the tools
// it unpacked. The data of the sessions and projects is in ~/.switchboard and
// is shared, so it is not part of this.
const fs = require('fs');
const path = require('path');

// What Electron and Chromium make on their own at a start, and what is not
// worth copying: caches, crash reports and the single-instance lock.
const LEFT_BEHIND = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Cache', 'Code Cache', 'GPUCache',
  'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'ShaderCache', 'GrShaderCache', '.DS_Store']);

/**
 * True when `dir` has never been used by the app: missing, or holding only
 * what Electron makes by itself. Electron creates the folder, empty, before
 * main.js runs, so "it does not exist yet" is never the case at a first start.
 */
function isUnusedUserData(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return err.code === 'ENOENT';
  }
  return names.every(name => LEFT_BEHIND.has(name));
}

/**
 * Copies the first of `sources` that exists into `target` when `target` has
 * never been used, leaving caches and locks behind. Returns the folder it
 * copied, or null when there was nothing to do or the copy failed.
 */
function copyOldUserData(target, sources, log = console) {
  if (!isUnusedUserData(target)) return null;
  for (const source of sources) {
    if (path.resolve(source) === path.resolve(target) || !fs.existsSync(source)) continue;
    try {
      fs.cpSync(source, target, {
        recursive: true,
        verbatimSymlinks: true,
        filter: from => from === source || !LEFT_BEHIND.has(path.basename(from)),
      });
      log.info(`[startup] copied the settings of ${path.basename(source)} into ${target}`);
      return source;
    } catch (err) {
      log.warn(`[startup] could not copy the settings of ${path.basename(source)}: ${err.message}`);
      return null;
    }
  }
  return null;
}

module.exports = { copyOldUserData, isUnusedUserData };
