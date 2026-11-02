import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
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
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.spec.ts",
      "client/src/**/*.test.tsx",
      "client/src/**/*.spec.tsx",
    ],
    exclude: includeRealIntegrationTests
      ? ["node_modules", "dist"]
      : ["node_modules", "dist", ...realIntegrationTestFiles],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "client/src/lib/appError.ts",
        "client/src/components/workflow/workflowUtils.ts",
        "client/src/pages/listing/GenerationIndicators.tsx",
        "client/src/pages/imageWorkflow/StepProgressBar.tsx",
        "shared/_core/errors.ts",
        "server/_core/appError.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
