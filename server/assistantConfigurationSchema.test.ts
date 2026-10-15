import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { getTableConfig, MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import {
  emperorAssistantConfigurations, emperorAssistantConfigurationVersions,
} from "../drizzle/schema/assistantConfigurations";

// Independent, source-only schema/registration review. This does not import the
// runner (dotenv/mysql2), connect to a database or execute any migration SQL.
const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const migrationName = "0230_assistant_configurations.sql";
const migration = read(`drizzle/${migrationName}`);
const runner = read("scripts/run-database-migrations.mjs");
const ddl = migration.replace(/^--.*$/gm, "").trim();
const statements = ddl.split(";").map(value => value.trim()).filter(Boolean);
const tables = [emperorAssistantConfigurations, emperorAssistantConfigurationVersions].map(getTableConfig);
const expectedNames = ["emperor_assistant_configurations", "emperor_assistant_configuration_versions"];

function columnsFromSql(statement: string) {
  return [...statement.matchAll(/^\s+`([^`]+)` (int|json|char\(64\)|varchar\(32\)|timestamp)([^\n]*),?$/gm)]
    .map(([, name, type, suffix]) => ({ name, type, notNull: suffix.includes("NOT NULL"),
      autoIncrement: suffix.includes("AUTO_INCREMENT"), defaultNow: suffix.includes("DEFAULT CURRENT_TIMESTAMP"),
      onUpdate: suffix.includes("ON UPDATE CURRENT_TIMESTAMP") }));
}

describe("assistant configuration independent schema and opt-in registration", () => {
  it("has only two plain additive CREATE statements, never seeds or a same-name no-op", () => {
    expect(migration).toMatch(/DEDICATED RELEASE ONLY/);
    expect(statements).toHaveLength(2);
    expect(statements.map(value => /^CREATE TABLE `([^`]+)` \(/.exec(value)?.[1])).toEqual(expectedNames);
    expect(ddl).not.toMatch(/\b(?:INSERT|DELETE|REPLACE|ALTER|DROP|TRUNCATE|GRANT|CALL|USE|IF NOT EXISTS)\b/i);
    // UPDATE is valid in the timestamp clause; executable DML is checked below.
  });

  it.each([0, 1])("table %i has the same complete ordered SQL/ORM columns and defaults", index => {
    const dialect = new MySqlDialect();
    const actual = tables[index].columns.map(column => ({
      name: column.name, type: column.getSQLType(), notNull: column.notNull,
      autoIncrement: "autoIncrement" in column && column.autoIncrement === true,
      defaultNow: column.default !== undefined
        && ["now()", "(now())", "CURRENT_TIMESTAMP"].includes(dialect.sqlToQuery(column.default as SQL).sql),
      onUpdate: "hasOnUpdateNow" in column && column.hasOnUpdateNow === true,
    }));
    expect(actual).toEqual(columnsFromSql(statements[index]));
    expect(actual).toHaveLength(9);
    expect(tables[index].columns.filter(column => column.primary).map(column => column.name)).toEqual(["id"]);
    expect(statements[index]).toContain("PRIMARY KEY (`id`)");
    expect(tables[index].foreignKeys).toEqual([]);
  });

  it("enforces exactly the scoped current and immutable-version unique keys", () => {
    const expected = [
      { name: "uq_assistant_configuration_scope", columns: ["workspaceId", "agentKey"] },
      { name: "uq_assistant_configuration_version_scope", columns: ["workspaceId", "agentKey", "revision"] },
    ];
    tables.forEach((table, index) => {
      expect(table.indexes).toHaveLength(1);
      const key = table.indexes[0].config;
      expect(key.unique).toBe(true);
      expect(key.name).toBe(expected[index].name);
      expect(key.columns.map(column => "name" in column ? column.name : null)).toEqual(expected[index].columns);
      expect(statements[index]).toContain(`UNIQUE KEY \`${key.name}\` (${expected[index].columns.map(name => `\`${name}\``).join(",")})`);
    });
  });

  it("requires transactional tables, explicit binary collation and no revision defaults", () => {
    for (const statement of statements) {
      expect(statement).toMatch(/\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin$/);
      expect(statement).toMatch(/`revision` int NOT NULL,/);
      expect(statement).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CALL|USE)\b/im);
    }
    expect(columnsFromSql(statements[0]).every(column => column.notNull)).toBe(true);
    expect(columnsFromSql(statements[1]).filter(column => !column.notNull).map(column => column.name)).toEqual(["sourceRevision"]);
    expect(statements[1]).toContain("`sourceRevision` int DEFAULT NULL");
  });

  it("repository persisted projections refer to exactly the declared non-id fields", () => {
    const repository = read("server/domains/ai_os/repositories/assistantConfigurations.ts");
    const current = /const currentColumns = "([^"]+)";/.exec(repository)![1].split(",");
    const version = /const versionColumns = "([^"]+)";/.exec(repository)![1].split(",");
    expect(current).toEqual(tables[0].columns.map(column => column.name).filter(name => name !== "id"));
    expect(version).toEqual(tables[1].columns.map(column => column.name).filter(name => name !== "id"));
  });

  it("adds only explicit schema barrel exports, without initialization", () => {
    const index = read("drizzle/schema/index.ts");
    expect(index.split("\n").filter(line => line.includes("assistantConfigurations"))).toEqual([
      'export * from "./assistantConfigurations";',
      'export * as assistantConfigurationsSchema from "./assistantConfigurations";',
    ]);
    expect(read("drizzle/schema/assistantConfigurations.ts")).not.toMatch(/createConnection|\.execute\(|\.query\(|process\.env|INSERT INTO/);
  });

  it("keeps the exact original 168-name default plan and all existing dedicated plans separate", () => {
    const start = runner.indexOf("const supplementalMigrations =");
    const end = runner.indexOf("function migrationEntries(");
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const journal = JSON.parse(read("drizzle/meta/_journal.json"));
    // Evaluate only the already-reviewed literal registration arrays; neither
    // runner imports, main, migrationEntries nor any driver function is loaded.
    const encoded = runInNewContext(`${runner.slice(start, end)}\nJSON.stringify({
      names:[...journal.entries.map(entry => entry.tag+'.sql'),...supplementalMigrations],
      drafts:[...unreleasedDraftMigrationFiles], dedicated:dedicatedMigrationFiles,
      development:imageQualityDevelopmentMigrationFiles,production:imageQualityProductionMigrationFiles
    })`, { journal }, { timeout: 1000 });
    const registration = JSON.parse(encoded);
    expect(registration.names).toHaveLength(168);
    expect(sha(JSON.stringify(registration.names))).toBe("039e2f258033e914011b1690c2e908c82f1a2d06458c12246e133f66274e1d4d");
    for (const field of ["names", "dedicated", "development", "production"]) expect(registration[field]).not.toContain(migrationName);
    expect(registration.drafts).toContain(migrationName);
  });

  it.each(["scripts/run-database-migrations.mjs", "drizzle/schema/index.ts"])("keeps fresh-bootstrap source admission coherent with the reviewed %s", path => {
    const manifest = JSON.parse(read("drizzle/bootstrap/manifest.json"));
    const pins = manifest.sources.filter((item: { path: string }) => item.path === path);
    expect(pins).toHaveLength(1);
    // This is only the public source admission check, not a fresh DB bootstrap.
    expect(pins[0].sha256).toBe(sha(read(path)));
  });

  it("exposes only a read-only one-file plan loader, with no assistant CLI apply branch", () => {
    const match = /export function loadAssistantConfigurationMigrationPlan\(\) \{([\s\S]*?)\n\}/.exec(runner);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe('return migrationEntries(["0230_assistant_configurations.sql"], 0);');
    const calls: unknown[] = [];
    const result = runInNewContext(`(function(){${match![1]}})()`, {
      migrationEntries(files: string[], officialCount: number) {
        calls.push({ files: [...files], officialCount });
        return files.map((fileName, order) => ({ order, fileName, sql: read(`drizzle/${fileName}`), checksum: sha(read(`drizzle/${fileName}`)), official: order < officialCount }));
      },
    }, { timeout: 1000 });
    expect(calls).toEqual([{ files: [migrationName], officialCount: 0 }]);
    expect(result).toEqual([{ order: 0, fileName: migrationName, sql: migration, checksum: sha(migration), official: false }]);
    const main = runner.slice(runner.indexOf("async function main()"));
    expect(main).not.toMatch(/loadAssistantConfigurationMigrationPlan|0230|assistant/i);
  });
});
