/** @jest-environment node */
const { patchMainActivity } = require('../with-multi-window');

// The parts of the MainActivity.kt that `expo prebuild` makes (SDK 58) that the plugin changes.
const TEMPLATE = `package com.example.app
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }
}
`;

const lines = (src) => src.split('\n').map((l) => l.trim()).filter(Boolean);

describe('the multi-window plugin', () => {
  it('lets the delegate share the host with the other windows', () => {
    const out = lines(patchMainActivity(TEMPLATE));
    expect(out).toContain('MultiWindow.pause(plainActivity, reactHost) { super.onPause() }');
    expect(out).toContain('MultiWindow.destroy(plainActivity, reactHost, { reactDelegate?.unloadApp() }) { super.onDestroy() }');
    expect(out).toContain('MultiWindow.resumed(plainActivity)');
    // Still the wrapper's argument, closed as before.
    expect(out.filter((l) => l === '})')).toHaveLength(1);
  });

  it('counts the main window among the open ones and gives it the host when it takes the focus', () => {
    const out = lines(patchMainActivity(TEMPLATE));
    const superAt = out.indexOf('super.onCreate(null)');
    expect(out.slice(superAt + 1).find((l) => !l.startsWith('//'))).toBe('MultiWindow.created(this)');
    expect(out).toContain('override fun onWindowFocusChanged(hasFocus: Boolean) {');
    expect(out).toContain('if (hasFocus) MultiWindow.focused(this, reactHost)');
    expect(out).toContain('import expo.modules.switchboardwindow.MultiWindow');
  });

  it('changes nothing the second time', () => {
    const once = patchMainActivity(TEMPLATE);
    expect(patchMainActivity(once)).toBe(once);
  });

  it('fails loudly on a MainActivity it does not know', () => {
    expect(() => patchMainActivity(TEMPLATE.replace('){})', ') {})'))).toThrow(/DefaultReactActivityDelegate/);
    expect(() => patchMainActivity(TEMPLATE.replace('super.onCreate(null)', ''))).toThrow(/super\.onCreate/);
  });
});
