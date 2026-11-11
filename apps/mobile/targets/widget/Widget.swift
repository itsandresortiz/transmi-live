import SwiftUI
import WidgetKit

// MARK: - Datos que deja la app en el App Group (ver src/widgetSync.ts)

struct Arrival: Codable, Hashable {
  let r: String      // nombre corto de la ruta («C15»)
  let h: String      // hacia dónde va
  let t: Double      // hora de llegada (segundos desde 1970)
  let c: String?     // color de la ruta (#rrggbb)
}

struct StopData: Codable, Hashable {
  let id: String
  let name: String
  let arrivals: [Arrival]
  var sched: [Arrival]? = nil   // próximas pasadas según el horario (respaldo cuando el dato en vivo ya se venció)
}

struct Snapshot: Codable {
  let at: Double     // cuándo la app calculó esto
  let stops: [StopData]
  var demo: Bool? = nil   // buses de ejemplo (modo demostración de la app): se rotula, nunca se muestra como dato real
}

private let appGroup = "group.com.transmilive.app"

private func loadSnapshot() -> Snapshot? {
  guard let text = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"),
        let data = text.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(Snapshot.self, from: data)
}

private let sample = Snapshot(at: Date().timeIntervalSince1970, stops: [
  StopData(id: "0", name: "Tu parada favorita", arrivals: [
    Arrival(r: "C15", h: "Portal Suba", t: Date().addingTimeInterval(190).timeIntervalSince1970, c: "#e11d2e"),
    Arrival(r: "H15", h: "Portal Tunal", t: Date().addingTimeInterval(420).timeIntervalSince1970, c: "#e11d2e"),
    Arrival(r: "B12", h: "Portal Norte", t: Date().addingTimeInterval(700).timeIntervalSince1970, c: "#12945f"),
  ]),
])

extension Color {
  init(hex: String?) {
    let s = (hex ?? "#e11d2e").replacingOccurrences(of: "#", with: "")
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
}

// MARK: - Línea de tiempo

struct StopEntry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> StopEntry { StopEntry(date: Date(), snapshot: sample) }

  func getSnapshot(in context: Context, completion: @escaping (StopEntry) -> Void) {
    completion(StopEntry(date: Date(), snapshot: context.isPreview ? sample : (loadSnapshot() ?? sample)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StopEntry>) -> Void) {
    let local = loadSnapshot()
    // con una parada favorita (y sin modo demostración) se piden las llegadas publicadas en internet: así el widget se actualiza aunque la app esté cerrada
    guard let stop = local?.stops.first, local?.demo != true else { completion(makeTimeline(local)); return }
    fetchRemote(stopId: stop.id) { remote in
      var snap = local
      // se usa lo publicado solo si es reciente (menos de 10 min) y más nuevo que lo que dejó la app
      // (cada comparación va entre paréntesis: `a < b, c > d` seguido lo lee Swift como un tipo genérico y no compila)
      let age = Date().timeIntervalSince1970 - (remote?.at ?? 0)
      let newer = (remote?.at ?? 0) > (local?.at ?? 0)
      if let remote = remote, (age < 600), newer {
        let fresh = StopData(id: stop.id, name: stop.name, arrivals: remote.stops[stop.id] ?? [], sched: stop.sched)
        snap = Snapshot(at: remote.at, stops: [fresh] + Array((local?.stops ?? []).dropFirst()), demo: false)
      }
      completion(makeTimeline(snap))
    }
  }

  private func makeTimeline(_ snap: Snapshot?) -> Timeline<StopEntry> {
    let now = Date()
    // una entrada por cada llegada próxima: al pasar un bus, el widget ya muestra los siguientes sin pedir más datos
    var dates: Set<Date> = [now]
    for a in (snap?.stops.first?.arrivals ?? []) + (snap?.stops.first?.sched ?? []) {
      let d = Date(timeIntervalSince1970: a.t)
      if d > now { dates.insert(d) }
    }
    let entries = dates.sorted().prefix(12).map { StopEntry(date: $0, snapshot: snap) }
    // iOS decide cada cuánto deja refrescar. Se le pide a los 5 min, o antes si los buses en vivo que se conocen se acaban antes (nunca antes de 2 min)
    let lastLive = (snap?.stops.first?.arrivals ?? []).map { Date(timeIntervalSince1970: $0.t) }.filter { $0 > now }.max()
    let next = min(now.addingTimeInterval(5 * 60), max(now.addingTimeInterval(2 * 60), lastLive ?? now))
    return Timeline(entries: entries, policy: .after(next))
  }
}

// MARK: - Llegadas publicadas (rama widget-data del repositorio; las calcula el workflow «Llegadas para el widget»)

private struct RemoteShard: Codable {
  let at: Double
  let stops: [String: [Arrival]]
}

/// En qué archivo está una parada. La misma cuenta está en `packages/application/src/widget-feed.ts` (`widgetShard`): si cambia allá, cambia aquí.
private func widgetShard(_ id: String) -> Int {
  var h = 0
  for u in id.utf16 { h = (h * 31 + Int(u)) % 1_000_003 }
  return h % 64
}

private func fetchRemote(stopId: String, done: @escaping (RemoteShard?) -> Void) {
  let bucket = Int(Date().timeIntervalSince1970 / 120)
  guard let url = URL(string: "https://raw.githubusercontent.com/itsandresortiz/transmi-live/widget-data/a/\(widgetShard(stopId)).json?t=\(bucket)") else { done(nil); return }
  var request = URLRequest(url: url)
  request.timeoutInterval = 8
  request.cachePolicy = .reloadIgnoringLocalCacheData
  URLSession.shared.dataTask(with: request) { data, response, _ in
    guard let data = data, (response as? HTTPURLResponse)?.statusCode == 200 else { done(nil); return }
    done(try? JSONDecoder().decode(RemoteShard.self, from: data))
  }.resume()
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

struct StopWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: StopEntry

  private var stop: StopData? { entry.snapshot?.stops.first }
  private var upcoming: [Arrival] { (stop?.arrivals ?? []).filter { Date(timeIntervalSince1970: $0.t) > entry.date }.sorted { $0.t < $1.t } }
  private var planned: [Arrival] { (stop?.sched ?? []).filter { Date(timeIntervalSince1970: $0.t) > entry.date }.sorted { $0.t < $1.t } }
  private var isDemo: Bool { entry.snapshot?.demo == true }
  private var ageMinutes: Int { Int(max(0, Date().timeIntervalSince1970 - (entry.snapshot?.at ?? 0)) / 60) }
  /// Lo que se muestra: los buses en vivo y, si no hay ninguno vigente, lo que dice el horario (rotulado como programado).
  private var isScheduled: Bool { upcoming.isEmpty && !planned.isEmpty }
  private var list: [Arrival] { upcoming.isEmpty ? planned : upcoming }

  var body: some View {
    Group {
      switch family {
      case .accessoryRectangular: lockScreen
      case .accessoryInline: Text(inline)
      case .systemSmall: small
      default: medium
      }
    }
    .widgetURL(stop.flatMap { URL(string: "transmilive:///stop/\($0.id)") })
    .containerBackground(for: .widget) {
      // fondo con un degradado suave en vez de un color plano
      LinearGradient(
        colors: scheme == .dark ? [Color(hex: "#23232b"), Color(hex: "#0e0e12")] : [Color(hex: "#ffffff"), Color(hex: "#eef0f4")],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    }
  }

  // MARK: piezas

  /// Estado en una palabra, con su punto de color: en vivo (verde), programado (gris), demostración (morado) o dato viejo (ámbar).
  private var statusText: String {
    if isDemo { return "Demostración" }
    if isScheduled { return "Programado" }
    if ageMinutes >= 20 { return "Hace \(ageMinutes) min" }
    return "En vivo"
  }
  private var statusColor: Color {
    if isDemo { return Color(hex: "#8b5cf6") }
    if isScheduled { return Color.secondary }
    if ageMinutes >= 20 { return Color(hex: "#f59e0b") }
    return Color(hex: "#22c55e")
  }
  private var status: some View {
    HStack(spacing: 4) {
      Circle().fill(statusColor).frame(width: 6, height: 6)
      Text(statusText.uppercased()).font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary).lineLimit(1)
    }
  }
  /// El nombre de la parada, en letra ancha.
  private func title(_ size: CGFloat) -> some View {
    Text(stop?.name ?? "TransMi LIVE")
      .font(.system(size: size, weight: .heavy).width(.expanded))
      .lineLimit(1)
      .minimumScaleFactor(0.75)
  }
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
    guard let a = list.first else { return "TransMi LIVE" }
    return isScheduled ? "\(a.r) programado" : "\(a.r) llega pronto"
  }

  private var lockScreen: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(isDemo ? "Demostración" : (stop?.name ?? "TransMi LIVE")).font(.system(size: 14, weight: .heavy).width(.expanded)).lineLimit(1).minimumScaleFactor(0.8)
      if let a = list.first {
        HStack(spacing: 6) {
          Text(a.r).font(.system(size: 15, weight: .heavy, design: .rounded))
          Spacer(minLength: 4)
          Text(Date(timeIntervalSince1970: a.t), style: isScheduled ? .time : .timer).font(.system(size: 15, weight: .bold, design: .rounded)).monospacedDigit().multilineTextAlignment(.trailing)
        }
        if list.count > 1 {
          HStack(spacing: 6) {
            Text(list[1].r).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(Date(timeIntervalSince1970: list[1].t), style: isScheduled ? .time : .timer).font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit().multilineTextAlignment(.trailing).foregroundStyle(.secondary)
          }
        }
      } else {
        Text("Sin buses acercándose").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  /// Pequeño: el nombre, el próximo bus en grande y los dos siguientes.
  private var small: some View {
    VStack(alignment: .leading, spacing: 0) {
      if stop == nil {
        noStop
      } else {
        title(13)
        status.padding(.top, 3)
        Spacer(minLength: 4)
        if let first = list.first {
          NextBusHero(a: first, scheduled: isScheduled, timeSize: 28)
          Spacer(minLength: 4)
          // los dos siguientes si caben; en los teléfonos más pequeños, solo uno
          ViewThatFits(in: .vertical) {
            VStack(spacing: 4) {
              ForEach(Array(list.dropFirst().prefix(2)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: isScheduled) }
            }
            VStack(spacing: 4) {
              ForEach(Array(list.dropFirst().prefix(1)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: isScheduled) }
            }
          }
        } else {
          noBuses
          Spacer(minLength: 0)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// Mediano: a la izquierda el próximo bus en grande; a la derecha, los que siguen.
  private var medium: some View {
    Group {
      if stop == nil {
        noStop
      } else {
        HStack(alignment: .top, spacing: 14) {
          VStack(alignment: .leading, spacing: 0) {
            title(15)
            status.padding(.top, 4)
            Spacer(minLength: 6)
            if let first = list.first {
              NextBusHero(a: first, scheduled: isScheduled, timeSize: 36)
            } else {
              noBuses
            }
            Spacer(minLength: 0)
          }
          .frame(maxWidth: .infinity, alignment: .leading)

          if list.count > 1 {
            VStack(alignment: .leading, spacing: 0) {
              Text("LUEGO").font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(.secondary)
              Spacer(minLength: 6)
              VStack(spacing: 8) {
                ForEach(Array(list.dropFirst().prefix(4)), id: \.self) { ArrivalRow(a: $0, compact: true, scheduled: isScheduled) }
              }
              Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Widget

struct FavoriteStopWidget: Widget {
  let kind = "FavoriteStopWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in StopWidgetView(entry: entry) }
      .configurationDisplayName("Parada favorita")
      .description("Cuándo llegan los próximos buses a tu primera parada favorita.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
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

#Preview("Pequeño", as: .systemSmall) { FavoriteStopWidget() } timeline: { StopEntry(date: .now, snapshot: sample) }
#Preview("Mediano", as: .systemMedium) { FavoriteStopWidget() } timeline: { StopEntry(date: .now, snapshot: sample) }
#Preview("Pantalla de bloqueo", as: .accessoryRectangular) { FavoriteStopWidget() } timeline: { StopEntry(date: .now, snapshot: sample) }
#Preview("Sin favoritas", as: .systemSmall) { FavoriteStopWidget() } timeline: { StopEntry(date: .now, snapshot: nil) }
