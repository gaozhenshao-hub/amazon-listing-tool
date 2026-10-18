// Static public-source bytes and small in-memory grammar cases only. No DB/VM.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { exportSourceProjection } from "../integration/sourceProjection.mjs";
import { REPOSITORY_ROOT, loadFreshBootstrapPlan, sha256 } from "./freshBootstrapPlan.mjs";
import { splitPublicStatements, splitDefinitionList, loadFreshReferenceInputs } from "./freshBootstrapReference.mjs";
import { deriveHistoricalColumnOrder, replayPublicColumnOrder } from "./freshBootstrapColumnOrder.mjs";

const splitters = { splitPublicStatements, splitDefinitionList };
function args(sources) {
  const plan = sources.map((sql, index) => ({ fileName: `test_${index}.sql`, sql, checksum: sha256(sql) }));
  return { ...splitters, plan, pins: new Map(plan.map(item => [`drizzle/${item.fileName}`, item.checksum])) };
}
const replay = (...sources) => replayPublicColumnOrder(args(sources));
const code = value => error => error.code === value;

test("import is inert even with inherited production-looking variables", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("./freshBootstrapColumnOrder.mjs", import.meta.url).href)});console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "mysql://not-used.invalid/production" } });
  assert.equal(result.status, 0); assert.equal(result.stdout, "INERT\n"); assert.equal(result.stderr, "");
  const source = fs.readFileSync(new URL("./freshBootstrapColumnOrder.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /mysql2|dotenv|createConnection|applyMigrations|writeFile|readFile|fetch\(/);
});

test("CREATE/ADD/AFTER/FIRST/DROP/MODIFY/CHANGE affect only literal ordered names and retain source proofs", () => {
  const result = replay("CREATE TABLE x (id int, a varchar(8) DEFAULT 'a,b', z text COMMENT 'FIRST; AFTER nope', PRIMARY KEY(id));",
    "ALTER TABLE x ADD b int AFTER a, ADD c int FIRST, ADD d text; ALTER TABLE x MODIFY z longtext AFTER id;",
    "ALTER TABLE x CHANGE COLUMN a renamed varchar(16); ALTER TABLE x DROP COLUMN b; ALTER TABLE x MODIFY d text FIRST;");
  assert.deepEqual(result.tables[0].columns, ["d", "c", "id", "z", "renamed"]);
  assert.equal(result.tables[0].sources.length, 3);
  assert.ok(result.tables[0].sources.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.equal(result.operations.length, 8);
  assert.equal(result.operations.find(item => item.operation === "change").oldColumn, "a");
});

test("type/default/comment changes do not move a column; current declaration order is not substituted", () => {
  const result = replay("CREATE TABLE x (`id` int, `updatedAt` timestamp, `old` text);",
    "ALTER TABLE x ADD COLUMN newest int; ALTER TABLE x MODIFY COLUMN old longtext NULL COMMENT 'not a position: FIRST';");
  assert.deepEqual(result.tables[0].columns, ["id", "updatedAt", "old", "newest"]);
});

test("retired tables, conditional legacy drops and exact CREATE IF NOT EXISTS are explicit not permissive", () => {
  const result = replay("CREATE TABLE x (id int, old text); CREATE TABLE removed (id int);",
    "ALTER TABLE x DROP COLUMN IF EXISTS old; ALTER TABLE x DROP COLUMN IF EXISTS never_present; DROP TABLE removed; CREATE TABLE IF NOT EXISTS x (id int);");
  assert.deepEqual(result.tables.map(item => [item.name, item.columns]), [["x", ["id"]]]);
  assert.ok(result.operations.some(item => item.operation === "conditional-drop-noop"));
  assert.throws(() => replay("CREATE TABLE x (id int); CREATE TABLE x (id int);"), code("COLUMN_ORDER_RECREATE_UNREVIEWED"));
  assert.throws(() => replay("CREATE TABLE x (id int); CREATE TABLE IF NOT EXISTS x (other int);"), code("COLUMN_ORDER_RECREATE_UNREVIEWED"));
});

test("Drizzle statement delimiters are removed only outside leading quoted data", () => {
  const result = replay("CREATE TABLE x (id int);--> statement-breakpoint\nALTER TABLE x ADD note text COMMENT '--> statement-breakpoint; FIRST';");
  assert.deepEqual(result.tables[0].columns, ["id", "note"]);
  assert.throws(() => replay("CREATE TABLE x (id int);--> statement-breakpoint-unknown\nALTER TABLE x ADD note text;"), code("COLUMN_ORDER_BREAKPOINT_INVALID"));
});

test("unknown DDL, invalid positions, duplicate columns and absent references fail closed", () => {
  for (const sql of ["ALTER TABLE x RENAME COLUMN id TO moved", "RENAME TABLE x TO y", "TRUNCATE TABLE x", "CALL unknown()",
    "CREATE VIEW y AS SELECT 1", "PREPARE stmt FROM @sql", "EXECUTE stmt", "CREATE TEMPORARY TABLE x2 AS SELECT 1",
    "ALTER TABLE x ADD COLUMN b int BEFORE id", "ALTER TABLE x ADD COLUMN b int AFTER id FIRST", "ALTER TABLE x ADD COLUMN b int AFTER id EXTRA",
    "ALTER TABLE x ADD COLUMN b unknown_type", "ALTER TABLE x ADD id int", "ALTER TABLE x ADD b int AFTER absent",
    "ALTER TABLE x DROP COLUMN absent", "ALTER TABLE x MODIFY absent text", "ALTER TABLE x CHANGE absent moved int",
    "ALTER TABLE unknown ADD b int", "ALTER TABLE db.x ADD b int", "DROP TABLE db.x"]) {
    assert.throws(() => replay("CREATE TABLE x (id int);", sql), undefined, sql);
  }
  for (const sql of ["CREATE TABLE x AS SELECT 1", "CREATE TABLE x (id int) AS SELECT 1", "CREATE TABLE x (id int FIRST)",
    "CREATE TABLE x (id int,id int)", "CREATE TABLE db.x (id int)", "CREATE TABLE x (id int) DATA DIRECTORY='/tmp'"])
    assert.throws(() => replay(sql), undefined, sql);
});

test("pins bind original bytes, checksums and duplicate filenames; seed text is not executed or treated as DDL", () => {
  const valid = args(["CREATE TABLE x (id int); INSERT INTO x VALUES (1); SET @prompt='DROP TABLE x;'; UPDATE x SET id=2; DELETE FROM x;"]);
  assert.equal(replayPublicColumnOrder(valid).ignoredStatements.length, 4);
  const changedSql = { ...splitters, ...structuredClone({ plan: valid.plan, pins: valid.pins }) }; changedSql.plan[0].sql += " ";
  assert.throws(() => replayPublicColumnOrder(changedSql), code("COLUMN_ORDER_SOURCE_CHANGED"));
  const changedPin = { ...splitters, ...structuredClone({ plan: valid.plan, pins: valid.pins }) }; changedPin.pins.set("drizzle/test_0.sql", "a".repeat(64));
  assert.throws(() => replayPublicColumnOrder(changedPin), code("COLUMN_ORDER_SOURCE_CHANGED"));
  const duplicate = { ...valid, plan: [...valid.plan, valid.plan[0]] };
  assert.throws(() => replayPublicColumnOrder(duplicate), code("COLUMN_ORDER_SOURCE_NAME_INVALID"));
});

test("only the pinned fresh0004 literal index drop is a proved non-column operation", () => {
  const input = args(["CREATE TABLE saihu_product_weekly (id int, asin varchar(64), week_start_date date);",
    "DROP INDEX `idx_sh_asin_week` ON `saihu_product_weekly`; ALTER TABLE saihu_product_weekly MODIFY asin varchar(2000); CREATE INDEX idx_sh_asin_week ON saihu_product_weekly (asin(191),week_start_date);"]);
  input.pins.delete("drizzle/test_1.sql"); input.plan[1].fileName = "bootstrap/0004_current_source_alignment.sql";
  input.pins.set(`drizzle/${input.plan[1].fileName}`, input.plan[1].checksum);
  const result = replayPublicColumnOrder(input);
  assert.deepEqual(result.tables[0].columns, ["id", "asin", "week_start_date"]);
  assert.equal(result.tables[0].sources.length, 2);
  assert.deepEqual(result.ignoredStatements.find(item => item.kind === "reviewed-index-drop"), {
    path: "drizzle/bootstrap/0004_current_source_alignment.sql", statementIndex: 0,
    kind: "reviewed-index-drop", tableName: "saihu_product_weekly", indexName: "idx_sh_asin_week",
  });
  for (const unknown of ["DROP INDEX other ON saihu_product_weekly", "DROP INDEX `idx_sh_asin_week` ON other",
    "DROP INDEX `idx_sh_asin_week` ON `saihu_product_weekly` ALGORITHM=INPLACE", "DROP INDEX IF EXISTS `idx_sh_asin_week` ON `saihu_product_weekly`"]) {
    const altered = { ...input, plan: structuredClone(input.plan), pins: new Map(input.pins) };
    altered.plan[1].sql = unknown; altered.plan[1].checksum = sha256(unknown); altered.pins.set(`drizzle/${altered.plan[1].fileName}`, sha256(unknown));
    assert.throws(() => replayPublicColumnOrder(altered), code("COLUMN_ORDER_INDEX_DROP_UNREVIEWED"));
  }
  assert.throws(() => replay("CREATE TABLE saihu_product_weekly (id int);", "DROP INDEX `idx_sh_asin_week` ON `saihu_product_weekly`;"), code("COLUMN_ORDER_INDEX_DROP_UNREVIEWED"));
  const drift = { ...input, plan: structuredClone(input.plan) }; drift.plan[1].sql += " ";
  assert.throws(() => replayPublicColumnOrder(drift), code("COLUMN_ORDER_SOURCE_CHANGED"));
});

test("fresh-only offsite rebuild contains precisely twelve fixed DROP/CREATE/index triples with public-source pins", () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, "drizzle/bootstrap/0005_offsite_empty_table_alignment.sources.json"), "utf8"));
  const sql = fs.readFileSync(path.join(REPOSITORY_ROOT, evidence.sqlFile), "utf8");
  assert.equal(sha256(sql), evidence.sqlSha256);
  const names = ["off_ai_analysis_logs", "off_attribution_links", "off_campaign_analytics", "off_campaigns", "off_collaborations", "off_content_calendar",
    "off_content_submissions", "off_influencer_scores", "off_influencers", "off_matrix_groups", "off_outreach_messages", "off_social_accounts"];
  assert.deepEqual(evidence.requiredGuard.tableNames, names); assert.equal(evidence.requiredGuard.immediatePreFileZeroRowCountForEveryTable, true);
  assert.equal(evidence.requiredGuard.wholeDatabaseInitiallyEmpty, true); assert.equal(evidence.requiredGuard.noResumeAfterPartialFailure, true);
  for (const item of evidence.sources) assert.equal(sha256(fs.readFileSync(path.join(REPOSITORY_ROOT, item.path))), item.sha256);
  const statements = splitPublicStatements(sql); assert.equal(statements.length, 36);
  assert.deepEqual(statements.slice(0, 12), names.map(name => `DROP TABLE \`${name}\``));
  const indexSource = splitPublicStatements(fs.readFileSync(path.join(REPOSITORY_ROOT, "drizzle/0116_ops_workspace_isolation.sql"), "utf8"));
  for (const [index, name] of names.entries()) {
    const create = statements[12 + index * 2], indexSql = statements[13 + index * 2];
    assert.ok(create.startsWith(`CREATE TABLE \`${name}\` (`));
    assert.equal(sha256(create), evidence.tables[index].createSha256);
    assert.equal(indexSql, `CREATE INDEX \`idx_${name}_workspace\` ON \`${name}\` (\`workspaceId\`)`);
    assert.ok(indexSource.includes(indexSql)); assert.equal(sha256(indexSql), evidence.tables[index].workspaceIndexSha256);
  }
  assert.ok(statements.every(statement => !/^(?:INSERT|UPDATE|DELETE|REPLACE|SET|SELECT)\b|\bIF\s+(?:NOT\s+)?EXISTS\b/i.test(statement)));
});

test("complete 178-file public plan accounts for 302 tables and every historical column operation without DB", () => {
  const bundle = loadFreshBootstrapPlan();
  const result = replayPublicColumnOrder({ ...splitters, plan: bundle.plan, pins: new Map(bundle.manifest.sources.map(item => [item.path, item.sha256])) });
  assert.deepEqual(result.tables.map(item => item.name).sort(), [...bundle.manifest.requiredBusinessTables].sort());
  assert.equal(bundle.plan.length, 178); assert.equal(result.tables.length, 302); assert.equal(result.operations.length, 1059);
  assert.equal(result.tables.reduce((count, item) => count + item.columns.length, 0), 5477);
  const table = name => result.tables.find(item => item.name === name);
  assert.deepEqual(table("listings").columns.slice(-3), ["itemHighlights", "itemHighlightsCn", "agentRunId"]);
  assert.deepEqual(table("image_workflow_sessions").columns.slice(-8), ["step5RunSegments", "step5RunFailedGroup", "step5RunFailedModule",
    "step0AiResult", "step0UserEdit", "step0Confirmed", "agentRunId", "step5DesignerUploads"]);
  assert.equal(table("projects").columns.at(-1), "workspaceId");
  assert.equal(table("ad_campaign_reports").columns.at(-1), "workspaceId");
  assert.equal(table("ad_dsp_reports").columns[table("ad_dsp_reports").columns.indexOf("upload_id") + 1], "product_id");
  assert.deepEqual(table("keywords").columns.slice(-3), ["translation_cn", "is_ac_recommended", "skip_semantic_filter"]);
  assert.ok(!result.tables.some(item => item.name === "imageAnalyses"));
  assert.equal(table("ops_inventory_planning_versions").columns[5], "inventory_planning_version_status");
  assert.ok(table("ops_replenishment_plans").columns.includes("replenishment_plan_status"));
  assert.deepEqual(table("off_influencers").columns.slice(0, 4), ["workspaceId", "id", "user_id", "platform"]);
});

test("production entry refuses missing table sets and plan drift before replay", () => {
  const bundle = loadFreshBootstrapPlan();
  assert.throws(() => deriveHistoricalColumnOrder({ ...splitters, bundle, expectedColumns: {} }), code("COLUMN_ORDER_EXPECTED_TABLES_INVALID"));
  const expectedColumns = Object.fromEntries(bundle.manifest.requiredBusinessTables.map(name => [name, ["id"]]));
  const invalid = structuredClone(bundle); invalid.plan.pop();
  assert.throws(() => deriveHistoricalColumnOrder({ ...splitters, bundle: invalid, expectedColumns }), code("COLUMN_ORDER_BUNDLE_INVALID"));
  invalid.plan.push(bundle.plan.at(-1)); invalid.planSha256 = "a".repeat(64);
  assert.throws(() => deriveHistoricalColumnOrder({ ...splitters, bundle: invalid, expectedColumns }), code("COLUMN_ORDER_PLAN_CHANGED"));
});

test("reviewed current-source historical base matches all 5477 business fields without adopting dedicated tables, and refuses any missing or extra field", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amazon-public-ordinals-test.")));
  const projectionDirectory = path.join(folder, "projection");
  await exportSourceProjection({ repoRoot: REPOSITORY_ROOT, outputDirectory: projectionDirectory });
  const reviewed = loadFreshReferenceInputs({ projectionDirectory });
  const bundle = reviewed.input.bundle, projection = reviewed.input.projectionSql;
  assert.equal(reviewed.proof.approvedForExecution, false);
  assert.equal(reviewed.proof.currentBootstrapSourcesSha256, loadFreshBootstrapPlan().sourcesSha256);
  const offsite = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, "drizzle/bootstrap/0005_offsite_empty_table_alignment.sources.json"), "utf8"));
  assert.equal(sha256(projection), offsite.projection.sqlSha256);
  for (const table of offsite.tables) {
    const create = splitPublicStatements(projection).find(sql => sql.startsWith(`CREATE TABLE \`${table.name}\` (`));
    assert.equal(sha256(create), table.createSha256);
  }
  const columns = sql => [...sql.matchAll(/^\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(?:tinyint|smallint|int|bigint|varchar|char|text|longtext|mediumtext|json|enum|decimal|float|double|date|datetime|timestamp|boolean)\b/gmi)].map(match => match[1]);
  const expectedColumns = Object.fromEntries(splitPublicStatements(projection).filter(sql => sql.startsWith("CREATE TABLE"))
    .map(sql => [sql.match(/^CREATE TABLE `([^`]+)`/)[1], columns(sql)]));
  const config = JSON.parse(fs.readFileSync(new URL("./freshBootstrapReference.sources.json", import.meta.url), "utf8"));
  for (const entry of config.rawTableSources) for (const table of entry.tables) {
    const create = splitPublicStatements(fs.readFileSync(path.join(REPOSITORY_ROOT, entry.path), "utf8"))
      .find(sql => new RegExp(`^CREATE TABLE(?: IF NOT EXISTS)? \x60?${table}\x60?\\s*\\(`).test(sql));
    assert.ok(create); expectedColumns[table] = columns(create);
  }
  const result = deriveHistoricalColumnOrder({ ...splitters, bundle, expectedColumns });
  assert.equal(result.tables.length, 302); assert.equal(result.tables.reduce((count, item) => count + item.columns.length, 0), 5477);
  assert.ok(result.changedOrderTableNames.length > 140); assert.equal(result.databaseConnected, false); assert.equal(result.sqlExecuted, false);
  const omitted = structuredClone(expectedColumns); omitted.execution_reviews = omitted.execution_reviews.filter(name => name !== "target_week_label");
  assert.throws(() => deriveHistoricalColumnOrder({ ...splitters, bundle, expectedColumns: omitted }), error => {
    assert.equal(error.code, "COLUMN_ORDER_SOURCE_COLUMN_SET_MISMATCH"); assert.equal(error.tableName, "execution_reviews");
    assert.deepEqual(error.missingFromCurrentSource, ["target_week_label"]); return true;
  });
  const extra = structuredClone(expectedColumns); extra.execution_reviews.push("never_declared");
  assert.throws(() => deriveHistoricalColumnOrder({ ...splitters, bundle, expectedColumns: extra }), error => {
    assert.equal(error.code, "COLUMN_ORDER_SOURCE_COLUMN_SET_MISMATCH"); assert.deepEqual(error.missingFromHistorical, ["never_declared"]); return true;
  });
});
