import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrationPlan } from "./run-database-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessMigrations = [
  "0153_emperor_run_ledger_v2.sql",
  "0154_emperor_skill_quality_gates.sql",
  "0155_emperor_skill_feedback_rollouts.sql",
  "0156_emperor_harness_completion.sql",
];

describe("皇帝Harness迁移回滚源收敛契约", () => {
  it("将生产已应用的0153–0156保留在托管源码并注册在迁移发布计划", () => {
    const plan = loadMigrationPlan().map((migration) => migration.fileName);
    for (const fileName of harnessMigrations) {
      expect(existsSync(resolve(root, "drizzle", fileName))).toBe(true);
      expect(plan).toContain(fileName);
    }
  });
});
