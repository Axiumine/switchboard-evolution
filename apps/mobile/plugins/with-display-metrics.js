// Text that fits on any display, Samsung DeX and external monitors included.
//
// React Native turns sp and dp into pixels with DisplayMetricsHolder, which it
// fills from the device's default display: the phone's own screen. Fabric lays
// the views out at the density of the display the activity is on. When the two
// differ (Samsung DeX, an external monitor, a freeform window) text is measured
// for one density and drawn at the other, and every label is cut to a sliver.
// React Native fills the holder from the phone's screen again on every
// configuration change.
//
// So MainActivity fills it from its own display when it starts and after each
// configuration change, once React Native has. On a phone's own screen the
// metrics are the same, and nothing changes.
// https://github.com/react/react-native/issues/57183
const { withMainActivity } = require('expo/config-plugins');

const BEGIN = '// @generated begin switchboard-display-metrics';
const END = '// @generated end switchboard-display-metrics';
const IMPORTS = [
  'import android.content.res.Configuration',
  'import com.facebook.react.uimanager.DisplayMetricsHolder',
];

/** `lines` between the plugin's begin and end markers, at `indent`. */
function block(indent, lines) {
  return [BEGIN, ...lines, END].map((line) => (line ? indent + line : '')).join('\n');
}

/** MainActivity.kt with the metrics read from the activity's own display. */
function patchMainActivity(src) {
  if (src.includes(BEGIN)) return src;

  const superOnCreate = /^([ \t]*)super\.onCreate\(.*\)[ \t]*$/m.exec(src);
  if (!superOnCreate) {
    throw new Error('with-display-metrics: no super.onCreate(...) line in MainActivity.kt');
  }
  if (/\bfun\s+onConfigurationChanged\s*\(/.test(src)) {
    throw new Error('with-display-metrics: MainActivity.kt already overrides onConfigurationChanged');
  }

  const indent = superOnCreate[1];
  const afterSuper = superOnCreate.index + superOnCreate[0].length;
  let out =
    src.slice(0, afterSuper) +
    '\n' +
    block(indent, [
      '// Sizes in pixels for the display this activity is on (DeX, a monitor), not the phone\'s screen.',
      'DisplayMetricsHolder.initDisplayMetrics(this)',
    ]) +
    src.slice(afterSuper);

  // The class's last brace: the template's members are indented by two spaces.
  const classEnd = out.lastIndexOf('}');
  out =
    out.slice(0, classEnd).trimEnd() +
    '\n\n' +
    block('  ', [
      'override fun onConfigurationChanged(newConfig: Configuration) {',
      '  super.onConfigurationChanged(newConfig)',
      '  // React Native has just read the phone screen\'s metrics again: back to this display\'s.',
      '  DisplayMetricsHolder.initDisplayMetrics(this)',
      '}',
    ]) +
    '\n' +
    out.slice(classEnd);

  const missing = IMPORTS.filter((line) => !new RegExp(`^${line.replace(/\./g, '\\.')}\\s*$`, 'm').test(out));
  if (missing.length) {
    out = out.replace(/^package .*$/m, (pkg) => [pkg, ...missing].join('\n'));
  }
  return out;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withDisplayMetrics(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('with-display-metrics: MainActivity is not in Kotlin');
    }
    cfg.modResults.contents = patchMainActivity(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withDisplayMetrics;
module.exports.patchMainActivity = patchMainActivity;
