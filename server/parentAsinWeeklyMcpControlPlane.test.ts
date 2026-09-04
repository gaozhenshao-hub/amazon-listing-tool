import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/0194_parent_asin_weekly_mcp_auto_apply.sql"), "utf8");

describe("父ASIN周报MCP自动应用控制面迁移", () => {
  it("仅为启用的父ASIN周报MCP任务打开自动应用，不重写历史批次或旧周任务", () => {
    expect(migration).toContain("SET `auto_apply` = 1");
    expect(migration).toContain("WHERE `data_domain` = 'parent_asin_weekly_mcp'");
    expect(migration).toContain("AND `enabled` = 1");
    expect(migration).toContain("'$.autoApply', TRUE");
    expect(migration).not.toContain("parent_asin_weekly_rollup");
    expect(migration).not.toContain("lingxing_product_weekly");
    expect(migration).not.toContain("ops_external_sync_batches");
  });

  it("将既有MCP周报计划投影至皇帝而不创建第二个任务UID", () => {
    const projectionMigration = readFileSync(resolve(process.cwd(), "drizzle/0195_parent_asin_weekly_mcp_emperor_projection.sql"), "utf8");
    expect(projectionMigration).toContain("FROM ops_lingxing_sync_schedules s");
    expect(projectionMigration).toContain("'parent_asin_weekly_mcp'");
    expect(projectionMigration).toContain("s.schedule_cron_task_uid");
    expect(projectionMigration).not.toContain("createHeartbeatJob");
    expect(projectionMigration).toContain("ON DUPLICATE KEY UPDATE");
  });
});
