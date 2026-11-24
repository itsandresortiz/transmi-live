package expo.modules.tmwidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Widget «Parada favorita»: los próximos buses de una parada guardada.
 * Muestra buses en vivo (con cuenta regresiva) mientras el dato esté vigente y, si no, las horas del horario, rotuladas «Programado».
 * Los datos llegan de dos lados: la app deja una instantánea (tus favoritas, hasta 6) cada vez que se abre, y el widget baja por su cuenta
 * el archivo público de llegadas de sus paradas (el mismo que usa el widget de iPhone) cuando el sistema lo refresca.
 * Nunca muestra un bus cuya hora ya pasó.
 *
 * Elegir la parada: tocar el nombre pasa a la siguiente favorita (cada widget recuerda la suya). Se prefirió a una pantalla de
 * configuración al agregar el widget porque no depende del lanzador (algunos no la muestran o, si se cancela, el widget no queda puesto),
 * no necesita una actividad aparte y sigue funcionando si cambian las favoritas.
 *
 * Alto (4×3, o este mismo estirado hacia arriba): hasta tres paradas a la vez (`StopsWidgetProvider`).
 */
open class StopWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    renderAll(context)
    refreshInBackground(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_NEXT -> {
        // tocar el nombre: la siguiente favorita en ese widget
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
          val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          prefs.edit().putInt(offsetKey(id), prefs.getInt(offsetKey(id), 0) + 1).apply()
        }
        renderAll(context)
        refreshInBackground(context)
      }
      ACTION_REFRESH -> renderAll(context)
      else -> super.onReceive(context, intent)
    }
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
    // al estirarlo cambia de diseño (una parada o varias)
    renderAll(context)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for (id in ids) edit.remove(offsetKey(id))
    edit.apply()
  }

  /** Datos frescos sin abrir la app: se bajan en otro hilo (aquí no se puede usar la red) y se repinta al terminar. */
  private fun refreshInBackground(context: Context) {
    val pending = goAsync()
    Thread {
      try {
        if (fetchRemote(context)) renderAll(context)
      } catch (e: Exception) {
        // sin red o respuesta rara: se queda con lo que había
      } finally {
        pending.finish()
      }
    }.start()
  }

  private data class Arrival(val route: String, val head: String, val at: Long, val color: String)

  /** Lo que se muestra de una parada: lista, si es horario y el rótulo del estado. */
  private class Shown(val list: List<Arrival>, val scheduled: Boolean, val status: String)

  companion object {
    private const val PREFS = "tm_widget"
    private const val SNAPSHOT = "snapshot"
    private const val REMOTE = "remote2"      // { idParada: { at, arrivals } }; «remote» (una sola parada) era el de la versión anterior
    private const val REMOTE_FRESH_S = 600L
    private const val SHARDS = 64
    private const val BASE = "https://raw.githubusercontent.com/itsandresortiz/transmi-live/widget-data/a/"
    private const val ACTION_NEXT = "expo.modules.tmwidget.NEXT_STOP"
    private const val ACTION_REFRESH = "expo.modules.tmwidget.REFRESH"
    /** Desde este alto (dp) el widget de una parada, estirado, pasa a mostrar varias (un 4×2 en vertical mide ~180–240 dp según el teléfono). */
    private const val MULTI_MIN_DP = 270
    /** Desde este alto caben tres paradas; por debajo, dos. */
    private const val THREE_MIN_DP = 260

    private fun offsetKey(id: Int) = "offset_$id"

    fun saveSnapshot(context: Context, json: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, json).apply()
    }

    private fun allIds(context: Context, manager: AppWidgetManager): IntArray {
      val one = manager.getAppWidgetIds(ComponentName(context, StopWidgetProvider::class.java))
      val many = manager.getAppWidgetIds(ComponentName(context, StopsWidgetProvider::class.java))
      return one + many
    }

    fun renderAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      render(context, manager, allIds(context, manager))
    }

    /** En qué cajón está una parada: la misma cuenta que `widgetShard` en TypeScript y en Swift. */
    private fun shard(stopId: String): Int {
      var h = 0L
      for (ch in stopId) h = (h * 31 + ch.code) % 1_000_003L
      return (h % SHARDS).toInt()
    }

    private fun snapshot(context: Context): JSONObject? {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SNAPSHOT, null) ?: return null
      return try { JSONObject(raw) } catch (e: Exception) { null }
    }

    /** Tus paradas favoritas, en el orden de la app. */
    private fun favorites(snap: JSONObject?): List<JSONObject> {
      val arr = snap?.optJSONArray("stops") ?: return emptyList()
      val out = ArrayList<JSONObject>()
      for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { out.add(it) }
      return out
    }

    private fun isMulti(manager: AppWidgetManager, id: Int): Boolean {
      val provider = manager.getAppWidgetInfo(id)?.provider?.className
      if (provider == StopsWidgetProvider::class.java.name) return true
      return heightDp(manager, id) >= MULTI_MIN_DP
    }

    /** Alto del widget en vertical (0 si el lanzador no lo dice). */
    private fun heightDp(manager: AppWidgetManager, id: Int): Int =
      try { manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) } catch (e: Exception) { 0 }

    /** Cuántas paradas se ven en un widget de varias. */
    private fun multiCount(manager: AppWidgetManager, id: Int): Int {
      val h = heightDp(manager, id)
      return if (h in 1 until THREE_MIN_DP) 2 else 3
    }

    /** La parada de un widget de una sola: la favorita que le toca según cuántas veces se tocó su nombre. */
    private fun singleStop(context: Context, favs: List<JSONObject>, id: Int): JSONObject? {
      if (favs.isEmpty()) return null
      val off = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(offsetKey(id), 0)
      return favs[off.mod(favs.size)]
    }

    /** Las paradas que se ven ahora en todos los widgets puestos (para bajar solo esas). */
    private fun visibleStopIds(context: Context): List<String> {
      val manager = AppWidgetManager.getInstance(context)
      val favs = favorites(snapshot(context))
      val out = LinkedHashSet<String>()
      for (id in allIds(context, manager)) {
        if (isMulti(manager, id)) favs.take(multiCount(manager, id)).forEach { out.add(it.optString("id")) }
        else singleStop(context, favs, id)?.let { out.add(it.optString("id")) }
      }
      out.remove("")
      return out.toList()
    }

    /** Baja las llegadas publicadas de las paradas que se ven. Devuelve `true` si trajo algo que guardar. */
    private fun fetchRemote(context: Context): Boolean {
      if (snapshot(context)?.optBoolean("demo", false) == true) return false
      val ids = visibleStopIds(context)
      if (ids.isEmpty()) return false
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val saved = try { JSONObject(prefs.getString(REMOTE, null) ?: "{}") } catch (e: Exception) { JSONObject() }
      val started = System.currentTimeMillis()
      var got = false
      for ((index, group) in ids.groupBy { shard(it) }) {
        // el sistema da ~10 s a este trabajo: no se empieza otra descarga pasados 7
        if (System.currentTimeMillis() - started > 7000) break
        val conn = URL("$BASE$index.json").openConnection() as HttpURLConnection
        conn.connectTimeout = 4000
        conn.readTimeout = 4000
        try {
          if (conn.responseCode != 200) continue
          val body = conn.inputStream.bufferedReader().use { it.readText() }
          val json = JSONObject(body)
          val at = json.optLong("at", 0L)
          val stops = json.optJSONObject("stops")
          for (id in group) {
            // una parada que no viene en su archivo no tiene buses acercándose ahora
            val list = stops?.optJSONArray(id) ?: JSONArray()
            saved.put(id, JSONObject().put("at", at).put("arrivals", list))
            got = true
          }
        } catch (e: Exception) {
          // ese archivo falló: las demás paradas siguen
        } finally {
          conn.disconnect()
        }
      }
      if (got) {
        // solo se guardan las paradas que se ven: así no crece sin fin
        val keep = JSONObject()
        for (id in ids) saved.optJSONObject(id)?.let { keep.put(id, it) }
        prefs.edit().putString(REMOTE, keep.toString()).apply()
      }
      return got
    }

    private fun parse(list: JSONArray?, nowS: Long): List<Arrival> {
      val out = ArrayList<Arrival>()
      if (list == null) return out
      for (i in 0 until list.length()) {
        val o = list.optJSONObject(i) ?: continue
        val at = o.optDouble("t", 0.0).toLong()
        if (at > nowS) out.add(Arrival(o.optString("r"), o.optString("h"), at, o.optString("c", "#64748b")))
      }
      out.sortBy { it.at }
      return out
    }

    /** Buses en vivo (los que dejó la app o, si son más recientes, los que bajó el widget) y, si no hay, el horario. */
    private fun shown(stop: JSONObject, nowS: Long, demo: Boolean, snapAt: Long, remote: JSONObject?): Shown {
      var live: List<Arrival> = parse(stop.optJSONArray("arrivals"), nowS)
      // cuándo se calcularon esas llegadas: con más de 20 min ya no se dicen «en vivo»
      var liveAt = snapAt
      if (!demo) {
        val r = remote?.optJSONObject(stop.optString("id"))
        if (r != null) {
          val rAt = r.optLong("at", 0L)
          val fresh = nowS - rAt < REMOTE_FRESH_S
          val newer = rAt > snapAt
          if (fresh && newer) { live = parse(r.optJSONArray("arrivals"), nowS); liveAt = rAt }
        }
      }
      val planned = parse(stop.optJSONArray("sched"), nowS)
      val scheduled = live.isEmpty() && planned.isNotEmpty()
      val list = if (live.isEmpty()) planned else live
      val status = when {
        demo -> "DEMOSTRACIÓN"
        scheduled && list[0].at - nowS > 3600 -> "PRIMER BUS"      // de noche: el próximo es el primero de la mañana
        scheduled -> "PROGRAMADO"
        list.isEmpty() -> ""
        liveAt > 0 && nowS - liveAt >= 1200 -> "HACE ${(nowS - liveAt) / 60} MIN"
        else -> "EN VIVO"
      }
      return Shown(list, scheduled, status)
    }

    private fun openStop(context: Context, stopId: String?, requestCode: Int): PendingIntent {
      val link = if (!stopId.isNullOrEmpty()) "transmilive:///stop/$stopId" else "transmilive:///"
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Una fila de llegada: ruta en su color, hacia dónde y cuenta regresiva (en vivo) u hora (programado). */
    private fun fillRow(views: RemoteViews, a: Arrival?, scheduled: Boolean, row: Int, route: Int, head: Int, count: Int, time: Int, clock: SimpleDateFormat) {
      views.setViewVisibility(row, if (a == null) View.GONE else View.VISIBLE)
      if (a == null) return
      views.setTextViewText(route, a.route)
      val color = try { Color.parseColor(a.color) } catch (e: Exception) { Color.parseColor("#64748b") }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setColorStateList(route, "setBackgroundTintList", ColorStateList.valueOf(color))
      else views.setInt(route, "setBackgroundColor", color)
      views.setTextViewText(head, if (a.head.isNotEmpty()) "Hacia ${a.head}" else if (scheduled) "Según el horario" else "")
      if (scheduled) {
        // hora programada: se muestra la hora, no una cuenta regresiva
        views.setViewVisibility(count, View.GONE)
        views.setViewVisibility(time, View.VISIBLE)
        views.setTextViewText(time, clock.format(Date(a.at * 1000)))
      } else {
        // bus en vivo: cuenta regresiva que lleva el sistema
        views.setViewVisibility(time, View.GONE)
        views.setViewVisibility(count, View.VISIBLE)
        val base = SystemClock.elapsedRealtime() + (a.at * 1000 - System.currentTimeMillis())
        views.setChronometer(count, base, null, true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) views.setChronometerCountDown(count, true)
      }
    }

    private val SINGLE_ROWS = intArrayOf(R.id.tm_row1, R.id.tm_row2, R.id.tm_row3)
    private val SINGLE_ROUTES = intArrayOf(R.id.tm_route1, R.id.tm_route2, R.id.tm_route3)
    private val SINGLE_HEADS = intArrayOf(R.id.tm_head1, R.id.tm_head2, R.id.tm_head3)
    private val SINGLE_COUNTS = intArrayOf(R.id.tm_count1, R.id.tm_count2, R.id.tm_count3)
    private val SINGLE_TIMES = intArrayOf(R.id.tm_time1, R.id.tm_time2, R.id.tm_time3)

    private val SECTIONS = intArrayOf(R.id.tm_s1, R.id.tm_s2, R.id.tm_s3)
    private val SECTION_NAMES = intArrayOf(R.id.tm_s1_name, R.id.tm_s2_name, R.id.tm_s3_name)
    private val SECTION_STATUS = intArrayOf(R.id.tm_s1_status, R.id.tm_s2_status, R.id.tm_s3_status)
    private val SECTION_EMPTY = intArrayOf(R.id.tm_s1_empty, R.id.tm_s2_empty, R.id.tm_s3_empty)
    private val SECTION_ROWS = arrayOf(intArrayOf(R.id.tm_s1_row1, R.id.tm_s1_row2), intArrayOf(R.id.tm_s2_row1, R.id.tm_s2_row2), intArrayOf(R.id.tm_s3_row1, R.id.tm_s3_row2))
    private val SECTION_ROUTES = arrayOf(intArrayOf(R.id.tm_s1_route1, R.id.tm_s1_route2), intArrayOf(R.id.tm_s2_route1, R.id.tm_s2_route2), intArrayOf(R.id.tm_s3_route1, R.id.tm_s3_route2))
    private val SECTION_HEADS = arrayOf(intArrayOf(R.id.tm_s1_head1, R.id.tm_s1_head2), intArrayOf(R.id.tm_s2_head1, R.id.tm_s2_head2), intArrayOf(R.id.tm_s3_head1, R.id.tm_s3_head2))
    private val SECTION_COUNTS = arrayOf(intArrayOf(R.id.tm_s1_count1, R.id.tm_s1_count2), intArrayOf(R.id.tm_s2_count1, R.id.tm_s2_count2), intArrayOf(R.id.tm_s3_count1, R.id.tm_s3_count2))
    private val SECTION_TIMES = arrayOf(intArrayOf(R.id.tm_s1_time1, R.id.tm_s1_time2), intArrayOf(R.id.tm_s2_time1, R.id.tm_s2_time2), intArrayOf(R.id.tm_s3_time1, R.id.tm_s3_time2))

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      if (ids.isEmpty()) return
      val nowS = System.currentTimeMillis() / 1000
      val snap = snapshot(context)
      val favs = favorites(snap)
      val demo = snap?.optBoolean("demo", false) == true
      val snapAt = snap?.optDouble("at", 0.0)?.toLong() ?: 0L
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val remote = try { prefs.getString(REMOTE, null)?.let { JSONObject(it) } } catch (e: Exception) { null }
      val clock = SimpleDateFormat("h:mm a", Locale("es", "CO"))
      var firstLive: Long? = null      // el primer bus en vivo que pasa en cualquiera de los widgets

      for (id in ids) {
        if (isMulti(manager, id)) {
          val views = RemoteViews(context.packageName, R.layout.tm_widget_multi)
          val shownStops = favs.take(multiCount(manager, id))
          views.setViewVisibility(R.id.tm_m_empty, if (shownStops.isEmpty()) View.VISIBLE else View.GONE)
          views.setOnClickPendingIntent(R.id.tm_m_root, openStop(context, null, id * 8))
          for (k in SECTIONS.indices) {
            val stop = shownStops.getOrNull(k)
            views.setViewVisibility(SECTIONS[k], if (stop == null) View.GONE else View.VISIBLE)
            if (stop == null) continue
            val s = shown(stop, nowS, demo, snapAt, remote)
            if (!s.scheduled) s.list.firstOrNull()?.let { a -> firstLive = minOf(firstLive ?: a.at, a.at) }
            views.setTextViewText(SECTION_NAMES[k], stop.optString("name").ifEmpty { "Parada" })
            views.setTextViewText(SECTION_STATUS[k], s.status)
            views.setViewVisibility(SECTION_EMPTY[k], if (s.list.isEmpty()) View.VISIBLE else View.GONE)
            for (j in 0 until 2) {
              fillRow(views, s.list.getOrNull(j), s.scheduled, SECTION_ROWS[k][j], SECTION_ROUTES[k][j], SECTION_HEADS[k][j], SECTION_COUNTS[k][j], SECTION_TIMES[k][j], clock)
            }
            // cada parada abre la suya
            views.setOnClickPendingIntent(SECTIONS[k], openStop(context, stop.optString("id"), id * 8 + 1 + k))
          }
          manager.updateAppWidget(id, views)
          continue
        }

        val views = RemoteViews(context.packageName, R.layout.tm_widget)
        val stop = singleStop(context, favs, id)
        val s = stop?.let { shown(it, nowS, demo, snapAt, remote) }
        val list = s?.list ?: emptyList()
        if (s != null && !s.scheduled) list.firstOrNull()?.let { a -> firstLive = minOf(firstLive ?: a.at, a.at) }
        views.setTextViewText(R.id.tm_name, stop?.optString("name")?.takeIf { it.isNotEmpty() } ?: "TransMi LIVE")
        views.setTextViewText(R.id.tm_status, s?.status ?: "")
        val empty = when {
          stop == null -> "Abre TransMi LIVE y guarda una parada con la estrella para verla aquí."
          list.isEmpty() -> "Sin buses por ahora. Toca para abrir la parada."
          else -> null
        }
        views.setViewVisibility(R.id.tm_empty, if (empty == null) View.GONE else View.VISIBLE)
        if (empty != null) views.setTextViewText(R.id.tm_empty, empty)
        for (k in SINGLE_ROWS.indices) {
          fillRow(views, list.getOrNull(k), s?.scheduled == true, SINGLE_ROWS[k], SINGLE_ROUTES[k], SINGLE_HEADS[k], SINGLE_COUNTS[k], SINGLE_TIMES[k], clock)
        }

        // al tocarlo abre la parada (o la app, si aún no hay parada guardada)
        views.setOnClickPendingIntent(R.id.tm_root, openStop(context, stop?.optString("id"), id * 8))
        // con varias favoritas, tocar el nombre pasa a la siguiente («1 de 3 ›»)
        if (favs.size > 1) {
          val off = prefs.getInt(offsetKey(id), 0).mod(favs.size)
          views.setViewVisibility(R.id.tm_cycle, View.VISIBLE)
          views.setTextViewText(R.id.tm_cycle, "${off + 1} de ${favs.size} ›")
          val provider = manager.getAppWidgetInfo(id)?.provider ?: ComponentName(context, StopWidgetProvider::class.java)
          val next = Intent(ACTION_NEXT).setComponent(provider).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
          val tap = PendingIntent.getBroadcast(context, id * 8 + 5, next, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
          views.setOnClickPendingIntent(R.id.tm_header, tap)
        } else {
          views.setViewVisibility(R.id.tm_cycle, View.GONE)
          views.setOnClickPendingIntent(R.id.tm_header, openStop(context, stop?.optString("id"), id * 8))
        }
        manager.updateAppWidget(id, views)
      }

      // Cuando pase el primer bus en vivo hay que volver a pintar: si no, su cuenta seguiría en negativo bajo «EN VIVO»
      // hasta el siguiente refresco del sistema (cada 30 min). Alarma aproximada, no despierta el teléfono y no pide permisos.
      try {
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        val again = Intent(context, StopWidgetProvider::class.java).setAction(ACTION_REFRESH)
        val later = PendingIntent.getBroadcast(context, 2, again, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val first = firstLive
        if (first != null) alarms?.set(AlarmManager.RTC, maxOf(first * 1000 + 3000, System.currentTimeMillis() + 60_000), later)
        else alarms?.cancel(later)
      } catch (e: Exception) { /* sin alarma: se repinta en el siguiente refresco del sistema */ }
    }
  }
}

/** El mismo widget en tamaño alto (4×3): hasta tres paradas favoritas a la vez, cada una abre la suya. */
class StopsWidgetProvider : StopWidgetProvider()
