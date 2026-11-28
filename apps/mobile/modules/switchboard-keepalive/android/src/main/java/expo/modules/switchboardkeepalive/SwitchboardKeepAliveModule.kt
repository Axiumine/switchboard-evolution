package expo.modules.switchboardkeepalive

import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SwitchboardKeepAliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SwitchboardKeepAlive")

    Function("start") { text: String -> start(text) }

    Function("update") { text: String ->
      appContext.reactContext?.let { KeepAliveService.update(it, text) }
      Unit
    }

    Function("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, KeepAliveService::class.java)) }
      Unit
    }
  }

  /** False when Android refuses, as it does to an app that is in the background. */
  private fun start(text: String): Boolean {
    val context = appContext.reactContext ?: return false
    val intent = Intent(context, KeepAliveService::class.java).putExtra(KeepAliveService.EXTRA_TEXT, text)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      true
    } catch (e: Exception) {
      Log.w("SwitchboardKeepAlive", "Could not start", e)
      false
    }
  }
}
