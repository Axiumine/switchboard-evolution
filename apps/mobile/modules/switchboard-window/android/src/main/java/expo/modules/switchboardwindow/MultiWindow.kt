package expo.modules.switchboardwindow

import android.app.Activity
import android.content.Intent
import com.facebook.react.ReactHost
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import java.lang.ref.WeakReference

/**
 * The app's windows (MainActivity and every WindowActivity) share one React
 * Native host, and the host knows one current activity: where dialogs and
 * pickers open and what the back button acts on. React Native expects a
 * single activity, so a window that pauses or closes would pause or destroy
 * the host under the others, and pausing one that is not the current activity
 * fails an assertion. Every window's delegate goes through here instead:
 *
 * - the window that gets the focus becomes the current activity;
 * - a window that pauses hands the host to another one still in front, and
 *   pauses it only when none is;
 * - a window that closes stops its own surface, and hands the host on while
 *   another window is open; the last one destroys it, as React Native does.
 *
 * Everything runs on the main thread, as the activity callbacks do.
 */
object MultiWindow {
  private val open = mutableListOf<WeakReference<Activity>>()
  /** The windows in front, the one resumed last at the end. */
  private val inFront = mutableListOf<WeakReference<Activity>>()

  private fun MutableList<WeakReference<Activity>>.drop(activity: Activity) =
    removeAll { it.get() == null || it.get() === activity }

  private fun MutableList<WeakReference<Activity>>.last(except: Activity): Activity? =
    asReversed().firstNotNullOfOrNull { ref -> ref.get()?.takeIf { it !== except && !it.isFinishing } }

  private fun current(host: ReactHost?): Activity? = host?.currentReactContext?.currentActivity

  fun created(activity: Activity) {
    open.drop(activity)
    open.add(WeakReference(activity))
  }

  /** After the delegate resumed the host with this window. */
  fun resumed(activity: Activity) {
    inFront.drop(activity)
    inFront.add(WeakReference(activity))
  }

  /**
   * Makes `activity` the host's current one without a pause and a resume
   * (the app would hear it go to the background and back): the host takes it
   * on resume, its context through a new intent that carries nothing.
   */
  private fun handTo(activity: Activity, host: ReactHost) {
    host.onHostResume(activity, activity as? DefaultHardwareBackBtnHandler)
    host.currentReactContext?.onNewIntent(activity, Intent())
  }

  /** The window that has the focus becomes the current one. */
  fun focused(activity: Activity, host: ReactHost?) {
    if (host == null || inFront.none { it.get() === activity }) return
    if (current(host) !== activity) handTo(activity, host)
  }

  fun pause(activity: Activity, host: ReactHost?, pause: () -> Unit) {
    inFront.drop(activity)
    val current = current(host)
    // Another window has the host: there is nothing of this one's to pause.
    if (host != null && current != null && current !== activity) return
    val other = inFront.last(except = activity)
    if (host != null && other != null) handTo(other, host) else pause()
  }

  fun destroy(activity: Activity, host: ReactHost?, unload: () -> Unit, destroy: () -> Unit) {
    inFront.drop(activity)
    open.drop(activity)
    val other = inFront.last(except = activity) ?: open.last(except = activity)
    if (host == null || other == null) {
      destroy()
      return
    }
    unload()
    val current = current(host)
    if (current == null || current === activity) {
      handTo(other, host)
      if (inFront.none { it.get() === other }) host.onHostPause(other)
    }
  }
}
