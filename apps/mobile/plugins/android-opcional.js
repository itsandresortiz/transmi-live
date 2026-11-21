/** La app va siempre en vertical (`orientation: "portrait"`). En Android eso hace que Google Play entienda que la pantalla vertical es
 *  OBLIGATORIA y deja por fuera tabletas, computadores y Android XR («Las declaraciones de funciones de hardware obligatorias están
 *  restringiendo la disponibilidad», 2026-11-21). Se declara como opcional: la app sigue en vertical donde se pueda. Solo toca el
 *  manifiesto de Android; en iOS no hace nada. */
const { withAndroidManifest } = require("expo/config-plugins");

const OPTIONAL = ["android.hardware.screen.portrait", "android.hardware.screen.landscape"];

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m["uses-feature"] = m["uses-feature"] ?? [];
    for (const name of OPTIONAL) {
      const found = m["uses-feature"].find((f) => f.$?.["android:name"] === name);
      if (found) found.$["android:required"] = "false";
      else m["uses-feature"].push({ $: { "android:name": name, "android:required": "false" } });
    }
    return c;
  });
