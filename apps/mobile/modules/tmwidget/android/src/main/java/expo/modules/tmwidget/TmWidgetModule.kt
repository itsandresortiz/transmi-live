package expo.modules.tmwidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** La app le deja al widget lo que debe mostrar (la misma instantánea que recibe el widget de iPhone) y le pide que se repinte. */
class TmWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TmWidget")

    Function("setSnapshot") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      StopWidgetProvider.saveSnapshot(ctx, json)
      StopWidgetProvider.renderAll(ctx)
    }
  }
}
