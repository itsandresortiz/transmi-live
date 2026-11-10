import ActivityKit
import ExpoModulesCore

/// Datos de la actividad en vivo del viaje. OJO: esta estructura está repetida, idéntica, en `targets/widget/TripActivity.swift`
/// (la app la crea y el widget la dibuja; iOS las empareja por el nombre del tipo). Si se cambia una, hay que cambiar la otra.
struct TripActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String        // qué hacer ahora («Espera el C15 hacia Portal Suba»)
    var detail: String       // detalle («Súbete en Calle 100, vagón 2…»)
    var badge: String        // ruta del tramo («C15») o vacío si se camina
    var color: String        // color de la ruta (#rrggbb)
    var until: Double        // hora de lo siguiente (segundos desde 1970); 0 si no aplica
    var untilLabel: String   // «Llega en», «Te bajas en», «Llegas en»
    var step: Int            // paso actual (1…steps)
    var steps: Int
    var arrive: Double       // hora de llegada al destino (segundos desde 1970)
    var link: String         // a dónde lleva al tocarla (transmilive:///trip o transmilive:///ride/ID)
  }
  var dest: String
}

/// Crea, actualiza y termina la actividad en vivo del viaje. Si el teléfono no las permite, o la app se compiló sin el widget, no hace nada y devuelve `false`.
public class TripActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TripActivity")

    Function("isAvailable") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("show") { (dest: String, json: String) async -> Bool in
      guard ActivityAuthorizationInfo().areActivitiesEnabled,
            let data = json.data(using: .utf8),
            let state = try? JSONDecoder().decode(TripActivityAttributes.ContentState.self, from: data) else { return false }
      // pasada media hora de la llegada prevista el sistema la marca como vieja
      let stale: Date? = state.arrive > 0 ? Date(timeIntervalSince1970: state.arrive + 1800) : nil
      let content = ActivityContent(state: state, staleDate: stale)
      if let current = Activity<TripActivityAttributes>.activities.first {
        await current.update(content)
        return true
      }
      do {
        _ = try Activity<TripActivityAttributes>.request(attributes: TripActivityAttributes(dest: dest), content: content, pushType: nil)
        return true
      } catch {
        return false
      }
    }

    AsyncFunction("end") { () async -> Void in
      for activity in Activity<TripActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
