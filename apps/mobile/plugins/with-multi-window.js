// The main window among the app's windows (modules/switchboard-window).
//
// A tab opened in a window of its own is another activity on the same React
// Native host. MainActivity's delegate goes through MultiWindow like the
// windows' do, so the host is handed to the window in front instead of being
// paused or destroyed under it, and the window with the focus is the one
// dialogs and pickers open in.
const { withMainActivity } = require('expo/config-plugins');

const BEGIN = '// @generated begin switchboard-multi-window';
const END = '// @generated end switchboard-multi-window';
const IMPORT = 'import expo.modules.switchboardwindow.MultiWindow';

function block(indent, lines) {
  return [BEGIN, ...lines, END].map((line) => (line ? indent + line : '')).join('\n');
}

/** MainActivity.kt with its delegate and focus going through MultiWindow. */
function patchMainActivity(src) {
  if (src.includes(BEGIN)) return src;

  const superOnCreate = /^([ \t]*)super\.onCreate\(.*\)[ \t]*$/m.exec(src);
  if (!superOnCreate) throw new Error('with-multi-window: no super.onCreate(...) line in MainActivity.kt');
  const delegate = /(object : DefaultReactActivityDelegate\([\s\S]*?\))\{\}\)/.exec(src);
  if (!delegate) throw new Error('with-multi-window: no `object : DefaultReactActivityDelegate(...){})` in MainActivity.kt');
  if (/\bfun\s+onWindowFocusChanged\s*\(/.test(src)) {
    throw new Error('with-multi-window: MainActivity.kt already overrides onWindowFocusChanged');
  }

  let out = src.slice(0, delegate.index) + delegate[1] + ' {\n' + block('            ', [
    'override fun onResume() {',
    '  super.onResume()',
    '  MultiWindow.resumed(plainActivity)',
    '}',
    '',
    'override fun onPause() {',
    '  MultiWindow.pause(plainActivity, reactHost) { super.onPause() }',
    '}',
    '',
    'override fun onDestroy() {',
    '  MultiWindow.destroy(plainActivity, reactHost, { reactDelegate?.unloadApp() }) { super.onDestroy() }',
    '}',
  ]) + '\n          })' + src.slice(delegate.index + delegate[0].length);

  const onCreate = /^([ \t]*)super\.onCreate\(.*\)[ \t]*$/m.exec(out);
  const afterSuper = onCreate.index + onCreate[0].length;
  out = out.slice(0, afterSuper) + '\n' + block(onCreate[1], ['MultiWindow.created(this)']) + out.slice(afterSuper);

  const classEnd = out.lastIndexOf('}');
  out = out.slice(0, classEnd).trimEnd() + '\n\n' + block('  ', [
    '// The window with the focus is the one dialogs and pickers open in.',
    'override fun onWindowFocusChanged(hasFocus: Boolean) {',
    '  super.onWindowFocusChanged(hasFocus)',
    '  if (hasFocus) MultiWindow.focused(this, reactHost)',
    '}',
  ]) + '\n' + out.slice(classEnd);

  if (!out.includes(IMPORT)) out = out.replace(/^package .*$/m, (pkg) => `${pkg}\n${IMPORT}`);
  return out;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withMultiWindow(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('with-multi-window: MainActivity is not in Kotlin');
    cfg.modResults.contents = patchMainActivity(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withMultiWindow;
module.exports.patchMainActivity = patchMainActivity;
