import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Datos que deja la app en el App Group (ver src/widgetSync.tsx)

struct Arrival: Codable, Hashable, Sendable {
  let r: String      // nombre corto de la ruta («C15»)
  let h: String      // hacia dónde va
  let t: Double      // hora de llegada (segundos desde 1970)
  let c: String?     // color de la ruta (#rrggbb)
}

struct StopData: Codable, Hashable, Sendable {
  let id: String
  let name: String
  let arrivals: [Arrival]
  var sched: [Arrival]? = nil   // próximas pasadas según el horario (respaldo cuando el dato en vivo ya se venció)
}

struct Snapshot: Codable {
  let at: Double     // cuándo la app calculó esto
  let stops: [StopData]   // tus paradas favoritas en el orden de la app (hasta 6; las versiones viejas de la app dejaban 3)
  var demo: Bool? = nil   // buses de ejemplo (modo demostración de la app): se rotula, nunca se muestra como dato real
}

private let appGroup = "group.com.transmilive.app"

private func loadSnapshot() -> Snapshot? {
  guard let text = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"),
        let data = text.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(Snapshot.self, from: data)
}

private func sampleStops() -> [StopData] {
  let now = Date()
  return [
    StopData(id: "0", name: "Tu parada favorita", arrivals: [
      Arrival(r: "C15", h: "Portal Suba", t: now.addingTimeInterval(190).timeIntervalSince1970, c: "#e11d2e"),
      Arrival(r: "H15", h: "Portal Tunal", t: now.addingTimeInterval(420).timeIntervalSince1970, c: "#e11d2e"),
      Arrival(r: "B12", h: "Portal Norte", t: now.addingTimeInterval(700).timeIntervalSince1970, c: "#12945f"),
    ]),
    StopData(id: "1", name: "Cerca de la casa", arrivals: [
      Arrival(r: "543", h: "Usaquén", t: now.addingTimeInterval(260).timeIntervalSince1970, c: "#1d6fe0"),
      Arrival(r: "M86", h: "Portal 80", t: now.addingTimeInterval(540).timeIntervalSince1970, c: "#8b2fc9"),
    ]),
    StopData(id: "2", name: "Trabajo", arrivals: [
      Arrival(r: "D20", h: "Portal Usme", t: now.addingTimeInterval(330).timeIntervalSince1970, c: "#e11d2e"),
      Arrival(r: "16-5", h: "Bosa", t: now.addingTimeInterval(910).timeIntervalSince1970, c: "#12945f"),
    ]),
  ]
}

private let sample = Snapshot(at: Date().timeIntervalSince1970, stops: sampleStops())

extension Color {
  init(hex: String?) {
    let s = (hex ?? "#e11d2e").replacingOccurrences(of: "#", with: "")
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
}

// MARK: - Elegir la parada (mantener presionado el widget › Editar widget)

/// Una parada favorita como opción del widget. Las opciones salen de lo que la app dejó en el App Group: si la quitas de favoritas,
/// deja de existir como opción y el widget vuelve a mostrar tus favoritas en orden.
struct StopEntity: AppEntity, Sendable {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Parada" }
  static var defaultQuery: StopQuery { StopQuery() }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct StopQuery: EntityQuery, Sendable {
  private func favorites() -> [StopEntity] {
    (loadSnapshot()?.stops ?? []).map { StopEntity(id: $0.id, name: $0.name) }
  }
  func entities(for identifiers: [StopEntity.ID]) async throws -> [StopEntity] {
    let all = favorites()
    return identifiers.compactMap { id in all.first { $0.id == id } }
  }
  func suggestedEntities() async throws -> [StopEntity] { favorites() }
}

struct SelectStopIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Elegir parada" }
  static var description: IntentDescription { "Elige cuál de tus paradas favoritas sale primero en el widget." }

  /// Sin elegir: tus favoritas en el orden de la app (como antes).
  @Parameter(title: "Parada")
  var stop: StopEntity?

  /// En los tamaños mediano y grande caben 2 o 3 paradas: la elegida y, después, tus otras favoritas.
  @Parameter(title: "Mostrar también tus otras favoritas", default: true)
  var others: Bool
}

// MARK: - Línea de tiempo

/// Una parada lista para mostrar, con la hora en que se calcularon sus llegadas (de la app o de lo publicado en internet).
struct ShownStop: Hashable {
  let data: StopData
  let at: Double
}

struct StopEntry: TimelineEntry {
  let date: Date
  let stops: [ShownStop]     // vacío: no hay favoritas guardadas
  var demo: Bool = false
}

private func sampleEntry() -> StopEntry {
  StopEntry(date: Date(), stops: sample.stops.map { ShownStop(data: $0, at: sample.at) })
}

/// Cuántas paradas caben en cada tamaño.
private func capacity(_ family: WidgetFamily) -> Int {
  switch family {
  case .systemMedium: return 2
  case .systemLarge, .systemExtraLarge: return 3
  default: return 1
  }
}

/// Qué paradas muestra el widget: la elegida (si sigue en favoritas) y, si se pide, las demás favoritas en su orden.
private func pick(_ snap: Snapshot?, _ config: SelectStopIntent, _ count: Int) -> [StopData] {
  let all = snap?.stops ?? []
  guard let chosenId = config.stop?.id, let chosen = all.first(where: { $0.id == chosenId }) else {
    return Array(all.prefix(count))
  }
  if !config.others { return [chosen] }
  let rest = all.filter { $0.id != chosenId }
  return Array(([chosen] + rest).prefix(count))
}

struct Provider: AppIntentTimelineProvider {
  typealias Entry = StopEntry
  typealias Intent = SelectStopIntent

  func placeholder(in context: Context) -> StopEntry { sampleEntry() }

  func snapshot(for configuration: SelectStopIntent, in context: Context) async -> StopEntry {
    guard !context.isPreview, let local = loadSnapshot() else { return sampleEntry() }
    let stops = pick(local, configuration, capacity(context.family)).map { ShownStop(data: $0, at: local.at) }
    return StopEntry(date: Date(), stops: stops, demo: local.demo == true)
  }

  func timeline(for configuration: SelectStopIntent, in context: Context) async -> Timeline<StopEntry> {
    let local = loadSnapshot()
    let demo = local?.demo == true
    var shown = pick(local, configuration, capacity(context.family)).map { ShownStop(data: $0, at: local?.at ?? 0) }
    // con paradas favoritas (y sin modo demostración) se piden las llegadas publicadas en internet: así el widget se actualiza aunque la app esté cerrada
    if !demo && !shown.isEmpty {
      let remote = await fetchRemote(stopIds: shown.map { $0.data.id })
      let now = Date().timeIntervalSince1970
      shown = shown.map { s in
        guard let r = remote[s.data.id] else { return s }
        // se usa lo publicado solo si es reciente (menos de 10 min) y más nuevo que lo que dejó la app
        // (cada comparación va en su propia variable: `a < b, c > d` seguido lo lee Swift como un tipo genérico y no compila)
        let fresh = (now - r.at) < 600
        let newer = r.at > s.at
        guard fresh, newer else { return s }
        return ShownStop(data: StopData(id: s.data.id, name: s.data.name, arrivals: r.list, sched: s.data.sched), at: r.at)
      }
    }
    return makeTimeline(StopEntry(date: Date(), stops: shown, demo: demo))
  }

  private func makeTimeline(_ base: StopEntry) -> Timeline<StopEntry> {
    let now = Date()
    // una entrada por cada llegada próxima (de todas las paradas que se ven): al pasar un bus, el widget ya muestra los siguientes sin pedir más datos
    var dates: Set<Date> = [now]
    for s in base.stops {
      for a in s.data.arrivals + (s.data.sched ?? []) {
        let d = Date(timeIntervalSince1970: a.t)
        if d > now { dates.insert(d) }
      }
    }
    let entries = dates.sorted().prefix(24).map { StopEntry(date: $0, stops: base.stops, demo: base.demo) }
    // iOS decide cada cuánto deja refrescar. Se le pide a los 5 min, o antes si se acaban los buses en vivo que se conocen de alguna
    // de las paradas (nunca antes de 2 min)
    var lastLive: Date? = nil
    for s in base.stops {
      guard let last = s.data.arrivals.map({ Date(timeIntervalSince1970: $0.t) }).filter({ $0 > now }).max() else { continue }
      lastLive = min(lastLive ?? last, last)
    }
    let next = min(now.addingTimeInterval(5 * 60), max(now.addingTimeInterval(2 * 60), lastLive ?? now))
    return Timeline(entries: Array(entries), policy: .after(next))
  }
}

// MARK: - Llegadas publicadas (rama widget-data del repositorio; las calcula el workflow «Llegadas para el widget»)

private struct RemoteShard: Codable, Sendable {
  let at: Double
  let stops: [String: [Arrival]]
}

private struct RemoteStop {
  let at: Double
  let list: [Arrival]
}

/// En qué archivo está una parada. La misma cuenta está en `packages/application/src/widget-feed.ts` (`widgetShard`)
/// y en el widget de Android (`StopWidgetProvider.kt`): si cambia allá, cambia aquí.
private func widgetShard(_ id: String) -> Int {
  var h = 0
  for u in id.utf16 { h = (h * 31 + Int(u)) % 1_000_003 }
  return h % 64
}

private func fetchShard(_ shard: Int) async -> RemoteShard? {
  let bucket = Int(Date().timeIntervalSince1970 / 120)
  guard let url = URL(string: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/widget-data/a/\(shard).json?t=\(bucket)") else { return nil }
  var request = URLRequest(url: url)
  request.timeoutInterval = 8
  request.cachePolicy = .reloadIgnoringLocalCacheData
  guard let result = try? await URLSession.shared.data(for: request) else { return nil }
  let (data, response) = result
  guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
  return try? JSONDecoder().decode(RemoteShard.self, from: data)
}

/// Baja (a la vez) los archivos de las paradas que se ven. Una parada que no viene en su archivo no tiene buses acercándose ahora.
private func fetchRemote(stopIds: [String]) async -> [String: RemoteStop] {
  let shards = Array(Set(stopIds.map { widgetShard($0) }))
  var out: [String: RemoteStop] = [:]
  await withTaskGroup(of: (Int, RemoteShard?).self) { group in
    for s in shards {
      group.addTask {
        let shard = await fetchShard(s)
        return (s, shard)
      }
    }
    for await (index, shard) in group {
      guard let shard = shard else { continue }
      for id in stopIds where widgetShard(id) == index {
        out[id] = RemoteStop(at: shard.at, list: shard.stops[id] ?? [])
      }
    }
  }
  return out
}

// MARK: - Estado de una parada

/// Lo que se muestra de una parada: los buses en vivo y, si no hay ninguno vigente, lo que dice el horario (rotulado como programado).
struct StopState {
  let shown: ShownStop
  let date: Date
  let demo: Bool

  var stop: StopData { shown.data }
  private var upcoming: [Arrival] { stop.arrivals.filter { Date(timeIntervalSince1970: $0.t) > date }.sorted { $0.t < $1.t } }
  private var planned: [Arrival] { (stop.sched ?? []).filter { Date(timeIntervalSince1970: $0.t) > date }.sorted { $0.t < $1.t } }
  var isScheduled: Bool { upcoming.isEmpty && !planned.isEmpty }
  var list: [Arrival] { upcoming.isEmpty ? planned : upcoming }
  private var ageMinutes: Int { Int(max(0, Date().timeIntervalSince1970 - shown.at) / 60) }

  /// Estado en una palabra, con su punto de color: en vivo (verde), programado (gris), demostración (morado) o dato viejo (ámbar).
  var statusText: String {
    if demo { return "Demostración" }
    if isScheduled {
      // de noche: el próximo es el primero de la mañana; se dice así en vez de «Programado»
      let wait = (list.first?.t ?? 0) - date.timeIntervalSince1970
      return wait > 3600 ? "Primer bus" : "Programado"
    }
    if list.isEmpty { return "Sin datos ahora" }      // sin buses ni horario que mostrar no se puede decir «En vivo»
    if ageMinutes >= 20 { return "Hace \(ageMinutes) min" }
    return "En vivo"
  }
  var statusColor: Color {
    if demo { return Color(hex: "#8b5cf6") }
    if isScheduled { return Color.secondary }
    if list.isEmpty { return Color.secondary }
    if ageMinutes >= 20 { return Color(hex: "#f59e0b") }
    return Color(hex: "#22c55e")
  }
  var link: URL? { URL(string: "transmilive:///stop/\(stop.id)") }
}

// MARK: - Vistas

/// La ruta en su recuadro de color. Con el tinte o el modo transparente de iOS los colores se aplanan y un recuadro relleno taparía el texto: ahí va en contorno.
struct RouteBadge: View {
  @Environment(\.widgetRenderingMode) private var mode
  let a: Arrival
  var big: Bool = false
  var body: some View {
    let size: CGFloat = big ? 15 : 12
    let radius: CGFloat = big ? 8 : 6
    if mode == .fullColor {
      Text(a.r)
        .font(.system(size: size, weight: .heavy, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .padding(.horizontal, big ? 9 : 6).padding(.vertical, big ? 4 : 2.5)
        .background(Color(hex: a.c), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    } else {
      Text(a.r)
        .font(.system(size: size, weight: .heavy, design: .rounded))
        .foregroundStyle(.primary)
        .lineLimit(1)
        .padding(.horizontal, big ? 9 : 6).padding(.vertical, big ? 4 : 2.5)
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.primary, lineWidth: 1.5))
        .widgetAccentable()
    }
  }
}

/// Una llegada en una fila: ruta, hacia dónde (si cabe) y la cuenta regresiva (en vivo) o la hora (programado).
struct ArrivalRow: View {
  let a: Arrival
  let compact: Bool
  var scheduled: Bool = false
  var body: some View {
    HStack(spacing: 7) {
      RouteBadge(a: a)
      if !compact && !a.h.isEmpty {
        Text(a.h).font(.system(size: 12, weight: .medium)).lineLimit(1).foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      Text(Date(timeIntervalSince1970: a.t), style: scheduled ? .time : .timer)
        .font(.system(size: compact ? 13 : 15, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .foregroundStyle(.secondary)
        .frame(maxWidth: scheduled ? 96 : 58, alignment: .trailing)
    }
  }
}

/// El próximo bus, en grande: una barra del color de su ruta, la ruta y la cuenta regresiva.
struct NextBusHero: View {
  @Environment(\.widgetRenderingMode) private var mode
  let a: Arrival
  let scheduled: Bool
  let timeSize: CGFloat
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(spacing: 6) {
        RouteBadge(a: a, big: true)
        if !a.h.isEmpty {
          Text(a.h).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Text(Date(timeIntervalSince1970: a.t), style: scheduled ? .time : .timer)
        .font(.system(size: timeSize, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.55)
    }
    .padding(.leading, 12)
    // la barra va como capa sobre el bloque: así toma exactamente su alto
    .overlay(alignment: .leading) {
      Capsule()
        .fill(mode == .fullColor ? Color(hex: a.c) : Color.primary)
        .frame(width: 4)
        .widgetAccentable()
    }
  }
}

/// El estado de una parada con su punto de color.
struct StatusLabel: View {
  let state: StopState
  var body: some View {
    HStack(spacing: 4) {
      Circle().fill(state.statusColor).frame(width: 6, height: 6)
      Text(state.statusText.uppercased()).font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary).lineLimit(1)
    }
  }
}

/// El nombre de una parada, en letra ancha.
struct StopTitle: View {
  let name: String
  let size: CGFloat
  var body: some View {
    Text(name)
      .font(.system(size: size, weight: .heavy).width(.expanded))
      .lineLimit(1)
      .minimumScaleFactor(0.75)
  }
}

/// Una parada en una columna (mediano con dos paradas): nombre, estado, el próximo bus y el siguiente.
struct StopColumn: View {
  let state: StopState
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      StopTitle(name: state.stop.name, size: 13)
      StatusLabel(state: state).padding(.top, 3)
      Spacer(minLength: 4)
      if let first = state.list.first {
        NextBusHero(a: first, scheduled: state.isScheduled, timeSize: 24)
        Spacer(minLength: 4)
        ViewThatFits(in: .vertical) {
          VStack(spacing: 4) {
            ForEach(Array(state.list.dropFirst().prefix(1)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: state.isScheduled) }
          }
          EmptyView()
        }
      } else {
        Text("Sin buses por ahora").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// Una parada en un bloque (grande con varias paradas): nombre y estado en una línea y, debajo, sus próximos buses.
struct StopSection: View {
  let state: StopState
  let rows: Int
  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack(spacing: 8) {
        StopTitle(name: state.stop.name, size: 14)
        Spacer(minLength: 4)
        StatusLabel(state: state)
      }
      if state.list.isEmpty {
        Text("Sin buses por ahora").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
      } else {
        // las filas que quepan: en los teléfonos más pequeños, una menos
        ViewThatFits(in: .vertical) {
          VStack(spacing: 4) {
            ForEach(Array(state.list.prefix(rows)), id: \.self) { ArrivalRow(a: $0, compact: false, scheduled: state.isScheduled) }
          }
          VStack(spacing: 4) {
            ForEach(Array(state.list.prefix(max(1, rows - 1))), id: \.self) { ArrivalRow(a: $0, compact: false, scheduled: state.isScheduled) }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

struct StopWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: StopEntry

  private var states: [StopState] { entry.stops.map { StopState(shown: $0, date: entry.date, demo: entry.demo) } }
  private var main: StopState? { states.first }

  var body: some View {
    Group {
      switch family {
      case .accessoryRectangular: lockScreen
      case .accessoryInline: Text(inline)
      case .systemSmall: small
      case .systemLarge, .systemExtraLarge: large
      default: medium
      }
    }
    .widgetURL(main?.link)
    .containerBackground(for: .widget) {
      // fondo con un degradado suave en vez de un color plano
      LinearGradient(
        colors: scheme == .dark ? [Color(hex: "#23232b"), Color(hex: "#0e0e12")] : [Color(hex: "#ffffff"), Color(hex: "#eef0f4")],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    }
  }

  // MARK: piezas

  private var noStop: some View {
    VStack(alignment: .leading, spacing: 6) {
      Image(systemName: "star.fill").font(.system(size: 18)).foregroundStyle(Color(hex: "#e11d2e")).widgetAccentable()
      Text("Guarda una parada").font(.system(size: 15, weight: .heavy).width(.expanded)).lineLimit(2).minimumScaleFactor(0.8)
      Text("Márcala con la estrella en TransMi LIVE y aparecerá aquí.").font(.caption).foregroundStyle(.secondary)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
  private var noBuses: some View {
    VStack(alignment: .leading, spacing: 3) {
      Image(systemName: "moon.zzz.fill").font(.system(size: 18)).foregroundStyle(.secondary)
      Text("Sin buses acercándose").font(.system(size: 14, weight: .semibold))
      Text("Abre la app para ver más.").font(.caption2).foregroundStyle(.secondary)
    }
  }

  // MARK: tamaños

  private var inline: String {
    guard let s = main, let a = s.list.first else { return "TransMi LIVE" }
    return s.isScheduled ? "\(a.r) programado" : "\(a.r) llega pronto"
  }

  private var lockScreen: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(entry.demo ? "Demostración" : (main?.stop.name ?? "TransMi LIVE")).font(.system(size: 14, weight: .heavy).width(.expanded)).lineLimit(1).minimumScaleFactor(0.8)
      if let s = main, let a = s.list.first {
        HStack(spacing: 6) {
          Text(a.r).font(.system(size: 15, weight: .heavy, design: .rounded))
          Spacer(minLength: 4)
          Text(Date(timeIntervalSince1970: a.t), style: s.isScheduled ? .time : .timer).font(.system(size: 15, weight: .bold, design: .rounded)).monospacedDigit().multilineTextAlignment(.trailing)
        }
        if s.list.count > 1 {
          HStack(spacing: 6) {
            Text(s.list[1].r).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(Date(timeIntervalSince1970: s.list[1].t), style: s.isScheduled ? .time : .timer).font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit().multilineTextAlignment(.trailing).foregroundStyle(.secondary)
          }
        }
      } else {
        Text("Sin buses acercándose").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  /// Pequeño: una parada (la elegida o la primera favorita): el nombre, el próximo bus en grande y los dos siguientes.
  private var small: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let s = main {
        StopTitle(name: s.stop.name, size: 13)
        StatusLabel(state: s).padding(.top, 3)
        Spacer(minLength: 4)
        if let first = s.list.first {
          NextBusHero(a: first, scheduled: s.isScheduled, timeSize: 28)
          Spacer(minLength: 4)
          // los dos siguientes si caben; en los teléfonos más pequeños, solo uno
          ViewThatFits(in: .vertical) {
            VStack(spacing: 4) {
              ForEach(Array(s.list.dropFirst().prefix(2)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: s.isScheduled) }
            }
            VStack(spacing: 4) {
              ForEach(Array(s.list.dropFirst().prefix(1)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: s.isScheduled) }
            }
          }
        } else {
          noBuses
          Spacer(minLength: 0)
        }
      } else {
        noStop
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// Mediano: con dos o más paradas, una columna por parada (cada una abre su parada); con una sola, como antes:
  /// a la izquierda el próximo bus en grande y a la derecha los que siguen.
  private var medium: some View {
    Group {
      if states.count >= 2 {
        HStack(alignment: .top, spacing: 12) {
          Link(destination: states[0].link ?? URL(string: "transmilive:///")!) { StopColumn(state: states[0]) }
          Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 1)
          Link(destination: states[1].link ?? URL(string: "transmilive:///")!) { StopColumn(state: states[1]) }
        }
      } else if let s = main {
        HStack(alignment: .top, spacing: 14) {
          VStack(alignment: .leading, spacing: 0) {
            StopTitle(name: s.stop.name, size: 15)
            StatusLabel(state: s).padding(.top, 4)
            Spacer(minLength: 6)
            if let first = s.list.first {
              NextBusHero(a: first, scheduled: s.isScheduled, timeSize: 36)
            } else {
              noBuses
            }
            Spacer(minLength: 0)
          }
          .frame(maxWidth: .infinity, alignment: .leading)

          if s.list.count > 1 {
            VStack(alignment: .leading, spacing: 0) {
              Text("LUEGO").font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary)
              Spacer(minLength: 6)
              VStack(spacing: 8) {
                ForEach(Array(s.list.dropFirst().prefix(4)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: s.isScheduled) }
              }
              Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      } else {
        noStop
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// Grande: hasta tres paradas, una debajo de otra (cada una abre su parada); con una sola, el próximo bus en grande y una lista larga.
  private var large: some View {
    Group {
      if states.count >= 2 {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(Array(states.prefix(3).enumerated()), id: \.offset) { item in
            if item.offset > 0 { Rectangle().fill(Color.secondary.opacity(0.25)).frame(height: 1) }
            Link(destination: item.element.link ?? URL(string: "transmilive:///")!) {
              StopSection(state: item.element, rows: states.count >= 3 ? 3 : 4)
            }
          }
          Spacer(minLength: 0)
        }
      } else if let s = main {
        VStack(alignment: .leading, spacing: 0) {
          StopTitle(name: s.stop.name, size: 17)
          StatusLabel(state: s).padding(.top, 4)
          Spacer(minLength: 10)
          if let first = s.list.first {
            NextBusHero(a: first, scheduled: s.isScheduled, timeSize: 40)
            Spacer(minLength: 12)
            if s.list.count > 1 {
              Text("LUEGO").font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary)
              VStack(spacing: 8) {
                ForEach(Array(s.list.dropFirst().prefix(6)), id: \.self) { ArrivalRow(a: $0, compact: false, scheduled: s.isScheduled) }
              }
              .padding(.top, 6)
            }
          } else {
            noBuses
          }
          Spacer(minLength: 0)
        }
      } else {
        noStop
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Widget

struct FavoriteStopWidget: Widget {
  // el mismo nombre de siempre: los widgets que ya están puestos siguen funcionando (sin parada elegida = tus favoritas en orden)
  let kind = "FavoriteStopWidget"
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: SelectStopIntent.self, provider: Provider()) { entry in StopWidgetView(entry: entry) }
      .configurationDisplayName("Parada favorita")
      .description("Cuándo llegan los próximos buses a tus paradas favoritas. Mantenlo presionado y toca «Editar widget» para elegir la parada.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct TransMiWidgets: WidgetBundle {
  var body: some Widget {
    FavoriteStopWidget()
    TripLiveActivity()
  }
}

// MARK: - Vistas previas (Xcode › Editor › Canvas): se ve el widget sin correr la app

private func previewEntry(_ count: Int) -> StopEntry {
  StopEntry(date: .now, stops: sample.stops.prefix(count).map { ShownStop(data: $0, at: sample.at) })
}

#Preview("Pequeño", as: .systemSmall) { FavoriteStopWidget() } timeline: { previewEntry(1) }
#Preview("Mediano, una parada", as: .systemMedium) { FavoriteStopWidget() } timeline: { previewEntry(1) }
#Preview("Mediano, dos paradas", as: .systemMedium) { FavoriteStopWidget() } timeline: { previewEntry(2) }
#Preview("Grande, tres paradas", as: .systemLarge) { FavoriteStopWidget() } timeline: { previewEntry(3) }
#Preview("Grande, una parada", as: .systemLarge) { FavoriteStopWidget() } timeline: { previewEntry(1) }
#Preview("Pantalla de bloqueo", as: .accessoryRectangular) { FavoriteStopWidget() } timeline: { previewEntry(1) }
#Preview("Sin favoritas", as: .systemSmall) { FavoriteStopWidget() } timeline: { StopEntry(date: .now, stops: []) }
