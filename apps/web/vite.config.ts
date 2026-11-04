import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Ruta relativa: funciona igual en GitHub Pages (/transmi-live/), en dominio propio y dentro de una app.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@transmi/domain": r("../../packages/domain/src/index.ts"),
      "@transmi/application": r("../../packages/application/src/index.ts"),
      "@transmi/infrastructure": r("../../packages/infrastructure/src/index.ts"),
    },
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ["maplibre-gl"], react: ["react", "react-dom"] },
      },
    },
  },
});
