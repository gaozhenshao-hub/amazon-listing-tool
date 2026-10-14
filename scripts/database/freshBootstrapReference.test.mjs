// Public-source generation and synthetic connector mocks only. No database/VM.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { exportSourceProjection } from "../integration/sourceProjection.mjs";
import { loadFreshBootstrapPlan, readPublicFile, sha256, fingerprint } from "./freshBootstrapPlan.mjs";
import { deriveHistoricalColumnOrder, replayPublicColumnOrder } from "./freshBootstrapColumnOrder.mjs";
import { REFERENCE_VERSION, SOURCE_MANIFEST_PATH, SOURCE_MANIFEST_SHA256, INDEX_MANIFEST_PATH, INDEX_MANIFEST_SHA256, splitPublicStatements,
  splitDefinitionList, parseIndexColumns, referenceIndexDefinitions, referencePrimaryKeys,
  describeReferenceStatement, extractLedgerCreate, deriveCommentOverlay, deriveColumnAddition, assembleReferenceDraft, assembleReferencePlan, reorderCreateColumns,
  tracePublicColumnDeclarations, deriveCurrentTimestampDefault, loadFreshReferencePlan, validateReferenceCatalog,
  constructReferenceContract, parseArguments, runPublicSourceReference, main } from "./freshBootstrapReference.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, ""), clone = value => structuredClone(value);
const code = expected => error => error.code === expected;
const privateError = "synthetic-secret-not-to-print";
const root = "/tmp/amazon-mysql8-rehearsal.reference-test";
let projectionDirectory, input, fullPlan;

before(async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-public-reference-test.")));
  projectionDirectory = path.join(directory, "projection");
  // Recreate the reviewed artifact from public declarations. No dependency on
  // a prior agent's /tmp path and no fixture catalog presented as a real oracle.
  await exportSourceProjection({ repoRoot: repo, outputDirectory: projectionDirectory });
  const config = JSON.parse(readPublicFile(repo, SOURCE_MANIFEST_PATH)), bundle = loadFreshBootstrapPlan();
  const projectionMetadata = JSON.parse(fs.readFileSync(path.join(projectionDirectory, "source-projection.metadata.json"), "utf8"));
  input = { bundle, config, indexInventory: JSON.parse(readPublicFile(repo, INDEX_MANIFEST_PATH)), projectionMetadata, projectionSql: fs.readFileSync(path.join(projectionDirectory, "source-projection.sql"), "utf8"),
    sourceTexts: Object.fromEntries([...config.sources, ...projectionMetadata.sourceFiles].map(item => [item.path, readPublicFile(repo, item.path)])) };
  fullPlan = assembleReferencePlan(input);
});

test("module import is inert with production-looking credentials and never imports the actual migration executor", () => {
  const url = new URL("./freshBootstrapReference.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url.href)}); console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: privateError } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
  const source = fs.readFileSync(url, "utf8");
  assert.doesNotMatch(source, /import.*run-database-migrations|dotenv|loadPrivateExport|production-ddl\.json|applyMigrations\(/);
});

test("complete independent public plan binds projection, every source, 303 exact tables and all replacement exclusions", () => {
  const result = loadFreshReferencePlan({ projectionDirectory }); assert.deepEqual(result.plan, fullPlan);
  assert.equal(fullPlan.version, REFERENCE_VERSION); assert.equal(fullPlan.tableNames.length, 303); assert.equal(fullPlan.statements.length, 785);
  assert.equal(fullPlan.statements.filter(item => item.kind === "create-table").length, 303);
  assert.equal(fullPlan.statementPlanSha256, fingerprint(fullPlan.statements)); assert.equal(fullPlan.discardedProjectionDdl.length, 45);
  assert.equal(fullPlan.approvedForBootstrapExecution, false); assert.equal(fullPlan.derivation.candidateDatabaseUsed, false);
  assert.equal(fullPlan.derivation.productionDdlUsed, false);
  const pins = new Map(input.bundle.manifest.sources.map(item => [item.path, item.sha256]));
  assert.ok(fullPlan.derivation.tables.every(table => table.sources.length && table.sources.every(source => pins.get(source.path) === source.sha256)));
  for (const replacement of input.config.replacements) {
    assert.equal(fullPlan.statements.filter(item => item.kind === "create-table" && item.tableName === replacement.table).length, 1);
    assert.equal(fullPlan.statements.filter(item => item.kind === "create-index" && item.tableName === replacement.table).length, 0);
  }
  assert.equal(sha256(readPublicFile(repo, SOURCE_MANIFEST_PATH)), SOURCE_MANIFEST_SHA256);
  assert.equal(sha256(readPublicFile(repo, INDEX_MANIFEST_PATH)), INDEX_MANIFEST_SHA256);
});

test("historical ordinal replay never silently drops a current-source field and drafts cannot create contracts", () => {
  const draft = assembleReferenceDraft(input); assert.equal(draft.ordinalValidated, false);
  assert.throws(() => constructReferenceContract({ bundle: input.bundle, plan: draft, catalog: catalogFixture("reference_test"), platform: {} }), code("REFERENCE_ORDINAL_NOT_VALIDATED"));
  assert.equal(fullPlan.ordinalValidated, true);
  const expectedColumns = clone(fullPlan.expectedColumns); delete expectedColumns.app_schema_migrations;
  expectedColumns.projects.push("missing_source_only_field");
  assert.throws(() => deriveHistoricalColumnOrder({ bundle: input.bundle, expectedColumns, splitPublicStatements, splitDefinitionList }), code("COLUMN_ORDER_SOURCE_COLUMN_SET_MISMATCH"));
  const sql = "CREATE TABLE `x` (\n `id` int NOT NULL,\n `status` enum('a,b','c') DEFAULT 'a,b',\n `note` text COMMENT 'retain me',\n PRIMARY KEY (`id`)\n)";
  const result = reorderCreateColumns(sql, ["note", "id", "status"]);
  assert.ok(result.indexOf("`note`") < result.indexOf("`id`"));
  assert.ok(result.includes("`status` enum('a,b','c') DEFAULT 'a,b'")); assert.ok(result.includes("`note` text COMMENT 'retain me'"));
  assert.throws(() => reorderCreateColumns(sql, ["id", "status"]), code("REFERENCE_REORDER_COLUMN_COVERAGE_CHANGED"));
});

test("temporal defaults map only a same-precision final public CURRENT_TIMESTAMP token and preserve all other bytes", () => {
  for (const type of ["timestamp", "datetime", "timestamp(6)", "datetime(3)"]) {
    const precision = /\(([0-6])\)/.exec(type)?.[1] ?? "";
    const projectedDefinition = `\`createdAt\` ${type} NOT NULL DEFAULT (now(${precision})) ON UPDATE CURRENT_TIMESTAMP${precision ? `(${precision})` : ""} COMMENT 'DEFAULT (now()) remains literal'`;
    const sourceToken = `CURRENT_TIMESTAMP${precision ? `(${precision})` : ""}`;
    const sourceDefinition = `\`createdAt\` ${type} NOT NULL DEFAULT ${sourceToken} ON UPDATE ${sourceToken} COMMENT 'historical comment' AFTER \`id\``;
    const result = deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition });
    assert.equal(result.changed, true); assert.equal(result.precision, Number(precision || 0));
    assert.equal(result.definition, projectedDefinition.replace(`DEFAULT (now(${precision}))`, `DEFAULT ${sourceToken}`));
    assert.ok(result.definition.endsWith("COMMENT 'DEFAULT (now()) remains literal'"));
  }
  for (const sourceDefinition of ["`createdAt` timestamp DEFAULT (now())", "`createdAt` timestamp DEFAULT NULL",
    "`createdAt` timestamp NULL COMMENT 'DEFAULT CURRENT_TIMESTAMP'", "`createdAt` timestamp DEFAULT '2000-01-01 00:00:00'"]) {
    const projectedDefinition = "`createdAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP";
    assert.deepEqual(deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition }), { definition: projectedDefinition, changed: false });
  }
  for (const projectedDefinition of ["`note` varchar(100) DEFAULT '(now())' COMMENT 'DEFAULT CURRENT_TIMESTAMP'",
    "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP", "`createdAt` timestamp NULL COMMENT 'DEFAULT (now())'"]) {
    assert.deepEqual(deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition: "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP" }),
      { definition: projectedDefinition, changed: false });
  }
});

test("temporal default precision, renamed columns, extra expressions and unsupported spellings fail closed", () => {
  const projectedDefinition = "`createdAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP";
  for (const sourceDefinition of ["`createdAt` datetime DEFAULT CURRENT_TIMESTAMP", "`other` timestamp DEFAULT CURRENT_TIMESTAMP",
    "`createdAt` timestamp(3) DEFAULT CURRENT_TIMESTAMP(3)", "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP(6)"])
    assert.throws(() => deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition }), code("REFERENCE_TEMPORAL_PRECISION_OR_TYPE_CHANGED"));
  for (const sourceDefinition of ["`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP(7)", "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP(foo)"])
    assert.throws(() => deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition }), code("REFERENCE_TEMPORAL_CURRENT_TIMESTAMP_UNSUPPORTED"));
  for (const sourceDefinition of ["`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP + INTERVAL 1 DAY", "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP AT TIME ZONE 'UTC'"])
    assert.throws(() => deriveCurrentTimestampDefault({ projectedDefinition, sourceDefinition }), code("REFERENCE_TEMPORAL_EXPRESSION_TAIL_UNSUPPORTED"));
  assert.throws(() => deriveCurrentTimestampDefault({ projectedDefinition: projectedDefinition.replace("(now())", "(now(7))"),
    sourceDefinition: "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP" }), code("REFERENCE_TEMPORAL_NOW_UNSUPPORTED"));
  assert.throws(() => deriveCurrentTimestampDefault({ projectedDefinition: `${projectedDefinition} DEFAULT NULL`,
    sourceDefinition: "`createdAt` timestamp DEFAULT CURRENT_TIMESTAMP" }), code("REFERENCE_TEMPORAL_MULTIPLE_DEFAULTS"));
});

test("last effective public declarations trace CREATE, repeated no-op CREATE, MODIFY, CHANGE, ADD, DROP and recreate with exact pins", () => {
  const sql = ["CREATE TABLE `x` (`id` int, `created` timestamp DEFAULT CURRENT_TIMESTAMP, `keep` timestamp DEFAULT (now()))",
    "CREATE TABLE IF NOT EXISTS `x` (`id` int, `created` timestamp DEFAULT (now()), `keep` timestamp DEFAULT CURRENT_TIMESTAMP)",
    "ALTER TABLE x MODIFY created timestamp(3) DEFAULT CURRENT_TIMESTAMP(3) AFTER id, ADD COLUMN transient datetime DEFAULT CURRENT_TIMESTAMP FIRST",
    "ALTER TABLE x CHANGE created renamed timestamp(3) DEFAULT CURRENT_TIMESTAMP(3), DROP COLUMN transient",
    "CREATE TABLE y (id int, stamp timestamp DEFAULT CURRENT_TIMESTAMP)", "DROP TABLE y",
    "CREATE TABLE y (id int, stamp timestamp DEFAULT (now()))"].join(";\n") + ";";
  const entry = { fileName: "0000_fixture.sql", sql, checksum: sha256(sql) }, pin = { path: `drizzle/${entry.fileName}`, sha256: entry.checksum };
  const bundle = { plan: [entry], planSha256: fingerprint([[entry.fileName, entry.checksum]]),
    manifest: { sources: [pin] }, sourcesSha256: fingerprint([pin]) };
  const order = { ...replayPublicColumnOrder({ plan: [entry], pins: new Map([[pin.path, pin.sha256]]), splitPublicStatements, splitDefinitionList }),
    bootstrapPlanSha256: bundle.planSha256, bootstrapSourcesSha256: bundle.sourcesSha256 };
  const traced = tracePublicColumnDeclarations({ bundle, order });
  assert.equal(traced.get("x").get("keep").definition, "`keep` timestamp DEFAULT (now())");
  assert.equal(traced.get("x").get("keep").source.statementIndex, 0);
  const renamed = traced.get("x").get("renamed");
  assert.equal(renamed.definition, "renamed timestamp(3) DEFAULT CURRENT_TIMESTAMP(3)");
  assert.equal(renamed.source.statementIndex, 3); assert.equal(renamed.source.sha256, entry.checksum);
  assert.equal(renamed.source.statementSha256, sha256(splitPublicStatements(sql)[3]));
  assert.equal(renamed.declarationSha256, sha256(renamed.definition));
  assert.equal(traced.get("x").has("created"), false); assert.equal(traced.get("x").has("transient"), false);
  assert.equal(traced.get("y").get("stamp").definition, "stamp timestamp DEFAULT (now())");
  const modified = clone(bundle); modified.plan[0].sql += "\n";
  assert.throws(() => tracePublicColumnDeclarations({ bundle: modified, order }), code("REFERENCE_DEFAULT_SOURCE_CHANGED"));
  const invalid = clone(order); invalid.operations[0].statementIndex = 999;
  assert.throws(() => tracePublicColumnDeclarations({ bundle, order: invalid }), code("REFERENCE_DEFAULT_STATEMENT_MISSING"));
  invalid.operations[0].statementIndex = 0; invalid.operations[0].operation = "execute-arbitrary";
  assert.throws(() => tracePublicColumnDeclarations({ bundle, order: invalid }));
});

test("complete source default overlay leaves genuinely published now() defaults intact and binds every change to final source", () => {
  const create = name => fullPlan.statements.find(item => item.kind === "create-table" && item.tableName === name).sql;
  assert.match(create("users"), /`createdAt` timestamp NOT NULL DEFAULT \(now\(\)\)/);
  assert.match(create("users"), /`updatedAt` timestamp NOT NULL DEFAULT \(now\(\)\) ON UPDATE CURRENT_TIMESTAMP/);
  assert.match(create("ai_jobs"), /`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(create("ai_jobs"), /`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/);
  assert.equal(fullPlan.temporalDefaultOverlays.length, 176);
  assert.equal(new Set(fullPlan.temporalDefaultOverlays.map(item => item.tableName)).size, 97);
  assert.deepEqual(fullPlan.temporalDefaultOverlays, fullPlan.derivation.temporalDefaultOverlays);
  assert.equal(fullPlan.temporalDefaultOverlays.some(item => item.tableName === "users" || item.tableName.startsWith("off_")), false);
  const order = deriveHistoricalColumnOrder({ bundle: input.bundle,
    expectedColumns: Object.fromEntries(Object.entries(fullPlan.expectedColumns).filter(([name]) => name !== "app_schema_migrations")), splitPublicStatements, splitDefinitionList });
  const traced = tracePublicColumnDeclarations({ bundle: input.bundle, order });
  for (const item of fullPlan.temporalDefaultOverlays) {
    const last = traced.get(item.tableName).get(item.columnName);
    assert.deepEqual(item.source, last.source); assert.equal(item.declarationSha256, sha256(last.definition));
    assert.equal(item.to.toUpperCase(), "CURRENT_TIMESTAMP"); assert.equal(item.from.toLowerCase(), "(now())");
    assert.equal(item.precision, 0); assert.match(item.projectedDeclarationSha256, /^[a-f0-9]{64}$/);
    assert.match(item.referenceDeclarationSha256, /^[a-f0-9]{64}$/);
  }
  // Reverse only each evidenced default token and recover the exact prior
  // reference CREATE. This checks every other byte, not just semantic fields.
  const draft = assembleReferenceDraft(input);
  for (const statement of fullPlan.statements) {
    const original = draft.statements.find(item => item.kind === statement.kind && item.tableName === statement.tableName && item.sql === statement.sql)
      ?? draft.statements.find(item => item.kind === "create-table" && item.tableName === statement.tableName);
    if (statement.kind !== "create-table" || statement.tableName === "app_schema_migrations") continue;
    let reversed = statement.sql;
    for (const overlay of fullPlan.temporalDefaultOverlays.filter(item => item.tableName === statement.tableName)) {
      const line = reversed.split("\n").find(value => value.trimStart().startsWith(`\`${overlay.columnName}\` `));
      assert.ok(line); assert.ok(line.includes(`DEFAULT ${overlay.to}`));
      reversed = reversed.replace(line, line.replace(`DEFAULT ${overlay.to}`, `DEFAULT ${overlay.from}`));
    }
    assert.equal(reversed, reorderCreateColumns(original.sql, fullPlan.expectedColumns[statement.tableName]));
  }
});

test("all 903 public keys plus ledger keys retain exact names, uniqueness, order, prefix, direction and the reviewed 43 aliases", () => {
  assert.equal(fullPlan.expectedIndexes.length, 905); assert.equal(fullPlan.indexAliases.length, 43);
  assert.equal(referencePrimaryKeys(fullPlan.statements).length, 303);
  const indexes = referenceIndexDefinitions(fullPlan.statements);
  assert.equal(indexes.length, 602);
  for (const alias of fullPlan.indexAliases) {
    assert.ok(!indexes.some(item => item.table === alias.table && item.name === alias.projectionName));
    for (const name of alias.historicalNames) assert.ok(indexes.some(item => item.table === alias.table && item.name === name));
  }
  const monthly = indexes.find(item => item.name === "ops_monthly_financial_profit_unique");
  assert.equal(monthly.columns.length, 6);
  assert.ok(!fullPlan.tableNames.includes("imageAnalyses"));
  const tampering = [x => x.indexInventory.activeIndexes.pop(), x => x.indexInventory.comparison.projectionOnly.pop(),
    x => x.indexInventory.activeIndexes[0].columns.reverse(), x => x.indexInventory.activeIndexes[0].columns[0].prefixLength = 12,
    x => x.indexInventory.activeIndexes[0].unique = !x.indexInventory.activeIndexes[0].unique,
    x => x.indexInventory.primaryKeys.pop(), x => x.indexInventory.exclusions.pop(),
    x => x.indexInventory.activeIndexes[0].createSql += " DROP TABLE x;", x => x.bundle.plan[0].sql += "\n"];
  for (const mutate of tampering) { const invalid = clone(input); mutate(invalid); assert.throws(() => assembleReferencePlan(invalid)); }
});

test("index parsing preserves quoted commas, expression rejection, prefix and explicit direction", () => {
  assert.deepEqual(splitDefinitionList("id int, note enum('a,b','c'), KEY idx (id,note(12))"), ["id int", "note enum('a,b','c')", "KEY idx (id,note(12))"]);
  assert.deepEqual(parseIndexColumns("`a`(191) DESC, b ASC"), [{ name: "a", prefixLength: 191, direction: "D" }, { name: "b", prefixLength: null, direction: "A" }]);
  for (const text of ["(lower(a))", "other.a", "a(0)", "a,", "a) (", "a COLLATE x"]) assert.throws(() => parseIndexColumns(text));
  assert.throws(() => referenceIndexDefinitions([describeReferenceStatement("CREATE TABLE x (id int, FULLTEXT KEY idx (id))")]));
  assert.throws(() => referencePrimaryKeys([describeReferenceStatement("CREATE TABLE x (id int)")]));
});

test("reviewed widened Saihu ASIN keeps its historical nonunique index name with the explicit 191-character prefix", () => {
  const name = "idx_sh_asin_week", table = "saihu_product_weekly";
  const expected = { table, name, unique: false, columns: [
    { name: "asin", prefixLength: 191, direction: "A" },
    { name: "week_start_date", prefixLength: null, direction: "A" },
  ] };
  assert.deepEqual(referenceIndexDefinitions(fullPlan.statements).filter(item => item.table === table && item.name === name), [expected]);
  assert.doesNotMatch(input.projectionSql, /idx_sh_asin_week/);
  const active = input.indexInventory.activeIndexes.find(item => item.table === table && item.name === name);
  assert.equal(active.source.path, "drizzle/bootstrap/0004_current_source_alignment.sql");
  assert.equal(active.createSql, "CREATE INDEX `idx_sh_asin_week` ON `saihu_product_weekly` (`asin`(191), `week_start_date`);");
  const retired = input.indexInventory.exclusions.find(item => item.removed.table === table && item.removed.name === name);
  assert.ok(retired); assert.equal(retired.removed.unique, false);
  assert.equal(retired.removed.source.path, "drizzle/0100_data_import_center.sql");
  assert.deepEqual(retired.removed.columns, expected.columns.map(column => ({ ...column, prefixLength: null })));
  const invalid = clone(input);
  invalid.indexInventory.activeIndexes.find(item => item.table === table && item.name === name).columns[0].prefixLength = null;
  assert.throws(() => assembleReferencePlan(invalid), code("REFERENCE_INDEX_INVENTORY_IDENTITY_CHANGED"));
});

test("full CREATE overlays preserve historical FK names/actions, unique names, compound indexes and Unicode collation", () => {
  const create = name => fullPlan.statements.find(item => item.kind === "create-table" && item.tableName === name).sql;
  assert.match(create("competitorComparisonReports"), /CONSTRAINT `fk_competitor_comparison_project`\s+FOREIGN KEY \(`projectId`\) REFERENCES `projects` \(`id`\) ON DELETE CASCADE/);
  assert.match(create("emperor_external_knowledge_callers"), /CONSTRAINT `fk_external_kb_caller_connector`/);
  for (const name of ["uq_external_kb_caller_connector", "uq_external_kb_caller_token_hash", "idx_external_kb_caller_workspace_active"])
    assert.ok(create("emperor_external_knowledge_callers").includes(name));
  assert.equal(Object.keys(fullPlan.expectedCollations).length, 17);
  for (const [name, collation] of Object.entries(fullPlan.expectedCollations)) assert.ok(create(name).includes(`COLLATE=${collation}`));
  assert.ok(fullPlan.statements.findIndex(item => item.tableName === "projects") < fullPlan.statements.findIndex(item => item.tableName === "competitorComparisonReports"));
  assert.ok(fullPlan.statements.findIndex(item => item.tableName === "emperor_mcp_connectors") < fullPlan.statements.findIndex(item => item.tableName === "emperor_external_knowledge_callers"));
});

test("source-pinned column overlays retain all three literal comments and historical positioned additions", () => {
  const item = fullPlan.statements.find(statement => statement.kind === "preserve-column-comments");
  assert.equal(fullPlan.expectedComments.length, 3); assert.equal(item.tableName, "image_workflow_sessions");
  assert.equal((item.sql.match(/MODIFY COLUMN/g) ?? []).length, 3); assert.doesNotMatch(item.sql, /ADD COLUMN|AFTER|FIRST/);
  assert.ok(item.sql.includes("Step5失败分段：main、secondary、aplus、brand_story或fallback"));
  const columns = fullPlan.expectedColumns.dev_project_progress;
  assert.equal(columns[columns.indexOf("selectorName") + 1], "operatorName");
  assert.equal(columns[columns.indexOf("operatorName") + 1], "landingStage");
  const original = input.sourceTexts["drizzle/0151_step5_segment_run_status.sql"];
  const projected = fullPlan.statements.find(statement => statement.kind === "create-table" && statement.tableName === "image_workflow_sessions").sql;
  const args = { sql: original, table: "image_workflow_sessions", columns: input.config.columnComments[0].columns, projectedCreate: projected };
  for (const changed of [{ ...args, sql: original.replace("LONGTEXT", "INT") }, { ...args, sql: original + " DROP TABLE x;" },
    { ...args, projectedCreate: projected.replace("`step5RunFailedGroup` varchar(64)", "`step5RunFailedGroup` varchar(128)") }])
    assert.throws(() => deriveCommentOverlay(changed));
  assert.throws(() => deriveColumnAddition("ALTER TABLE `x` ADD COLUMN `b` varchar(40) NULL AFTER `missing`", "x", ["id"]));
});

test("scheduled reference uses public prerequisite plus precisely three immutable DDLs, preserving bin and append order with no seeds", () => {
  const items = fullPlan.statements.filter(item => item.tableName === "emperor_scheduled_tasks");
  assert.equal(items.length, 4); assert.match(items[0].sql, /COLLATE=utf8mb4_bin/);
  assert.equal(items[1].kind, "add-scheduled-columns"); assert.equal(items.filter(item => item.kind === "create-index").length, 2);
  assert.equal(fullPlan.expectedColumns.emperor_scheduled_tasks[15], "workspaceId");
  assert.equal(fullPlan.expectedColumns.emperor_scheduled_tasks.at(-1), "lastBatchId");
  for (const item of fullPlan.statements) assert.doesNotMatch(item.sql, /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|SET|SELECT|USE|DROP)\b/i);
  assert.equal(fullPlan.statements.filter(item => item.tableName === "app_schema_migrations").length, 1);
});

test("missing/tampered source, source config, projection, metadata or bootstrap pin fails closed before any execution", () => {
  const mutations = [x => delete x.sourceTexts[x.config.sources[0].path], x => x.sourceTexts[x.config.sources[0].path] += "\n",
    x => x.config.replacements.pop(), x => x.config.sources[0].sha256 = "a".repeat(64), x => x.projectionSql += "\n",
    x => x.projectionMetadata.sourceFiles.pop(), x => x.projectionMetadata.tableCount--,
    x => x.projectionMetadata.productionClone = true, x => x.projectionMetadata.excludedTables.pop(),
    x => x.bundle.manifest.sources.find(item => item.path === x.config.sources[0].path).sha256 = "a".repeat(64),
    x => x.bundle.manifest.requiredBusinessTables.pop()];
  for (const mutate of mutations) { const invalid = clone(input); mutate(invalid); assert.throws(() => assembleReferencePlan(invalid)); }
});

test("new public ALTER/DROP/CREATE INDEX touching a full replacement cannot be lost behind its earlier CREATE", () => {
  for (const sql of ["ALTER TABLE `competitorComparisonReports` ADD COLUMN drift int;", "DROP TABLE amazon_monitor_runs;",
    "CREATE INDEX unreviewed ON emperor_external_knowledge_callers (workspaceId);"]) {
    const invalid = clone(input); invalid.bundle.plan.push({ fileName: "9999_unreviewed.sql", sql });
    assert.throws(() => assembleReferencePlan(invalid), code("REFERENCE_LATER_OVERLAY_DDL_UNACCOUNTED"));
  }
});

test("public SQL splitter preserves literal delimiters, strips ordinary comments and refuses unfinished/executable syntax", () => {
  assert.deepEqual(splitPublicStatements("-- harmless\nCREATE TABLE `x` (`note` text COMMENT 'a;b'); /* comment */ CREATE INDEX idx ON x(note);"),
    ["CREATE TABLE `x` (`note` text COMMENT 'a;b')", "CREATE INDEX idx ON x(note)"]);
  assert.deepEqual(splitPublicStatements("SELECT 'it''s;a'; SELECT 'x\\'y;b';"), ["SELECT 'it''s;a'", "SELECT 'x\\'y;b'"]);
  for (const value of ["CREATE TABLE x (x text DEFAULT 'unterminated)", "/* missing end", "/*!50000 DROP TABLE x */", "/*+ directive */ SELECT 1", "a\0b"])
    assert.throws(() => splitPublicStatements(value));
});

test("reference statement validator refuses DML, extra statements, qualified/external targets and executable features", () => {
  assert.equal(describeReferenceStatement("CREATE TABLE IF NOT EXISTS x (id int)").sql, "CREATE TABLE `x` (id int)");
  assert.equal(describeReferenceStatement("CREATE UNIQUE INDEX idx ON `x` (`id`)").tableName, "x");
  for (const sql of ["INSERT INTO x VALUES (1)", "ALTER TABLE x ADD x int", "CREATE TABLE x (id int); DROP TABLE x",
    "CREATE TABLE amz_listing.x (id int)", "CREATE TABLE x (id int) AS SELECT 1", "CREATE TABLE x (id int) DATA DIRECTORY='/other'",
    "CREATE TABLE x (id int REFERENCES amz_listing.y(id))", "CREATE TABLE x (id int) ENGINE_ATTRIBUTE='x'", "CREATE INDEX ix ON other.x(id)",
    "CREATE INDEX ix ON x(id); DELETE FROM x", "/*!50000 CREATE TABLE x (id int) */"])
    assert.throws(() => describeReferenceStatement(sql));
});

test("ledger extraction captures only the pinned function's single literal CREATE, never its import or legacy ledger writes", () => {
  const source = input.sourceTexts[input.config.ledger.path], ledger = extractLedgerCreate(source);
  assert.equal(ledger.tableName, "app_schema_migrations"); assert.doesNotMatch(ledger.sql, /INSERT|UPDATE app_schema/);
  for (const mutated of [source.replace("ensureLedger(connection)", "other(connection)"),
    source.replace("CREATE TABLE IF NOT EXISTS app_schema_migrations", "CREATE TABLE IF NOT EXISTS wrong"),
    source.replace("CREATE TABLE IF NOT EXISTS app_schema_migrations", "${arbitrary} CREATE TABLE IF NOT EXISTS app_schema_migrations"),
    source + source]) assert.throws(() => extractLedgerCreate(mutated));
});

// Structurally complete synthetic metadata for mocks; these placeholder types
// are intentionally NOT written as the real application reference contract.
function catalogFixture(schema) {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  const row = (kind, values) => ({ ...Object.fromEntries(DDL_CATALOG[kind].fields.map(field => [field, null])), ...values });
  catalog.schema = [row("schema", { schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" })];
  for (const tableName of fullPlan.tableNames) {
    const hasId = fullPlan.expectedColumns[tableName].includes("id");
    const collationName = fullPlan.expectedCollations[tableName] ?? "utf8mb4_0900_ai_ci";
    catalog.tables.push(row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic", autoIncrement: hasId ? 1 : null,
      collationName, createOptions: "", tableComment: "" }));
    fullPlan.expectedColumns[tableName].forEach((columnName, index) => catalog.columns.push(row("columns", { tableName, columnName, ordinalPosition: index + 1,
      columnDefault: null, isNullable: "NO", dataType: "int", columnType: "int", numericPrecision: 10, numericScale: 0,
      columnKey: columnName === "id" ? "PRI" : "", extra: columnName === "id" ? "auto_increment" : "", columnComment: "", generationExpression: "" })));
  }
  for (const expected of fullPlan.expectedComments) Object.assign(catalog.columns.find(column => column.tableName === expected.tableName && column.columnName === expected.columnName),
    { columnComment: expected.comment, columnType: expected.columnType, isNullable: "YES" });
  for (const [tableName, constraintName, columnName, parent] of [["competitorComparisonReports", "fk_competitor_comparison_project", "projectId", "projects"],
    ["emperor_external_knowledge_callers", "fk_external_kb_caller_connector", "connectorId", "emperor_mcp_connectors"]]) {
    catalog.foreignKeys.push(row("foreignKeys", { tableName, constraintName, uniqueConstraintSchema: schema, uniqueConstraintName: "PRIMARY",
      referencedTableName: parent, matchOption: "NONE", updateRule: "NO ACTION", deleteRule: "CASCADE" }));
    catalog.keyColumns.push(row("keyColumns", { tableName, constraintName, columnName, ordinalPosition: 1, uniqueConstraintPosition: 1,
      referencedTableSchema: schema, referencedTableName: parent, referencedColumnName: "id" }));
    catalog.constraints.push(row("constraints", { tableName, constraintName, constraintType: "FOREIGN KEY", enforced: "YES" }));
  }
  for (const item of fullPlan.expectedIndexes) item.columns.forEach((column, index) =>
    catalog.indexes.push(row("indexes", { tableName: item.table, indexName: item.name, nonUnique: item.unique ? 0 : 1, sequence: index + 1,
      columnName: column.name, prefixLength: column.prefixLength, direction: column.direction, nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" })));
  return catalog;
}

test("contract includes all collections and columns, retains ordinal/comments/defaults/index definitions and allows only counter values to normalize", () => {
  const catalog = catalogFixture("reference_test"), checked = validateReferenceCatalog(catalog, fullPlan);
  assert.equal(Object.keys(checked).length, 13); assert.equal(checked.columns.length, 5487); assert.equal(checked.foreignKeys.length, 2);
  const contract = constructReferenceContract({ bundle: input.bundle, plan: fullPlan, catalog,
    platform: { mysqlMajorMinor: "8.0", lowerCaseTableNames: 0, schemaCharacterSet: "utf8mb4", schemaCollation: "utf8mb4_0900_ai_ci" } });
  assert.equal(contract.catalogSha256, fingerprint(contract.catalog)); assert.equal(contract.derivation.candidateDatabaseUsed, false);
  assert.equal(contract.derivation.referenceStatementPlanSha256, fullPlan.statementPlanSha256);
  const next = clone(catalog); next.tables.find(table => table.autoIncrement !== null).autoIncrement = "9001";
  assert.deepEqual(validateReferenceCatalog(next, fullPlan), checked);
  const changed = clone(catalog); changed.columns[0].columnComment = "explicit public history comment";
  assert.notEqual(fingerprint(validateReferenceCatalog(changed, fullPlan)), fingerprint(checked));
});

test("table-count-only oracle, dropped columns, changed column order, missing FKs/indexes/charset and altered auto_increment attributes fail", () => {
  const original = catalogFixture("reference_test");
  for (const mutate of [c => c.columns.pop(), c => c.columns[0].columnName = "renamed",
    c => c.foreignKeys.pop(), c => c.foreignKeys[0].deleteRule = "RESTRICT", c => c.indexes.pop(), c => c.indexes[0].nonUnique = 1 - c.indexes[0].nonUnique,
    c => c.indexes[0].prefixLength = 10, c => c.indexes[0].indexName = "different", c => c.tables.find(t => t.tableName === "amazon_monitor_runs").collationName = "utf8mb4_bin",
    c => c.columns.find(column => column.extra === "auto_increment").extra = "", c => c.tables.find(table => table.autoIncrement !== null).autoIncrement = null,
    c => c.columns.find(column => column.columnName === "step5RunSegments").columnComment = "",
    c => c.tables.find(table => table.tableName === "image_asset_policy_revisions").collationName = "utf8mb4_0900_ai_ci",
    c => delete c.checks]) { const invalid = clone(original); mutate(invalid); assert.throws(() => validateReferenceCatalog(invalid, fullPlan)); }
  const partial = clone(original); partial.columns = partial.columns.filter(column => column.ordinalPosition === 1);
  assert.throws(() => validateReferenceCatalog(partial, fullPlan));
});

function options() { return { executeLocal: true, linuxIsolatedVm: true, buildPublicSourceReference: true, root, socket: `${root}/mysql.sock`, datadir: `${root}/data`,
  projectionDirectory, output: path.join(repo, "artifacts/reference-candidate-mock.json"), receiptOutput: path.join(repo, "artifacts/reference-receipt-mock.json") }; }
function cli(value) { return ["--execute-local", "--linux-isolated-vm", "--build-public-source-reference", ...["root", "socket", "datadir", "projection-directory", "output", "receipt-output"]
  .flatMap(name => [`--${name}`, value[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]]) ]; }

test("CLI requires explicit isolated reference mode and two distinct new outputs; there is no production URI/contract approval option", () => {
  const value = options(), args = cli(value); assert.deepEqual(parseArguments(args), value);
  for (const bad of [[], args.slice(1), args.filter(arg => arg !== "--build-public-source-reference"), [...args, "--database", "production"],
    [...args, "--host", "remote"], [...args, "--approve-contract"], [...args, "--root", root]]) assert.throws(() => parseArguments(bad));
});

function workflow({ failDdl = false, nonempty = false, failCleanup = false } = {}) {
  const value = options(), calls = [], configs = [], writes = new Map(), uid = process.getuid(), actual = fs;
  let currentSchema, count = 0, destroyed = 0, callback;
  // The output parent belongs to this mock filesystem, not an untracked checkout directory.
  const special = [root, value.socket, value.datadir, "/usr/lib/os-release", path.join(repo, "artifacts")], io = { ...fs,
    realpathSync: filename => filename === "/etc/os-release" ? "/usr/lib/os-release" : special.includes(filename.replace(/\/$/, "")) ? filename.replace(/\/$/, "") : actual.realpathSync(filename),
    lstatSync: filename => special.includes(filename) ? { size: 50, uid: filename === root ? uid : 0, mode: filename === root ? 0o40700 : 0o100755,
      isDirectory: () => [root, value.datadir, path.join(repo, "artifacts")].includes(filename), isFile: () => filename === "/usr/lib/os-release", isSocket: () => filename === value.socket, isSymbolicLink: () => false } : actual.lstatSync(filename),
    readFileSync: (filename, ...rest) => filename === "/usr/lib/os-release" ? 'ID=ubuntu\nVERSION_ID="24.04"\n' : actual.readFileSync(filename, ...rest),
    existsSync: filename => [value.output, value.receiptOutput].includes(filename) ? false : actual.existsSync(filename),
    writeFileSync: (filename, bytes, flags) => { assert.deepEqual(flags, { flag: "wx", mode: 0o600 }); assert.ok([value.output, value.receiptOutput].includes(filename)); writes.set(filename, Buffer.from(bytes)); },
  };
  const deps = { io, environment: {}, argv: [], runtime: { platform: "linux", arch: "arm64", effectiveUid: uid },
    timers: { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} }, load: async () => async config => {
      configs.push(config); assert.equal(config.multipleStatements, false); assert.equal(config.socketPath, value.socket); assert.equal(Object.hasOwn(config, "uri"), false);
      const database = config.database ?? null;
      return { async query({ sql, timeout }, values = []) {
        calls.push({ database, sql, values }); assert.equal(timeout, 30_000);
        if (sql.startsWith("SELECT DATABASE()")) return [[{ schemaName: database, version: "8.0.46-0ubuntu0.24.04.4", datadir: value.datadir,
          socket: value.socket, skipNetworking: 1, lowerCaseTableNames: 0, sqlMode: "STRICT_TRANS_TABLES", eventScheduler: "OFF" }]];
        if (sql.includes("information_schema.plugins")) return [[{ pluginStatus: "DISABLED" }]];
        if (sql.startsWith("SET SESSION")) return [[]];
        const create = /^CREATE DATABASE `(amazon_rehearsal_[a-f0-9]{16}_synthetic)` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci$/.exec(sql);
        if (create) { assert.equal(currentSchema, undefined); currentSchema = create[1]; return [[]]; }
        assert.equal(database, currentSchema);
        if (sql === "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()") return [[]];
        if (count < fullPlan.statements.length) {
          assert.equal(sql, fullPlan.statements[count].sql); count++; if (failDdl) throw Object.assign(new Error(privateError), { code: "ER_REFERENCE_FIXTURE" }); return [[]];
        }
        if (sql.startsWith("SELECT COUNT(*)")) return [[{ rowCount: nonempty ? 1 : 0 }]];
        if (sql === "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME") return [fullPlan.tableNames.map(tableName => ({ tableName }))];
        const show = /^SHOW CREATE TABLE `[^`]+`\.`([^`]+)`$/.exec(sql); if (show) return [[{ Table: show[1], "Create Table": fullPlan.statements.find(item => item.kind === "create-table" && item.tableName === show[1]).sql }]];
        const definition = Object.entries(DDL_CATALOG).find(([, spec]) => spec.sql === sql); assert.ok(definition);
        return [catalogFixture(currentSchema)[definition[0]]];
      }, destroy() { destroyed++; if (failCleanup) throw Object.assign(new Error(privateError), { code: "ER_CLEANUP_FIXTURE" }); } };
    } };
  return { value, deps, calls, configs, writes, expire: () => callback(), count: () => count, destroyed: () => destroyed };
}

test("mock reference executes only reviewed DDL in a fresh isolated schema, captures full catalog and writes an unapproved candidate", async () => {
  const mock = workflow(), receipt = await runPublicSourceReference(mock.value, mock.deps);
  assert.equal(receipt.status, "completed", JSON.stringify(receipt)); assert.equal(mock.count(), fullPlan.statements.length);
  assert.equal(receipt.tableCount, 303); assert.equal(receipt.columnCount, 5487); assert.equal(receipt.foreignKeys, 2);
  assert.equal(receipt.zeroRowTables, 303); assert.equal(receipt.structureContractApproved, false); assert.equal(receipt.publishedContractPath, null);
  assert.equal(receipt.bootstrapRunnerInvoked, false); assert.equal(receipt.ledgerRowsWritten, false); assert.equal(receipt.seedsExecuted, false);
  assert.equal(mock.writes.size, 2); assert.equal(receipt.candidateFileSha256, sha256(mock.writes.get(mock.value.output)));
  assert.equal(mock.calls.some(call => /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|USE)\b/i.test(call.sql)), false);
  assert.equal(mock.destroyed(), 2); assert.equal(receipt.candidateDatabaseUsed, false);
});

test("unavailable source projection refuses before connector loading or any DB action", async () => {
  const mock = workflow(); mock.value.projectionDirectory += "/not-present";
  await assert.rejects(runPublicSourceReference(mock.value, mock.deps));
  assert.equal(mock.configs.length, 0); assert.equal(mock.calls.length, 0); assert.equal(mock.writes.size, 0);
});

test("unsafe inherited config/profile/outputs refuses before loading a connector", async () => {
  for (const change of [m => m.deps.environment.DATABASE_URL = privateError, m => m.deps.environment.MYSQL_PWD = privateError,
    m => m.deps.runtime.platform = "darwin", m => m.value.buildPublicSourceReference = false, m => m.value.output = m.value.receiptOutput]) {
    const mock = workflow(); change(mock); await assert.rejects(runPublicSourceReference(mock.value, mock.deps)); assert.equal(mock.configs.length, 0);
  }
});

test("DDL/nonempty/cleanup/deadline failures retain sanitized receipt and never publish a candidate or retry", async () => {
  for (const flags of [{ failDdl: true }, { nonempty: true }, { failCleanup: true }, { deadline: true }]) {
    const mock = workflow(flags);
    if (flags.deadline) { const load = mock.deps.load; mock.deps.load = async () => { const create = await load(); return async config => {
      const raw = await create(config), query = raw.query; raw.query = async (...args) => { const result = await query(...args); if (mock.count() === 1) mock.expire(); return result; }; return raw;
    }; }; }
    const receipt = await runPublicSourceReference(mock.value, mock.deps);
    assert.equal(receipt.status, "failed"); assert.equal(mock.writes.has(mock.value.output), false); assert.equal(mock.writes.has(mock.value.receiptOutput), true);
    assert.equal(JSON.stringify(receipt).includes(privateError), false); assert.equal(receipt.structureContractApproved, false);
    if (flags.failDdl || flags.deadline) assert.equal(mock.count(), 1);
  }
});

test("main returns a safe nonzero refusal, with no SQL/credential disclosure", async () => {
  const mock = workflow(); mock.deps.environment.DATABASE_URL = privateError; let stdout = "", stderr = "";
  const status = await main(cli(mock.value), { dependencies: mock.deps, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  assert.equal(status, 1); assert.equal(stdout, ""); assert.equal(JSON.parse(stderr).status, "refused_or_failed"); assert.equal(stderr.includes(privateError), false);
});

test("candidate output failure retains a failure receipt and never marks its contract approved", async () => {
  const mock = workflow(), write = mock.deps.io.writeFileSync;
  mock.deps.io.writeFileSync = (filename, ...args) => {
    if (filename === mock.value.output) throw Object.assign(new Error(privateError), { code: "EIO" });
    return write(filename, ...args);
  };
  const receipt = await runPublicSourceReference(mock.value, mock.deps);
  assert.equal(receipt.status, "failed"); assert.equal(receipt.stage, "write_unapproved_candidate");
  assert.equal(receipt.candidateWriteAttempted, true); assert.equal(receipt.structureContractApproved, false);
  assert.equal(mock.writes.has(mock.value.receiptOutput), true); assert.equal(JSON.stringify(receipt).includes(privateError), false);
});
