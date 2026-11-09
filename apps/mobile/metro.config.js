// Los paquetes del dominio, la aplicación y la infraestructura se comparten con la web: viven fuera de esta carpeta.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, "packages")];
config.resolver.disableHierarchicalLookup = true;                         // solo los módulos de esta app (no los de la raíz de la web)
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];
config.resolver.extraNodeModules = {
  "@transmi/domain": path.join(root, "packages/domain"),
  "@transmi/application": path.join(root, "packages/application"),
  "@transmi/infrastructure": path.join(root, "packages/infrastructure"),
};

module.exports = config;
