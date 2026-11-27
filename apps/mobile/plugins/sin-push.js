const { withEntitlementsPlist } = require("expo/config-plugins");

/** Los avisos del viaje son notificaciones locales: no hace falta el permiso de notificaciones remotas (push), que obligaría a activarlo en la cuenta de Apple.
 *  Con TM_PUSH=1 se conserva (avisos del viaje desde el servidor; antes hay que activar «Push Notifications» en el App ID: ver supabase/LEEME-avisos.md). */
module.exports = (config) => withEntitlementsPlist(config, (c) => { if (process.env.TM_PUSH !== "1") delete c.modResults["aps-environment"]; return c; });
