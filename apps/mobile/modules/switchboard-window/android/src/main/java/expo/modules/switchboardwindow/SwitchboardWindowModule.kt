package expo.modules.switchboardwindow

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Opens a tab in a window of its own (WindowActivity). */
class SwitchboardWindowModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SwitchboardWindow")

    Function("open") { window: String, title: String ->
      val context = appContext.currentActivity ?: appContext.reactContext ?: return@Function false
      val intent = Intent(context, WindowActivity::class.java).apply {
        putExtra(WindowActivity.EXTRA_WINDOW, window)
        putExtra(WindowActivity.EXTRA_TITLE, title)
        // A task of its own every time: in DeX and free windows a window of its own,
        // on a tablet the other half of a split screen.
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NEW_DOCUMENT or
            Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT,
        )
      }
      context.startActivity(intent)
      true
    }
  }
}
