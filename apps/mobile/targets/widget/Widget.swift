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
      if let remote, Date().timeIntervalSince1970 - remote.at < 600, remote.at > (local?.at ?? 0) {
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
    // iOS decide cada cuánto deja refrescar; se le pide cada 5 min
    return Timeline(entries: entries, policy: .after(now.addingTimeInterval(5 * 60)))
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

struct RouteBadge: View {
  @Environment(\.widgetRenderingMode) private var mode
  let a: Arrival
  var body: some View {
    if mode == .fullColor {
      Text(a.r)
        .font(.system(size: 13, weight: .heavy, design: .rounded))
        .foregroundStyle(.white)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Color(hex: a.c), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    } else {
      // con el tinte o el modo transparente de iOS los colores se aplanan: un recuadro relleno taparía el texto, así que va en contorno
      Text(a.r)
        .font(.system(size: 13, weight: .heavy, design: .rounded))
        .foregroundStyle(.primary)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Color.primary, lineWidth: 1.5))
        .widgetAccentable()
    }
  }
}

struct ArrivalRow: View {
  let a: Arrival
  let compact: Bool
  var scheduled: Bool = false   // hora del horario (no es un bus en vivo): se muestra como hora, no como cuenta regresiva
  var body: some View {
    HStack(spacing: 8) {
      RouteBadge(a: a)
      if !compact {
        Text(a.h).font(.system(size: 13, weight: .medium)).lineLimit(1).foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      // en vivo: cuenta regresiva que corre sola, con segundos; programado: la hora
      Text(Date(timeIntervalSince1970: a.t), style: scheduled ? .time : .timer)
        .font(.system(size: compact ? 15 : 17, weight: .bold, design: .rounded))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 64, alignment: .trailing)
    }
  }
}

struct StopWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: StopEntry

  private var stop: StopData? { entry.snapshot?.stops.first }
  private var upcoming: [Arrival] { (stop?.arrivals ?? []).filter { Date(timeIntervalSince1970: $0.t) > entry.date }.sorted { $0.t < $1.t } }
  private var planned: [Arrival] { (stop?.sched ?? []).filter { Date(timeIntervalSince1970: $0.t) > entry.date }.sorted { $0.t < $1.t } }
  private var isDemo: Bool { entry.snapshot?.demo == true }
  private var ageMinutes: Int { Int(max(0, Date().timeIntervalSince1970 - (entry.snapshot?.at ?? 0)) / 60) }

  var body: some View {
    Group {
      switch family {
      case .accessoryRectangular: lockScreen
      case .accessoryInline: Text(inline)
      default: home
      }
    }
    .widgetURL(stop.flatMap { URL(string: "transmilive:///stop/\($0.id)") })
    .containerBackground(.background, for: .widget)
  }

  private var inline: String {
    guard let a = upcoming.first else { return "TransMi LIVE" }
    return "\(a.r) llega pronto"
  }

  private var lockScreen: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(isDemo ? "Demostración" : (stop?.name ?? "TransMi LIVE")).font(.headline).lineLimit(1)
      if let a = upcoming.first {
        HStack { Text(a.r).bold(); Spacer(); Text(Date(timeIntervalSince1970: a.t), style: .timer).monospacedDigit() }
      } else if let p = planned.first {
        HStack { Text(p.r).bold(); Spacer(); Text(Date(timeIntervalSince1970: p.t), style: .time) }
      } else {
        Text("Sin buses acercándose").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var home: some View {
    VStack(alignment: .leading, spacing: 8) {
      if stop == nil {
        VStack(alignment: .leading, spacing: 6) {
          Image(systemName: "star.fill").foregroundStyle(Color.accentColor)
          Text("Guarda una parada").font(.headline)
          Text("Márcala con la estrella en TransMi LIVE y aparecerá aquí.").font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
      } else {
        HStack(spacing: 6) {
          Image(systemName: "mappin.circle.fill").foregroundStyle(Color.accentColor)
          Text(stop!.name).font(.system(size: 15, weight: .bold)).lineLimit(1)
        }
        if upcoming.isEmpty && !planned.isEmpty {
          // sin dato en vivo vigente: lo que dice el horario, rotulado como programado
          VStack(spacing: 7) {
            ForEach(Array(planned.prefix(family == .systemSmall ? 3 : 4)), id: \.self) { ArrivalRow(a: $0, compact: family == .systemSmall, scheduled: true) }
          }
          Spacer(minLength: 0)
          Text("Programado · abre la app para ver en vivo").font(.caption2).foregroundStyle(.secondary)
        } else if upcoming.isEmpty {
          Text("Sin buses acercándose ahora").font(.subheadline).foregroundStyle(.secondary)
          Spacer(minLength: 0)
        } else {
          VStack(spacing: 7) {
            ForEach(Array(upcoming.prefix(family == .systemSmall ? 3 : 4)), id: \.self) { ArrivalRow(a: $0, compact: family == .systemSmall) }
          }
          Spacer(minLength: 0)
        }
        if upcoming.isEmpty && !planned.isEmpty {
          EmptyView()
        } else if isDemo {
          Text("Demostración · buses de ejemplo").font(.caption2.weight(.semibold)).foregroundStyle(Color(hex: "#8b5cf6"))
        } else if ageMinutes >= 20 {
          Text("Datos de hace \(ageMinutes) min · abre la app").font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
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
