import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Viaje en curso en la pantalla de bloqueo y la isla dinámica

/// OJO: esta estructura está repetida, idéntica, en `modules/tripactivity/ios/TripActivityModule.swift` (la app la crea, aquí se dibuja).
struct TripActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var detail: String
    var badge: String
    var color: String
    var until: Double
    var untilLabel: String
    var step: Int
    var steps: Int
    var arrive: Double
    var link: String         // a dónde lleva al tocarla (transmilive:///trip o transmilive:///ride/ID)
  }
  var dest: String
}

/// Cuenta regresiva hasta `until`; al llegar a cero se queda en «ahora» (no cuenta hacia arriba).
struct TripCountdown: View {
  let until: Double
  var body: some View {
    let end = Date(timeIntervalSince1970: until)
    if until > 0 && end > Date() {
      Text(timerInterval: Date()...end, countsDown: true)
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    } else {
      Text("ahora")
    }
  }
}

struct TripBadge: View {
  let state: TripActivityAttributes.ContentState
  var body: some View {
    if state.badge.isEmpty {
      Image(systemName: "figure.walk").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
    } else {
      Text(state.badge)
        .font(.system(size: 13, weight: .heavy, design: .rounded))
        .foregroundStyle(.white)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Color(hex: state.color), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
  }
}

struct TripLockView: View {
  let state: TripActivityAttributes.ContentState
  let dest: String
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        TripBadge(state: state)
        Text(state.title).font(.system(size: 16, weight: .bold)).foregroundStyle(.white).lineLimit(2)
        Spacer(minLength: 6)
        VStack(alignment: .trailing, spacing: 0) {
          Text(state.untilLabel).font(.caption2).foregroundStyle(.white.opacity(0.7))
          TripCountdown(until: state.until).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(.white).frame(maxWidth: 84, alignment: .trailing)
        }
      }
      Text(state.detail).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
      HStack(spacing: 6) {
        ProgressView(value: Double(min(max(state.step, 0), max(state.steps, 1))), total: Double(max(state.steps, 1))).tint(Color(hex: "#e11d2e"))
        Text("Paso \(state.step) de \(state.steps)").font(.caption2).foregroundStyle(.white.opacity(0.7))
      }
      if !dest.isEmpty && state.arrive > 0 {
        Text("Hacia \(dest) · llegas \(Date(timeIntervalSince1970: state.arrive), style: .time)").font(.caption2).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
      }
    }
    .padding(14)
  }
}

struct TripLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TripActivityAttributes.self) { context in
      TripLockView(state: context.state, dest: context.attributes.dest)
        .activityBackgroundTint(Color.black.opacity(0.82))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: context.state.link))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { TripBadge(state: context.state) }
        DynamicIslandExpandedRegion(.trailing) {
          TripCountdown(until: context.state.until).font(.system(size: 18, weight: .bold, design: .rounded)).frame(maxWidth: 76, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 2) {
            Text(context.state.title).font(.system(size: 15, weight: .bold)).lineLimit(1)
            Text(context.state.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        TripBadge(state: context.state)
      } compactTrailing: {
        TripCountdown(until: context.state.until).font(.system(size: 13, weight: .bold, design: .rounded)).frame(maxWidth: 48)
      } minimal: {
        Image(systemName: "bus.fill")
      }
      .widgetURL(URL(string: context.state.link))
    }
  }
}
