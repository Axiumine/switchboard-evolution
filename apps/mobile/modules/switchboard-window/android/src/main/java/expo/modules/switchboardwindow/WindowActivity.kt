package expo.modules.switchboardwindow

import android.app.ActivityManager
import android.content.res.Configuration
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.uimanager.DisplayMetricsHolder

/**
 * One tab in a window of its own, as the desktop's pop-out windows are: the
 * "window" root of the same app (src/windows/WindowRoot.tsx), on the same
 * React Native host and connection, so a window costs its views and nothing
 * more. What to show comes in EXTRA_WINDOW (JSON), the title in EXTRA_TITLE.
 */
class WindowActivity : ReactActivity() {
  companion object {
    const val EXTRA_WINDOW = "switchboard.window"
    const val EXTRA_TITLE = "switchboard.title"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // As MainActivity: sizes for the display this window is on (DeX, a monitor).
    DisplayMetricsHolder.initDisplayMetrics(this)
    super.onCreate(null)
    MultiWindow.created(this)
    intent.getStringExtra(EXTRA_TITLE)?.let { name ->
      title = name
      @Suppress("DEPRECATION")
      setTaskDescription(ActivityManager.TaskDescription(name))
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    DisplayMetricsHolder.initDisplayMetrics(this)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) MultiWindow.focused(this, reactHost)
  }

  override fun getMainComponentName(): String = "window"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle =
        Bundle().apply { putString("window", plainActivity.intent.getStringExtra(EXTRA_WINDOW) ?: "{}") }

      override fun onResume() {
        super.onResume()
        MultiWindow.resumed(plainActivity)
      }

      override fun onPause() {
        MultiWindow.pause(plainActivity, reactHost) { super.onPause() }
      }

      override fun onDestroy() {
        MultiWindow.destroy(plainActivity, reactHost, { reactDelegate?.unloadApp() }) { super.onDestroy() }
      }
    }
}
