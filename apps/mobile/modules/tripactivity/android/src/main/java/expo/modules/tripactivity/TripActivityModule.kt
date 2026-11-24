package expo.modules.tripactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * El viaje que se está siguiendo, como una notificación fija con cuenta regresiva (lo equivalente en Android a la actividad en vivo
 * de iPhone): qué hacer ahora, en cuánto llega el bus o te bajas, y en qué paso vas. No suena ni vibra al actualizarse; los avisos
 * de cada paso siguen saliendo aparte. Recibe el mismo estado que la versión de iPhone (`TripActivityState`).
 */
class TripActivityModule : Module() {
  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("TripActivity")

    Function("isAvailable") { manager()?.areNotificationsEnabled() == true }

    AsyncFunction("show") { dest: String, json: String ->
      val ctx = context ?: return@AsyncFunction false
      val nm = manager() ?: return@AsyncFunction false
      if (!nm.areNotificationsEnabled()) return@AsyncFunction false
      val s = JSONObject(json)
      ensureChannel(nm)

      val builder = newBuilder(ctx)
      val title = s.optString("title")
      val detail = s.optString("detail")
      val badge = s.optString("badge")
      val until = s.optDouble("until", 0.0)
      val untilLabel = s.optString("untilLabel")
      val step = s.optInt("step", 0)
      val steps = s.optInt("steps", 0)

      builder
        .setSmallIcon(R.drawable.tm_trip_bus)
        .setContentTitle(if (badge.isNotEmpty()) "$badge · $title" else title)
        .setContentText(detail)
        .setStyle(Notification.BigTextStyle().bigText(detail))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(true)
        .setCategory(Notification.CATEGORY_NAVIGATION)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
      try { builder.setColor(Color.parseColor(s.optString("color", "#e11d2e"))) } catch (e: Exception) { /* color mal escrito: se deja el del sistema */ }
      if (dest.isNotEmpty() || steps > 0) {
        val parts = ArrayList<String>()
        if (steps > 0) parts.add("Paso $step de $steps")
        if (dest.isNotEmpty()) parts.add("hacia $dest")
        builder.setSubText(parts.joinToString(" · "))
      }
      if (steps > 0) builder.setProgress(steps, step.coerceIn(0, steps), false)
      // la cuenta regresiva la lleva el sistema: sigue corriendo aunque la app esté en segundo plano
      val untilMs = (until * 1000).toLong()
      if (untilMs > System.currentTimeMillis()) {
        builder.setWhen(untilMs).setUsesChronometer(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setChronometerCountDown(true)
        if (untilLabel.isNotEmpty()) builder.setContentText("$untilLabel · $detail")
      }
      // al tocarla abre el viaje
      val link = s.optString("link", "transmilive:///trip")
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      builder.setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

      // si la app queda cerrada, la notificación se quita sola un rato después de la hora de llegada (no se queda pegada con la cuenta en negativo)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val arriveMs = (s.optDouble("arrive", 0.0) * 1000).toLong()
        val endMs = maxOf(arriveMs, untilMs) + 30 * 60_000L
        val left = endMs - System.currentTimeMillis()
        builder.setTimeoutAfter(if (left > 10 * 60_000L) left else 2 * 60 * 60_000L)
      }
      nm.notify(NOTIFICATION_ID, builder.build())
      true
    }

    AsyncFunction("end") {
      manager()?.cancel(NOTIFICATION_ID)
    }
  }

  @Suppress("DEPRECATION")
  private fun newBuilder(ctx: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)

  private fun manager(): NotificationManager? = context?.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

  private fun ensureChannel(nm: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (nm.getNotificationChannel(CHANNEL) != null) return
    // importancia baja: se ve fija arriba y en la pantalla de bloqueo, pero no suena ni interrumpe cada vez que se actualiza
    val channel = NotificationChannel(CHANNEL, "Viaje en curso", NotificationManager.IMPORTANCE_LOW)
    channel.description = "El paso en el que vas y cuánto falta, mientras sigues un viaje."
    channel.setShowBadge(false)
    nm.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL = "viaje-en-curso"
    private const val NOTIFICATION_ID = 7421
  }
}
