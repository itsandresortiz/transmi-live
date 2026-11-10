/** Widget de la parada favorita. Comparte datos con la app por el App Group. */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "TransMiWidget",
  displayName: "TransMi LIVE",
  bundleIdentifier: ".widget",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit"],
  entitlements: { "com.apple.security.application-groups": ["group.com.transmilive.app"] },
  colors: { $accent: "#e11d2e", $widgetBackground: { color: "#ffffff", darkColor: "#16161a" } },
};
