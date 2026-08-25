import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { repoPath } from "./testPaths";

describe("database migration safety", () => {
  it("disables legacy migration scripts that mutated or bypassed the journal", () => {
    for (const fileName of ["full_migrate.mjs", "run_all_migrations.mjs"]) {
      const source = fs.readFileSync(repoPath(fileName), "utf8");
      expect(source).toContain("已停用");
      expect(source).not.toMatch(/DELETE\s+FROM\s+__drizzle_migrations/i);
      expect(source).not.toMatch(/ER_DUP_FIELDNAME|ER_DUP_KEYNAME/);
    }
  });

  it("uses a locked, checksummed migration ledger and production opt-in", () => {
    const source = fs.readFileSync(repoPath("scripts/run-database-migrations.mjs"), "utf8");
    expect(source).toContain("GET_LOCK");
    expect(source).toContain("RELEASE_LOCK");
    expect(source).toContain("app_schema_migrations");
    expect(source).toContain("checksum");
    expect(source).toContain("ALLOW_PRODUCTION_MIGRATIONS");
    expect(source).toContain("status='failed'");
    expect(source).not.toMatch(/DELETE\s+FROM\s+__drizzle_migrations/i);
  });

  it("keeps the controlled migration plan complete and duplicate-free", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const plan = module.loadMigrationPlan();
    const migrationNames = plan.map((item: any) => item.fileName);
    expect(plan.length).toBeGreaterThan(80);
    expect(new Set(migrationNames).size).toBe(plan.length);
    expect(migrationNames).not.toContain("ops_plan_migration_fix.sql");
    expect(migrationNames.indexOf("0102a_emperor_core_registry.sql"))
      .toBeLessThan(migrationNames.indexOf("0103_emperor_agent_workflow.sql"));
    expect(plan.at(-1)?.fileName).toBe("0156_emperor_harness_completion.sql");
    expect(plan.every((item: any) => /^[a-f0-9]{64}$/.test(item.checksum))).toBe(true);
  });

  it("creates Emperor registries before governance migrations depend on them", () => {
    const sql = fs.readFileSync(repoPath("drizzle/0102a_emperor_core_registry.sql"), "utf8");
    for (const tableName of [
      "emperor_skills",
      "emperor_skill_runs",
      "emperor_knowledge",
      "emperor_mcp_connectors",
      "emperor_model_providers",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS \`${tableName}\``);
    }
  });

  it("creates listing and image support tables before index governance", () => {
    const sql = fs.readFileSync(repoPath("drizzle/0112a_listing_image_support_tables.sql"), "utf8");
    for (const tableName of [
      "buyer_questions",
      "competitor_image_analyses",
      "expression_groups",
      "expression_group_images",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS \`${tableName}\``);
    }
  });

  it("never alters or indexes a table before the governed plan creates it", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const createdTables = new Set<string>();
    const missingDependencies: string[] = [];

    for (const migration of module.loadMigrationPlan()) {
      const operations = [
        ...[...migration.sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?([A-Za-z0-9_$]+)`?/gi)]
          .map((match) => ({ type: "create", tableName: match[1], index: match.index ?? 0 })),
        ...[...migration.sql.matchAll(/ALTER TABLE\s+`?([A-Za-z0-9_$]+)`?/gi)]
          .map((match) => ({ type: "reference", tableName: match[1], index: match.index ?? 0 })),
        ...[...migration.sql.matchAll(/CREATE(?: UNIQUE)? INDEX\s+`?[A-Za-z0-9_$]+`?\s+ON\s+`?([A-Za-z0-9_$]+)`?/gi)]
          .map((match) => ({ type: "reference", tableName: match[1], index: match.index ?? 0 })),
      ].sort((left, right) => left.index - right.index);

      for (const operation of operations) {
        if (operation.type === "create") createdTables.add(operation.tableName);
        else if (!createdTables.has(operation.tableName)) {
          missingDependencies.push(`${migration.fileName}: ${operation.tableName}`);
        }
      }
    }

    expect(missingDependencies).toEqual([]);
  });

  it("only creates indexes over columns present at that migration point", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const tableColumns = new Map<string, Set<string>>();
    const invalidIndexes: string[] = [];

    for (const migration of module.loadMigrationPlan()) {
      const operations: Array<{
        type: "create" | "alter" | "index";
        tableName: string;
        index: number;
        body: string;
        indexName?: string;
      }> = [];
      for (const match of migration.sql.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+`?([A-Za-z0-9_$]+)`?\s*\(([\s\S]*?)\);/gi,
      )) {
        operations.push({ type: "create", tableName: match[1], body: match[2], index: match.index ?? 0 });
      }
      for (const match of migration.sql.matchAll(
        /ALTER TABLE\s+`?([A-Za-z0-9_$]+)`?([\s\S]*?);/gi,
      )) {
        operations.push({ type: "alter", tableName: match[1], body: match[2], index: match.index ?? 0 });
      }
      for (const match of migration.sql.matchAll(
        /CREATE(?: UNIQUE)? INDEX\s+`?([A-Za-z0-9_$]+)`?\s+ON\s+`?([A-Za-z0-9_$]+)`?\s*\(([^)]*)\)/gi,
      )) {
        operations.push({
          type: "index",
          indexName: match[1],
          tableName: match[2],
          body: match[3],
          index: match.index ?? 0,
        });
      }

      for (const operation of operations.sort((left, right) => left.index - right.index)) {
        if (operation.type === "create") {
          tableColumns.set(
            operation.tableName,
            new Set([...operation.body.matchAll(/^\s*`([^`]+)`\s+/gm)].map((match) => match[1])),
          );
          continue;
        }
        const columns = tableColumns.get(operation.tableName);
        if (!columns) continue;
        if (operation.type === "alter") {
          for (const match of operation.body.matchAll(/ADD(?:\s+COLUMN)?\s+`?([A-Za-z0-9_$]+)`?/gi)) columns.add(match[1]);
          for (const match of operation.body.matchAll(/DROP(?:\s+COLUMN)?(?:\s+IF\s+EXISTS)?\s+`?([A-Za-z0-9_$]+)`?/gi)) {
            columns.delete(match[1]);
          }
          continue;
        }
        const indexedColumns = [...operation.body.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
        for (const columnName of indexedColumns) {
          if (!columns.has(columnName)) {
            invalidIndexes.push(
              `${migration.fileName}: ${operation.indexName} -> ${operation.tableName}.${columnName}`,
            );
          }
        }
      }
    }

    expect(invalidIndexes).toEqual([]);
  });

  it("normalizes legacy conditional column drops for MySQL 8 without mutating migration files", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const execute = vi.fn(async (_query: string, values: string[]) => [
      [{ columnCount: values[1] === "legacy_column" ? 1 : 0 }],
    ]);
    const sql = [
      "ALTER TABLE sample DROP COLUMN IF EXISTS legacy_column;",
      "ALTER TABLE sample DROP COLUMN IF EXISTS missing_column;",
    ].join("\n");

    const executable = await module.prepareExecutableSql({ execute }, sql);

    expect(executable).toContain("ALTER TABLE `sample` DROP COLUMN `legacy_column`;");
    expect(executable).toContain("-- skipped missing column sample.missing_column");
    expect(executable).not.toContain("DROP COLUMN IF EXISTS");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("uses the real snake-case owner column for legacy workspace backfills", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const execute = vi.fn(async () => [[{ columnName: "user_id" }]]);
    const sql = [
      "UPDATE `production_config` t LEFT JOIN `users` u ON u.`id` = t.`userId`",
      "SET t.`workspaceId` = u.`defaultWorkspaceId`;",
    ].join(" ");

    const executable = await module.prepareExecutableSql({ execute }, sql);

    expect(executable).toContain("u.`id` = t.`user_id`");
    expect(executable).not.toContain("t.`userId`");
  });

  it("qualifies ambiguous no-op upserts with their target table", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const sql = [
      "INSERT INTO `workspaces` (`organizationId`, `slug`)",
      "SELECT `id`, 'default' FROM `organizations`",
      "ON DUPLICATE KEY UPDATE `updatedAt` = `updatedAt`;",
    ].join(" ");

    const executable = await module.prepareExecutableSql({ execute: vi.fn() }, sql);

    expect(executable).toContain("`updatedAt` = `workspaces`.`updatedAt`");
  });

  it("normalizes mixed collations in the legacy artifact backfill", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const sql = [
      "UPDATE `emperor_agent_artifacts` aa",
      "JOIN `ai_artifacts` ua ON ua.`sourceTable` = 'emperor_agent_artifacts'",
      "AND ua.`sourceRowId` = CAST(aa.`id` AS CHAR)",
      "SET aa.`unifiedArtifactId` = ua.`artifactId`;",
    ].join(" ");

    const executable = await module.prepareExecutableSql({ execute: vi.fn() }, sql);

    expect(executable).toContain(
      "CONVERT(ua.`sourceRowId` USING utf8mb4) COLLATE utf8mb4_unicode_ci",
    );
    expect(executable).toContain(
      "CONVERT(CAST(aa.`id` AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci",
    );
  });

  it("rejects future SQL migrations that are omitted from the release plan", () => {
    const source = fs.readFileSync(repoPath("scripts/run-database-migrations.mjs"), "utf8");
    expect(source).toContain("Migration files are not registered in the release plan");
    expect(source).toContain("readdirSync(drizzleDir)");
  });
});
