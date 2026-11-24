package expo.modules.tullave

import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lee la tarjeta TuLlave en Android con NFC (IsoDep). Igual que en iPhone, no interpreta nada: devuelve las respuestas de la
 * tarjeta en hexadecimal (con su estado final) y la lógica de saldo y movimientos vive en `@transmi/domain` (parseTuLlave).
 * No guarda ni envía nada.
 */
class TullaveModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var pending: Promise? = null
  private var timeout: Runnable? = null

  private fun adapter(): NfcAdapter? = appContext.reactContext?.let { NfcAdapter.getDefaultAdapter(it) }

  override fun definition() = ModuleDefinition {
    Name("Tullave")

    Function("isAvailable") { adapter()?.isEnabled == true }

    // «on» = listo; «off» = el teléfono tiene NFC pero está apagado; «none» = no tiene NFC
    Function("nfcState") {
      val a = adapter()
      if (a == null) "none" else if (a.isEnabled) "on" else "off"
    }

    AsyncFunction("read") { _: Map<String, String>, promise: Promise ->
      val a = adapter()
      val activity = appContext.currentActivity
      if (a == null || !a.isEnabled || activity == null) {
        promise.reject("unsupported", "Este teléfono no puede leer tarjetas ahora.", null)
        return@AsyncFunction
      }
      // una lectura a la vez: si había otra esperando, se cancela
      finish { it.reject("cancelled", "cancelled", null) }
      pending = promise
      val wait = Runnable { finish { it.reject("timeout", "timeout", null) } }
      timeout = wait
      main.postDelayed(wait, WAIT_MS)
      val flags = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
      main.post {
        try {
          a.enableReaderMode(activity, { tag -> onTag(tag) }, flags, null)
        } catch (e: Exception) {
          finish { it.reject("failed", "failed", e) }
        }
      }
    }

    Function("cancel") { finish { it.reject("cancelled", "cancelled", null) } }

    OnActivityEntersBackground { finish { it.reject("cancelled", "cancelled", null) } }
    OnDestroy { finish { it.reject("cancelled", "cancelled", null) } }
  }

  /** Llega en un hilo aparte (no el de la interfaz): aquí se puede hablar con la tarjeta sin bloquear la app. */
  private fun onTag(tag: Tag) {
    val card = IsoDep.get(tag)
    if (card == null) {
      finish { it.reject("not_tullave", "not_tullave", null) }
      return
    }
    try {
      card.connect()
      card.timeout = 3000
      val app = exchange(card, SELECT_APP)
      if (!app.endsWith("9000")) {
        finish { it.reject("not_tullave", "not_tullave", null) }
        return
      }
      val balance = exchange(card, BALANCE)
      val purse = exchange(card, PURSE)
      val cardFile = exchange(card, SELECT_CARD_FILE)
      val records = ArrayList<String?>()
      for (n in 1..10) {
        records.add(try { exchange(card, byteArrayOf(0x00, 0xB2.toByte(), n.toByte(), 0x24, 0x2E)) } catch (e: Exception) { null })
      }
      val reading = mapOf("balance" to balance, "purse" to purse, "cardFile" to cardFile, "records" to records)
      finish { it.resolve(reading) }
    } catch (e: Exception) {
      finish { it.reject("lost", "lost", e) }
    } finally {
      try { card.close() } catch (e: Exception) { /* ya estaba cerrada */ }
    }
  }

  private fun exchange(card: IsoDep, command: ByteArray): String =
    card.transceive(command).joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  /** Termina la lectura en curso (si la hay): apaga el lector, quita la espera y responde una sola vez. */
  private fun finish(answer: (Promise) -> Unit) {
    val p: Promise = synchronized(this) {
      val current = pending
      pending = null
      timeout?.let { main.removeCallbacks(it) }
      timeout = null
      current
    } ?: return
    main.post {
      try { appContext.currentActivity?.let { adapter()?.disableReaderMode(it) } } catch (e: Exception) { /* la actividad ya no está */ }
    }
    answer(p)
  }

  companion object {
    private const val WAIT_MS = 30_000L
    // Comandos estándar de tarjeta inteligente que entiende la TuLlave (los mismos del lector de iPhone).
    private val SELECT_APP = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, 0x07, 0xD4.toByte(), 0x10, 0x00, 0x00, 0x03, 0x00, 0x01)
    private val BALANCE = byteArrayOf(0x90.toByte(), 0x4C, 0x00, 0x00, 0x04)
    private val PURSE = byteArrayOf(0x00, 0xB0.toByte(), 0x86.toByte(), 0x00, 0x42)
    private val SELECT_CARD_FILE = byteArrayOf(0x00, 0xA4.toByte(), 0x00, 0x00, 0x02, 0x42, 0x00)
  }
}
