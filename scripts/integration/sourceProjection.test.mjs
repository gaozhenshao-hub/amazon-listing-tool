import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  EXCLUDED_TABLES, PROJECTION_VERSION, auditSchemaSources, buildProjection,
  exportSourceProjection, inspectSchemaModule, main, normalizeCreateStatement, parseArguments, selectProjectionTables, writeProjection,
} from "./sourceProjection.mjs";

const require = createRequire(import.meta.url), ts = require("typescript");
const repository = fileURLToPath(new URL("../../", import.meta.url));
const isTable = value => value.table === true;
const getTableName = value => value.name;
const table = name => ({ table: true, name });
const exportsFixture = () => ({ users: table("users"), ...Object.fromEntries(EXCLUDED_TABLES.map((name, i) => [`renamedDraftExport${i}`, table(name)])) });
const schemaFile = "drizzle/schema/example.ts";
const declaration = 'import { mysqlTable, int, varchar, index } from "drizzle-orm/mysql-core";\nexport const example = mysqlTable("example", { id: int("id").primaryKey(), name: varchar("name", { length: 80 }).notNull() }, table => [index("ix").on(table.name)]);';
const buildFixture = overrides => buildProjection({ exports: exportsFixture(), isTable, getTableName,
  generateSnapshot: async tables => ({ tables }),
  generateMigration: async () => ['CREATE TABLE `users` (`id` int);', 'CREATE INDEX `ix` ON `users` (`id`);'],
  sourceFiles: [{ path: schemaFile, sha256: "a".repeat(64) }], versions: { node: "synthetic", drizzleKit: "synthetic" }, ...overrides });
function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "source-projection-test-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("admits only reviewed declarative schema syntax and local schema re-exports", () => {
  assert.deepEqual(inspectSchemaModule(declaration, schemaFile, ts), []);
  assert.deepEqual(inspectSchemaModule('export * from "./auth"; export * as authSchema from "./auth";', "drizzle/schema/index.ts", ts), ["drizzle/schema/auth.ts"]);
  assert.deepEqual(inspectSchemaModule('import { mysqlTable, int } from "drizzle-orm/mysql-core"; import { currentOpsWorkspaceId } from "../../server/domains/ops/workspaceContext"; export const t = mysqlTable("t", { workspace: int("workspace").$defaultFn(currentOpsWorkspaceId) });', schemaFile, ts), ["server/domains/ops/workspaceContext.ts"]);
});

test("rejects env/DB/network imports and top-level side effects before importing TS", () => {
  for (const input of [
    'import "dotenv/config";', 'import { createConnection } from "mysql2/promise";',
    'import { fetch } from "undici";', 'export * from "../../server/db";',
    `${declaration}\nfetch("https://example.test");`, `${declaration}\nconst extra = process.env.DATABASE_URL;`,
    `${declaration}\nexport const other = await import("./unsafe");`,
  ]) assert.throws(() => inspectSchemaModule(input, schemaFile, ts));
});

test("rejects hidden expression execution, globals, getters and unreviewed callbacks", () => {
  for (const expression of ['process.env.SECRET', 'fetch("https://example.test")', '(()=>{throw new Error("run")})()',
    'new Date()', '{ get value() { return 1; } }', 'globalThis["fetch"]("x")', 'int("id").$defaultFn(() => 1)']) {
    assert.throws(() => inspectSchemaModule(`import { mysqlTable, int } from "drizzle-orm/mysql-core"; export const t = mysqlTable("t", { id: ${expression} });`, schemaFile, ts));
  }
});

test("audits the actual source import closure without importing it or loading .env", () => {
  const sources = auditSchemaSources(repository.replace(/\/$/, ""), ts);
  assert.equal(sources.length, 18);
  assert.ok(sources.some(item => item.path === "server/domains/ops/workspaceContext.ts"));
  assert.ok(sources.every(item => /^[a-f0-9]{64}$/.test(item.sha256) && !item.path.includes(".env")));
});

test("excludes all five physical draft table names regardless of export aliases", () => {
  const namespace = Object.create(null); namespace.users = table("hidden_namespace_user");
  const result = selectProjectionTables({ ...exportsFixture(), namespace, nil: null, string: "not a table" }, isTable, getTableName);
  assert.deepEqual(result.tableNames, ["users"]);
  assert.deepEqual(result.excludedTables, EXCLUDED_TABLES);
  assert.deepEqual(Object.keys(result.tables), ["users"]);
  assert.equal(Object.isFrozen(EXCLUDED_TABLES), true);
});

test("fails closed on missing draft definitions, no tables, duplicates or unsafe table names", () => {
  assert.throws(() => selectProjectionTables({ users: table("users") }, isTable, getTableName), /DRAFT_EXCLUSION_SOURCE_CHANGED/);
  assert.throws(() => selectProjectionTables({}, isTable, getTableName), /NO_TABLES_FOUND/);
  assert.throws(() => selectProjectionTables({ ...exportsFixture(), duplicate: table("users") }, isTable, getTableName), /DUPLICATE_TABLE_EXPORT/);
  assert.throws(() => selectProjectionTables({ ...exportsFixture(), unsafe: table("users; DROP") }, isTable, getTableName), /TABLE_NAME_INVALID/);
});

test("generates strictly empty-to-filtered snapshots and honest, hash-bound metadata", async () => {
  const inputs = [];
  const result = await buildFixture({ generateSnapshot: async tables => { inputs.push(tables); return { tables }; } });
  assert.deepEqual(inputs[0], {});
  assert.deepEqual(Object.keys(inputs[1]), ["users"]);
  assert.equal(result.metadata.version, PROJECTION_VERSION);
  assert.equal(result.metadata.productionClone, false);
  assert.equal(result.metadata.databaseConnected, false);
  assert.equal(result.metadata.sqlExecuted, false);
  assert.equal(result.metadata.migrationLedgerWritten, false);
  assert.equal(result.metadata.tableCount, 1);
  assert.equal(result.metadata.ddlCount, 2);
  assert.equal(result.metadata.sqlSha256, createHash("sha256").update(result.sql).digest("hex"));
  assert.ok(result.sql.startsWith("-- SOURCE-DERIVED PROJECTION ONLY"));
  assert.ok(!result.sql.includes("app_schema_migrations"));
});

test("rejects destructive/non-DDL generator output rather than producing an apply artifact", async () => {
  for (const statements of [[], ["DROP TABLE users"], ["UPDATE users SET id=1"], ["INSERT INTO users VALUES(1)"], ["ALTER TABLE users DROP COLUMN x"], [123]]) {
    await assert.rejects(buildFixture({ generateMigration: async () => statements }), /PROJECTION_NOT_CREATE_ONLY/);
  }
});

test("rejects trailing statements, including another CREATE, before producing an artifact", async () => {
  for (const suffix of ["DROP TABLE users;", "INSERT INTO users VALUES (1);", "CREATE TABLE extra (id INT);", "/* ordinary */ DROP TABLE users;", "# ordinary\nDROP TABLE users;", ";"])
    await assert.rejects(buildFixture({ generateMigration: async () => [`CREATE TABLE users (id INT); ${suffix}`] }), /PROJECTION_NOT_CREATE_ONLY/);
});

test("quoted strings and identifiers may contain semicolons and SQL-looking text", () => {
  for (const sql of [
    "CREATE TABLE `users;literal` (`semi;column` varchar(80) DEFAULT 'value; DROP TABLE users;')",
    "CREATE TABLE `double``tick` (`id` varchar(80) DEFAULT 'it''s; only text')",
    'CREATE TABLE users (id varchar(80) DEFAULT "double""quote; text")',
    "CREATE UNIQUE INDEX `ix;literal` ON `users` (`id`)",
  ]) assert.equal(normalizeCreateStatement(sql), `${sql};`);
});

test("ordinary comments are inert and the emitted delimiter cannot be swallowed", () => {
  const sql = "/* leading ; DROP words */ CREATE/* between */ TABLE users (id INT /* ; DELETE words */)";
  assert.equal(normalizeCreateStatement(`${sql}; -- trailing words\n`), `${sql};`);
  assert.equal(normalizeCreateStatement("CREATE TABLE users (id INT) -- trailing ; words"), "CREATE TABLE users (id INT) -- trailing ; words\n;");
  assert.equal(normalizeCreateStatement("# leading ; words\rCREATE TABLE users (id INT);"), "# leading ; words\rCREATE TABLE users (id INT);");
});

test("fails closed on executable comments, uncertain escaping, malformed tokens or unsupported DDL shapes", () => {
  for (const sql of [
    "CREATE TABLE users (id INT); /*!80000 DROP TABLE users */",
    "CREATE TABLE users (id INT /*!80000 AS SELECT 1 */)",
    "CREATE /*+ hint */ TABLE users (id INT)",
    "CREATE TABLE users (id INT) /* unfinished",
    "CREATE TABLE users (id INT) /* nested /* comment */",
    "CREATE TABLE users (id varchar(20) DEFAULT 'unfinished)",
    "CREATE TABLE `unfinished (id INT)",
    "CREATE TABLE users (id varchar(20) DEFAULT 'back\\slash')",
    "CREATE TABLE users (id INT", "CREATE TABLE users id INT)",
    "CREATE TABLE users (id INT;) SELECT 1", "CREATE TABLE users (id INT);;",
    "CREATE TABLE users (id INT) AS SELECT 1", "CREATE TABLE other.users (id INT)",
    "CREATE TABLE users LIKE other", "CREATE DATABASE users", "CREATE VIEW users AS SELECT 1",
    "CREATE TABLE users (id INT)\u0000", "-- comment only",
  ]) assert.throws(() => normalizeCreateStatement(sql), /PROJECTION_NOT_CREATE_ONLY/, sql);
});

test("writes two private files only to a new output directory without overwriting", async t => {
  const directory = temporary(t), output = join(directory, "projection"), projection = await buildFixture();
  const result = writeProjection(output, projection);
  assert.equal(result.tableCount, 1);
  assert.equal(readFileSync(join(output, "source-projection.sql"), "utf8"), projection.sql);
  assert.deepEqual(JSON.parse(readFileSync(join(output, "source-projection.metadata.json"), "utf8")), projection.metadata);
  assert.equal(statSync(output).mode & 0o777, 0o700);
  assert.equal(statSync(join(output, "source-projection.sql")).mode & 0o777, 0o600);
  assert.throws(() => writeProjection(output, projection), { code: "EEXIST" });
  assert.equal(readFileSync(join(output, "source-projection.sql"), "utf8"), projection.sql);
});

test("rejects a symlink output parent", async t => {
  const directory = temporary(t), alias = join(directory, "alias");
  symlinkSync(dirname(directory), alias);
  assert.throws(() => writeProjection(join(alias, "should-not-be-created"), { sql: "", metadata: {} }), /OUTPUT_PARENT_SYMLINK/);
});

test("requires explicit paths, rejects apply/DB switches and confines imports to its own checkout", async t => {
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  for (const args of [[], ["--apply"], ["--database-url", "secret"], ["--repo-root", repository],
    ["--repo-root", repository, "--out-dir", "/tmp/a", "--out-dir", "/tmp/b"]]) assert.throws(() => parseArguments(args));
  await assert.rejects(exportSourceProjection({ repoRoot: temporary(t), outputDirectory: "/tmp/unused" }), /REPO_MUST_MATCH_TOOL_CHECKOUT/);
  await assert.rejects(exportSourceProjection({ repoRoot: repository, outputDirectory: join(repository, "drizzle", "unsafe") }), /OUTPUT_MUST_BE_OUTSIDE_CHECKOUT/);
  await assert.rejects(exportSourceProjection({ repoRoot: repository, outputDirectory: join(repository, "..not-outside") }), /OUTPUT_MUST_BE_OUTSIDE_CHECKOUT/);
});

test("help and sanitized failures never expose inherited secrets or perform generation", async t => {
  const script = fileURLToPath(new URL("./sourceProjection.mjs", import.meta.url));
  const secret = "synthetic-secret-never-print";
  const output = execFileSync(process.execPath, [script, "--help"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: secret } });
  assert.equal(JSON.parse(output).sqlExecuted, false);
  assert.equal(output.includes(secret), false);
  const result = await main(["--repo-root", `/nonexistent/${secret}`, "--out-dir", join(temporary(t), "out")]);
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("real offline CLI generates the current filtered source projection without a database", t => {
  const outputDirectory = join(temporary(t), "generated");
  const script = fileURLToPath(new URL("./sourceProjection.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "--repo-root", repository, "--out-dir", outputDirectory], {
    encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", DATABASE_URL: "synthetic-invalid-url-not-a-connection", DOTENV_CONFIG_PATH: "/nonexistent/source-projection-do-not-load-env" },
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  const metadata = JSON.parse(readFileSync(join(outputDirectory, "source-projection.metadata.json"), "utf8"));
  const sql = readFileSync(join(outputDirectory, "source-projection.sql"), "utf8");
  assert.equal(metadata.tableCount, 287);
  assert.equal(metadata.tableCount, metadata.tableNames.length);
  assert.ok(metadata.ddlCount > metadata.tableCount);
  assert.deepEqual(metadata.excludedTables, EXCLUDED_TABLES);
  assert.ok(EXCLUDED_TABLES.every(name => !sql.includes(`\`${name}\``)));
  assert.equal(metadata.sqlSha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(sql.includes("synthetic-invalid-url-not-a-connection"), false);
  assert.ok(metadata.versions.drizzleKit && metadata.versions.drizzleOrm && metadata.versions.tsx);
});
