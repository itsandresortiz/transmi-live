const { withEntitlementsPlist } = require("expo/config-plugins");

/** Los avisos del viaje son notificaciones locales: no hace falta el permiso de notificaciones remotas (push), que obligaría a activarlo en la cuenta de Apple. */
module.exports = (config) => withEntitlementsPlist(config, (c) => { delete c.modResults["aps-environment"]; return c; });
