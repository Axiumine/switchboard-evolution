package expo.modules.switchboardkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps the app running in the background, and with it the connection to the
 * computer: a foreground service with the notification Android asks of one,
 * and a headless JavaScript task, without which React Native stops its timers
 * (the connection's retries). The task ends when JavaScript says so.
 */
class KeepAliveService : HeadlessJsTaskService() {
  private var taskStarted = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val notification = notification(this, intent?.getStringExtra(EXTRA_TEXT) ?: "")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not stay in the foreground", e)
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    if (!taskStarted) {
      taskStarted = true
      // No time limit, and allowed while the app is on screen: it starts from there.
      startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true))
    }
    // An app that Android stops does not come back by itself: opening it starts this again.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  companion object {
    private const val TAG = "SwitchboardKeepAlive"
    private const val TASK = "SwitchboardKeepAlive"
    private const val CHANNEL = "connection"
    private const val NOTIFICATION_ID = 4711
    const val EXTRA_TEXT = "text"

    @Volatile
    private var running = false

    /** New words on the notification of the running service. */
    fun update(context: Context, text: String) {
      if (!running) return
      manager(context).notify(NOTIFICATION_ID, notification(context, text))
    }

    private fun manager(context: Context) =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @Suppress("DEPRECATION")
    private fun notification(context: Context, text: String): Notification {
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        // Silent: it only says that the connection is held.
        val channel = NotificationChannel(CHANNEL, "Connection to the computer", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        manager(context).createNotificationChannel(channel)
        Notification.Builder(context, CHANNEL)
      } else {
        Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
      }
      // The small icon of the session notifications (the expo-notifications plugin's).
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (open != null) {
        builder.setContentIntent(
          PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        )
      }
      return builder
        .setSmallIcon(if (icon != 0) icon else context.applicationInfo.icon)
        .setContentTitle(context.applicationInfo.loadLabel(context.packageManager))
        .setContentText(text)
        .setCategory(Notification.CATEGORY_SERVICE)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .build()
    }
  }
}
