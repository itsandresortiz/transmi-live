/** Firma de la app para Google Play. La tienda solo recibe paquetes firmados con la llave de subida del dueño, que vive en su Mac
 *  (nunca en el repositorio). Si al compilar existen las variables TM_UPLOAD_STORE, TM_UPLOAD_ALIAS y TM_UPLOAD_PASS, la versión release
 *  se firma con esa llave; si no (emulador), se firma con la de pruebas, como siempre. Solo toca `android/app/build.gradle`. */
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING = `
        release {
            if (System.getenv("TM_UPLOAD_STORE")) {
                storeFile file(System.getenv("TM_UPLOAD_STORE"))
                storePassword System.getenv("TM_UPLOAD_PASS")
                keyAlias System.getenv("TM_UPLOAD_ALIAS")
                keyPassword System.getenv("TM_UPLOAD_PASS")
            }
        }`;

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes("TM_UPLOAD_STORE")) return c;
    const a = g.indexOf("signingConfigs {");
    if (a < 0) throw new Error("android-firma: no encontré signingConfigs en build.gradle");
    g = g.slice(0, a + "signingConfigs {".length) + SIGNING + g.slice(a + "signingConfigs {".length);
    // dentro de buildTypes › release, la firma pasa a ser la de subida cuando está la llave
    const b = g.indexOf("buildTypes {"), r = g.indexOf("release {", b), s = g.indexOf("signingConfig signingConfigs.debug", r);
    if (b < 0 || r < 0 || s < 0) throw new Error("android-firma: no encontré la firma de release en build.gradle");
    g = g.slice(0, s) + 'signingConfig System.getenv("TM_UPLOAD_STORE") ? signingConfigs.release : signingConfigs.debug' + g.slice(s + "signingConfig signingConfigs.debug".length);
    c.modResults.contents = g;
    return c;
  });
