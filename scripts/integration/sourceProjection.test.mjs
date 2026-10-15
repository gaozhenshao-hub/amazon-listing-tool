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
  ASSISTANT_SCHEMA_SOURCE, EXCLUDED_TABLES, PROJECTION_VERSION, auditSchemaSources, buildProjection,
  exportSourceProjection, inspectSchemaModule, loadReviewedProjectionInputs, main, normalizeCreateStatement, parseArguments, selectProjectionTables, writeProjection,
} from "./sourceProjection.mjs";

const require = createRequire(import.meta.url), ts = require("typescript");
const repository = fileURLToPath(new URL("../../", import.meta.url));
const isTable = value => value.table === true;
const getTableName = value => value.name;
const table = name => ({ table: true, name });
const exportsFixture = () => ({ users: table("users"), ...Object.fromEntries(EXCLUDED_TABLES.map((name, i) => [`renamedDraftExport${i}`, table(name)])) });
const schemaFile = "drizzle/schema/example.ts";
const declaration = 'import { mysqlTable, int, varchar, index } from "drizzle-orm/mysql-core";\nexport const example = mysqlTable("example", { id: int("id").primaryKey(), name: varchar("name", { length: 80 }).notNull() }, table => [index("ix").on(table.name)]);';
const claimFile = "drizzle/schema/skillDistillation.ts";
const claimDeclaration = 'import { mysqlTable, int, varchar, text, uniqueIndex } from "drizzle-orm/mysql-core";\nimport { sql } from "drizzle-orm";\nexport const knowledgeDistillationEvidence = mysqlTable("knowledge_distillation_evidence", { distillationProjectId: int("distillationProjectId").notNull(), sourceKey: varchar("sourceKey", {length:80}).notNull(), claim: text("claim").notNull() }, table => [uniqueIndex("uq_kdistill_evidence_project_source_claim").on(table.distillationProjectId, table.sourceKey, sql`${table.claim}(191)`)]);';
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

test("admits only the hash-pinned assistant schema with its erased type import and exact JSON annotation", () => {
  const source = readFileSync(join(repository, ASSISTANT_SCHEMA_SOURCE.path), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), ASSISTANT_SCHEMA_SOURCE.sha256);
  assert.deepEqual(inspectSchemaModule(source, ASSISTANT_SCHEMA_SOURCE.path, ts), []);
  for (const [from, to] of [
    ['import type { AssistantConfiguration }', 'import { AssistantConfiguration }'],
    ['import type { AssistantConfiguration }', 'import type { AssistantConfiguration as Other }'],
    ['../../shared/assistantConfigurations', '../../server/db'],
    ['$type<AssistantConfiguration>()', '$type<Other>()'],
    ['$type<AssistantConfiguration>()', '$type<AssistantConfiguration>(fetch("x"))'],
    ['json("config")', 'json("other")'],
    ['char("configHash", { length: 64 })', 'char("configHash", { length: 32 })'],
  ]) assert.throws(() => inspectSchemaModule(source.replace(from, to), ASSISTANT_SCHEMA_SOURCE.path, ts), /ASSISTANT_SCHEMA_REVIEW_REQUIRED/);
  assert.throws(() => inspectSchemaModule(`${source}\nfetch("https://example.test");`, ASSISTANT_SCHEMA_SOURCE.path, ts), /ASSISTANT_SCHEMA_REVIEW_REQUIRED/);
  for (const path of [schemaFile, "drizzle/schema/index.ts", `./${ASSISTANT_SCHEMA_SOURCE.path}`])
    assert.throws(() => inspectSchemaModule(source, path, ts));
});

test("assistant exceptions do not enable char, type imports or $type in other modules", () => {
  for (const source of [
    'import { mysqlTable, char } from "drizzle-orm/mysql-core"; export const t = mysqlTable("t", { hash: char("hash", { length: 64 }) });',
    'import type { AssistantConfiguration } from "../../shared/assistantConfigurations";',
    'import { mysqlTable, json } from "drizzle-orm/mysql-core"; export const t = mysqlTable("t", { config: json("config").$type<AssistantConfiguration>() });',
  ]) assert.throws(() => inspectSchemaModule(source, schemaFile, ts));
  assert.equal(Object.isFrozen(ASSISTANT_SCHEMA_SOURCE), true);
});

test("admits only the exact reviewed 0187 claim prefix at its named table/index position", () => {
  assert.deepEqual(inspectSchemaModule(claimDeclaration, claimFile, ts), []);
  for (const filename of [schemaFile, "drizzle/schema/ai_os.ts", "drizzle/schema/index.ts", `./${claimFile}`]) {
    assert.throws(() => inspectSchemaModule(claimDeclaration, filename, ts));
  }
  for (const [from, to] of [
    ['from "drizzle-orm"', 'from "some-sql-library"'], ['{ sql }', '{ sql as raw }'], ['{ sql }', '{ sql, eq }'],
    ["knowledgeDistillationEvidence =", "anotherExport ="], ['mysqlTable("knowledge_distillation_evidence"', 'mysqlTable("another_table"'],
    ["uq_kdistill_evidence_project_source_claim", "another_index"], ['uniqueIndex("uq_', 'index("uq_'],
    [".on(table.distillationProjectId, table.sourceKey,", ".on(table.sourceKey, table.distillationProjectId,"],
    [".on(table.distillationProjectId, table.sourceKey,", ".on(table.distillationProjectId,"],
    ['sql`${table.claim}(191)`)', 'sql`${table.claim}(191)`, table.sourceKey)'],
    ['claim: text("claim").notNull()', 'claim: text("claim").default(sql)'],
  ]) assert.throws(() => inspectSchemaModule(claimDeclaration.replace(from, to), claimFile, ts), undefined, `${from} -> ${to}`);
});

test("rejects dynamic/raw/other SQL tags even inside the approved schema and index", () => {
  const reviewed = 'sql`${table.claim}(191)`';
  for (const expression of [
    'sql`${table.claim}(190)`', 'sql`${table.claim}(192)`', 'sql`${table.claim}(${191})`', 'sql`${table.claim}${"(191)"}`',
    'sql`LEFT(${table.claim},191)`', 'sql`(${table.claim})(191)`', 'sql`${table.sourceKey}(191)`', 'sql`${table["claim"]}(191)`',
    'sql`${table.claim.toString()}(191)`', 'sql`${table.claim}(191); DROP TABLE x`', 'sql`claim(191)`',
    'sql`${table.claim}\\x28191)`', 'sql`${table.claim}\\u0028191)`', 'sql<string>`${table.claim}(191)`',
    'sql.raw("claim(191)")', 'sql.join([table.claim])', 'sql("claim(191)")', 'sql', 'other`${table.claim}(191)`',
  ]) assert.throws(() => inspectSchemaModule(claimDeclaration.replace(reviewed, expression), claimFile, ts), undefined, expression);
});

test("audits the actual source import closure without importing it or loading .env", () => {
  const sources = auditSchemaSources(repository.replace(/\/$/, ""), ts);
  assert.equal(sources.length, 19);
  assert.ok(sources.some(item => item.path === ASSISTANT_SCHEMA_SOURCE.path && item.sha256 === ASSISTANT_SCHEMA_SOURCE.sha256));
  assert.ok(!sources.some(item => item.path === "shared/assistantConfigurations.ts"));
  assert.ok(sources.some(item => item.path === "server/domains/ops/workspaceContext.ts"));
  assert.ok(sources.every(item => /^[a-f0-9]{64}$/.test(item.sha256) && !item.path.includes(".env")));
});

test("reviewed loader retains an immutable source baseline and rejects caller metadata mutation", async () => {
  const inputs = await loadReviewedProjectionInputs(repository);
  assert.equal(Object.isFrozen(inputs.sourceFiles), true);
  assert.ok(inputs.sourceFiles.every(Object.isFrozen));
  const firstHash = inputs.sourceFiles[0].sha256;
  assert.throws(() => { inputs.sourceFiles[0].sha256 = "0".repeat(64); }, TypeError);
  assert.throws(() => { inputs.sourceFiles.push({ path: "other", sha256: "0".repeat(64) }); }, TypeError);
  assert.equal(inputs.sourceFiles[0].sha256, firstHash);
  inputs.assertUnchanged();
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
  await assert.rejects(loadReviewedProjectionInputs(temporary(t)), /REPO_MUST_MATCH_TOOL_CHECKOUT/);
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
  assert.equal(metadata.tableCount, 289);
  assert.equal(metadata.tableCount, metadata.tableNames.length);
  assert.equal(metadata.ddlCount, 408);
  // Current full source includes two dedicated assistant tables. This does not
  // reapprove the frozen 287-table base or any native migration contract.
  assert.equal(metadata.sqlSha256, "6223c0db894742328c76960e9ff5a5a9b54681384df0ac04a7d1721d13ef731b");
  assert.equal(metadata.sourceSha256, "07d0a776f5c6116256a5408bb14c66bb4e98b68f8cf06d22a57b6e2ab7b34678");
  assert.ok(metadata.tableNames.includes("emperor_assistant_configurations"));
  assert.ok(metadata.tableNames.includes("emperor_assistant_configuration_versions"));
  assert.match(sql, /UNIQUE\(`distillationProjectId`,`sourceKey`,`claim`\(191\)\)/);
  assert.match(sql, /CONSTRAINT `uk_emperor_scheduled_tasks_external_task_uid` UNIQUE\(`externalTaskUid`\)/);
  assert.match(sql, /CREATE INDEX `idx_emperor_scheduled_tasks_workspace_managed` ON `emperor_scheduled_tasks` \(`workspaceId`,`systemManaged`\);/);
  assert.deepEqual(metadata.excludedTables, EXCLUDED_TABLES);
  assert.ok(EXCLUDED_TABLES.every(name => !sql.includes(`\`${name}\``)));
  assert.equal(metadata.sqlSha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(sql.includes("synthetic-invalid-url-not-a-connection"), false);
  assert.ok(metadata.versions.drizzleKit && metadata.versions.drizzleOrm && metadata.versions.tsx);
});
