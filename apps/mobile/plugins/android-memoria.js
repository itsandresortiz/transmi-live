/** Le da más memoria a Gradle (la herramienta que arma la app de Android). Con la memoria que trae por defecto (512 MB para «Metaspace») la compilación
 *  de la versión release se queda sin memoria al empaquetar. Solo toca `android/gradle.properties`; en iOS no hace nada. */
const { withGradleProperties } = require("expo/config-plugins");

module.exports = (config) =>
  withGradleProperties(config, (c) => {
    const set = (key, value) => {
      const item = { type: "property", key, value };
      const i = c.modResults.findIndex((p) => p.type === "property" && p.key === key);
      if (i >= 0) c.modResults[i] = item; else c.modResults.push(item);
    };
    set("org.gradle.jvmargs", "-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8");
    return c;
  });
