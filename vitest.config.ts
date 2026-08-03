import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);
const includeRealIntegrationTests = process.env.RUN_REAL_DB_TESTS === "1" || process.env.RUN_REAL_LLM_TESTS === "1";
const realIntegrationTestFiles = [
  "server/**/*.real.test.ts",
  "server/adLocalAnalysis.test.ts",
  "server/devManualEnhanced.test.ts",
  "server/kbTags.test.ts",
  "server/listing-bilingual.test.ts",
  "server/offsite.test.ts",
  "server/phase3.test.ts",
  "server/videoScript.test.ts",
];

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    exclude: includeRealIntegrationTests
      ? ["node_modules", "dist"]
      : ["node_modules", "dist", ...realIntegrationTestFiles],
  },
});
