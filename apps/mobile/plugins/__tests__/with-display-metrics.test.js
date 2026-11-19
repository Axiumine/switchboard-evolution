/** @jest-environment node */
const { patchMainActivity } = require('../with-display-metrics');

// The MainActivity.kt that `expo prebuild` makes (SDK 58), with the splash screen plugin's lines.
const TEMPLATE = `package com.example.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }
}
`;

/** The lines of a Kotlin source, trimmed, without the blank ones. */
const lines = (src) => src.split('\n').map((l) => l.trim()).filter(Boolean);

describe('the display metrics plugin', () => {
  it('reads the metrics of the activity’s display right after super.onCreate', () => {
    const out = lines(patchMainActivity(TEMPLATE));
    const superAt = out.indexOf('super.onCreate(null)');
    expect(superAt).toBeGreaterThan(-1);
    expect(out.slice(superAt + 1)).toContain('DisplayMetricsHolder.initDisplayMetrics(this)');
    // Still inside onCreate: no closing brace between super.onCreate and the call.
    const callAt = out.indexOf('DisplayMetricsHolder.initDisplayMetrics(this)', superAt);
    expect(out.slice(superAt + 1, callAt).filter((l) => l === '}')).toEqual([]);
  });

  it('reads them again after each configuration change, once React Native has', () => {
    const out = lines(patchMainActivity(TEMPLATE));
    const at = out.indexOf('override fun onConfigurationChanged(newConfig: Configuration) {');
    expect(at).toBeGreaterThan(-1);
    const body = out.slice(at + 1, out.indexOf('}', at));
    expect(body.filter((l) => !l.startsWith('//'))).toEqual([
      'super.onConfigurationChanged(newConfig)',
      'DisplayMetricsHolder.initDisplayMetrics(this)',
    ]);
  });

  it('adds the imports it needs after the package line', () => {
    const out = lines(patchMainActivity(TEMPLATE));
    expect(out[0]).toBe('package com.example.app');
    expect(out).toContain('import android.content.res.Configuration');
    expect(out).toContain('import com.facebook.react.uimanager.DisplayMetricsHolder');
  });

  it('keeps the class closed and the rest as it was', () => {
    const out = patchMainActivity(TEMPLATE);
    expect(out.trimEnd().endsWith('}')).toBe(true);
    for (const line of lines(TEMPLATE)) expect(lines(out)).toContain(line);
  });

  it('changes nothing the second time (prebuild runs again over its own output)', () => {
    const once = patchMainActivity(TEMPLATE);
    expect(patchMainActivity(once)).toBe(once);
  });

  it('does not add an import that is already there', () => {
    const withImport = TEMPLATE.replace(
      'import android.os.Bundle',
      'import android.os.Bundle\nimport android.content.res.Configuration',
    );
    const out = lines(patchMainActivity(withImport));
    expect(out.filter((l) => l === 'import android.content.res.Configuration')).toHaveLength(1);
  });

  it('fails loudly on a MainActivity it does not know how to change', () => {
    expect(() => patchMainActivity(TEMPLATE.replace('super.onCreate(null)', ''))).toThrow(/super\.onCreate/);
    const withOwn = TEMPLATE.replace(
      'override fun getMainComponentName',
      'override fun onConfigurationChanged(newConfig: Configuration) {}\n  override fun getMainComponentName',
    );
    expect(() => patchMainActivity(withOwn)).toThrow(/onConfigurationChanged/);
  });
});
