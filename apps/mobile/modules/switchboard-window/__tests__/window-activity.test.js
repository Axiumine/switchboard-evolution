/** @jest-environment node */
const fs = require('fs');
const path = require('path');

// React Native's root view (ReactRootView.init, every ReactSurfaceView) sets
// DisplayMetricsHolder from the application context, the phone's own screen,
// when it is made. A window's root view is made in super.onCreate, so the
// window reads its own display's metrics after that, never before: before,
// its text was measured for the phone's density on a DeX monitor and cut to
// slivers (in the window and, sharing the holder, in the main window too).

const source = fs.readFileSync(
  path.join(__dirname, '../android/src/main/java/expo/modules/switchboardwindow/WindowActivity.kt'),
  'utf8',
);

/** The body of `fun name(...)`, up to the next `override fun`. */
function body(name) {
  const at = source.indexOf(`override fun ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const next = source.indexOf('override fun ', at + 1);
  return source.slice(at, next < 0 ? undefined : next);
}

describe('WindowActivity', () => {
  it('reads its display metrics after super.onCreate, once its root view is made', () => {
    const onCreate = body('onCreate');
    const superAt = onCreate.indexOf('super.onCreate(');
    const metricsAt = onCreate.indexOf('DisplayMetricsHolder.initDisplayMetrics(this)');
    expect(superAt).toBeGreaterThan(-1);
    expect(metricsAt).toBeGreaterThan(superAt);
  });

  it('reads them again after a configuration change, once React Native has', () => {
    const changed = body('onConfigurationChanged');
    expect(changed.indexOf('DisplayMetricsHolder.initDisplayMetrics(this)')).toBeGreaterThan(changed.indexOf('super.onConfigurationChanged('));
  });
});
