/** Configuración de la app. El widget es opcional: solo se incluye al compilar con WIDGET=1, para que una falla en la extensión nunca bloquee una compilación normal. */
const GROUP = "group.com.transmilive.app";

module.exports = ({ config }) => {
  const widget = process.env.WIDGET === "1";
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(widget ? { appleTeamId: process.env.TEAM_ID } : {}),
      entitlements: { ...config.ios?.entitlements, ...(widget ? { "com.apple.security.application-groups": [GROUP] } : {}) },
    },
    plugins: [...(config.plugins ?? []), ...(widget ? ["@bacons/apple-targets"] : [])],
    extra: { ...config.extra, widget, widgetGroup: GROUP },
  };
};
