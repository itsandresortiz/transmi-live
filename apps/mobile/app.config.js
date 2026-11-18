/** Configuración de la app. El widget se incluye con WIDGET=1 (`scripts/testflight-local.sh` lo pone siempre, salvo WIDGET=0; el simulador y las capturas van sin él). */
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
    // TM_CAPTURAS=1: compilación solo para el simulador que saca capturas (scripts/capturas.sh): sin la pantalla de bienvenida
    extra: { ...config.extra, widget, widgetGroup: GROUP, capturas: process.env.TM_CAPTURAS === "1" },
  };
};
