/** Configuración de la app. El widget es opcional: solo se incluye al compilar con WIDGET=1, para que una falla en la extensión nunca bloquee una compilación normal. */
const GROUP = "group.com.transmilive.app";

module.exports = ({ config }) => {
  const widget = process.env.WIDGET === "1";
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(widget ? { appleTeamId: process.env.TEAM_ID } : {}),
      // Apple exige un número de compilación distinto en cada entrega: el script lo pone con la fecha y la hora (vale para la app y para el widget)
      ...(process.env.TM_BUILD_NUMBER ? { buildNumber: process.env.TM_BUILD_NUMBER } : {}),
      entitlements: { ...config.ios?.entitlements, ...(widget ? { "com.apple.security.application-groups": [GROUP] } : {}) },
    },
    // Google Play exige que cada paquete que se sube tenga un número mayor que el anterior: el script de la tienda lo pone con la fecha y la hora
    android: { ...config.android, ...(process.env.TM_VERSION_CODE ? { versionCode: Number(process.env.TM_VERSION_CODE) } : {}) },
    plugins: [...(config.plugins ?? []), ...(widget ? ["@bacons/apple-targets"] : [])],
    extra: { ...config.extra, widget, widgetGroup: GROUP },
  };
};
