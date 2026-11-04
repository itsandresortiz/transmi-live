import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@transmi/domain": r("./packages/domain/src/index.ts"),
      "@transmi/application": r("./packages/application/src/index.ts"),
      "@transmi/infrastructure": r("./packages/infrastructure/src/index.ts"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts", "test/**/*.test.ts"], environment: "node" },
});
