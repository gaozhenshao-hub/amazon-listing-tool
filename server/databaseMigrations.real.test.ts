import fs from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DATABASE_PERFORMANCE_BASELINES, MIGRATION_REGRESSION_BASELINE } from "./repositories/dbGovernance";
import { requireDb } from "./repositories/dbClient";
import { sampleDatabaseSlowQueries } from "./repositories/database";
import { repoPath } from "./testPaths";

function normalizeRows(result: any): any[] {
  if (Array.isArray(result)) return Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function sqlList(values: string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
}

describe("real database migration regression", () => {
  it("has every governed migration file in the release artifact", () => {
    for (const migration of MIGRATION_REGRESSION_BASELINE.requiredMigrations) {
      expect(fs.existsSync(repoPath("drizzle", migration)), migration).toBe(true);
    }
  });

  it("verifies required tables and indexes against the migrated database", async () => {
    const db = await requireDb("Real migration regression");
    const tableResult = await db.execute(sql.raw(
      `SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${sqlList(MIGRATION_REGRESSION_BASELINE.requiredTables)})`,
    ));
    const existingTables = new Set(normalizeRows(tableResult).map((row) => String(row.tableName)));
    expect([...existingTables].sort()).toEqual([...MIGRATION_REGRESSION_BASELINE.requiredTables].sort());

    const indexNames = [...new Set(MIGRATION_REGRESSION_BASELINE.requiredIndexes)];
    const indexResult = await db.execute(sql.raw(
      `SELECT DISTINCT INDEX_NAME AS indexName FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN (${sqlList(indexNames)})`,
    ));
    const existingIndexes = new Set(normalizeRows(indexResult).map((row) => String(row.indexName)));
    for (const baseline of DATABASE_PERFORMANCE_BASELINES) {
      expect(
        baseline.expectedIndexNames.some((indexName) => existingIndexes.has(indexName)),
        `${baseline.slug} requires one of: ${baseline.expectedIndexNames.join(", ")}`,
      ).toBe(true);
    }
  });

  it("verifies every 0116 workspace column and index was applied", async () => {
    const db = await requireDb("Ops workspace migration regression");
    const migration = fs.readFileSync(repoPath("drizzle/0116_ops_workspace_isolation.sql"), "utf8");
    const tableNames = [...migration.matchAll(/ALTER TABLE `([^`]+)` ADD COLUMN `workspaceId`/g)].map((match) => match[1]);
    const indexNames = [...migration.matchAll(/CREATE INDEX `([^`]+)`/g)].map((match) => match[1]);
    expect(tableNames.length).toBeGreaterThan(20);
    expect(indexNames.length).toBe(tableNames.length);

    const columnResult = await db.execute(sql.raw(
      `SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'workspaceId'
         AND TABLE_NAME IN (${sqlList(tableNames)})`,
    ));
    const workspaceTables = new Set(normalizeRows(columnResult).map((row) => String(row.tableName)));
    expect([...workspaceTables].sort()).toEqual([...new Set(tableNames)].sort());

    const indexResult = await db.execute(sql.raw(
      `SELECT DISTINCT INDEX_NAME AS indexName FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN (${sqlList(indexNames)})`,
    ));
    const workspaceIndexes = new Set(normalizeRows(indexResult).map((row) => String(row.indexName)));
    expect([...workspaceIndexes].sort()).toEqual([...new Set(indexNames)].sort());
  });

  it("can read performance_schema and persist a normalized slow-query sample", async () => {
    const result = await sampleDatabaseSlowQueries({ minimumAverageMs: 1, limit: 5 });
    expect(result.available, "performance_schema access and migration 0117 are required").toBe(true);
    if (result.available) {
      expect(result.samples.every((sample) => sample.digestText.trim().length > 0)).toBe(true);
      expect(result.samples.every((sample) => sample.metadata.normalizedDigest === true)).toBe(true);
    }
  });
});
