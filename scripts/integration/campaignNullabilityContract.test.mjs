// Public source pins + wholly synthetic catalog fixtures; no DB or private data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { DDL_CATALOG } from "./exportProductionDdl.mjs";
import { CANDIDATE_SQL, COLUMN_CONTRACTS, SOURCE_EVIDENCE_PINS, TABLE_NAME,
  planCampaignNullability, verifyCampaignNullabilityTransition } from "./campaignNullabilityContract.mjs";

const options = { scope: "isolated-local-only", defaultPolicy: "align-null-default" };
const schema = "amazon_rehearsal_0123456789abcdef_synthetic";
const hash = value => createHash("sha256").update(value).digest("hex");
const jhash = value => hash(JSON.stringify(value));
const clone = value => structuredClone(value);
const code = expected => error => error.code === expected && error.message === expected;
const row = (name, values) => ({ ...Object.fromEntries(DDL_CATALOG[name].fields.map(field => [field, null])), ...values });
const names = ["workspaceId", "id", "user_id", "profile_id", "source_store_id", "country", "report_date", "ad_type", "campaign_id",
  "campaign_name", "campaign_status", "bidding_strategy", "budget", "currency", "impressions", "clicks", "spend", "sales", "orders",
  "source_batch_id", "source_row_hash", "source_payload_hash", "version", "created_at", "updated_at"];

function fixture() {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(name => [name, []]));
  catalog.schema = [row("schema", { schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_bin", defaultEncryption: "NO" })];
  catalog.tables = [TABLE_NAME, "unrelated"].map(tableName => row("tables", { tableName, tableType: "BASE TABLE", engine: "InnoDB",
    version: 10, rowFormat: "Dynamic", autoIncrement: "42", collationName: "utf8mb4_bin", createOptions: "", tableComment: "synthetic-table-comment" }));
  catalog.columns = names.map((columnName, index) => {
    const metric = COLUMN_CONTRACTS.find(column => column.name === columnName), dataType = metric?.dataType ?? "int";
    return row("columns", { tableName: TABLE_NAME, columnName, ordinalPosition: index + 1, columnDefault: metric?.defaultValue ?? "0",
      isNullable: "NO", dataType, columnType: metric?.columnType ?? "int", numericPrecision: dataType === "bigint" ? "19" : dataType === "int" ? "10" : "14",
      numericScale: dataType === "decimal" ? "2" : "0", columnKey: "", extra: "", columnComment: "", generationExpression: "" });
  });
  catalog.columns.push(row("columns", { tableName: "unrelated", columnName: "note", ordinalPosition: 1, columnDefault: "synthetic-default",
    isNullable: "YES", dataType: "varchar", columnType: "varchar(60)", characterMaximumLength: 60, characterOctetLength: 240,
    characterSetName: "utf8mb4", collationName: "utf8mb4_bin", columnKey: "", extra: "", columnComment: "synthetic-comment", generationExpression: "" }));
  catalog.indexes = [row("indexes", { tableName: TABLE_NAME, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A",
    nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES" })];
  catalog.constraints = [row("constraints", { tableName: TABLE_NAME, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" })];
  catalog.keyColumns = [row("keyColumns", { tableName: TABLE_NAME, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1 })];
  return catalog;
}

function fulfilled(before = fixture()) {
  const after = clone(before);
  for (const column of after.columns) if (column.tableName === TABLE_NAME && COLUMN_CONTRACTS.some(metric => metric.name === column.columnName)) {
    column.isNullable = "YES"; column.columnDefault = null;
  }
  return after;
}

const metric = (catalog, name = "impressions") => catalog.columns.find(column => column.tableName === TABLE_NAME && column.columnName === name);

test("contract import is inert and only depends on crypto/util; public evidence source pins remain unchanged", () => {
  const moduleUrl = new URL("./campaignNullabilityContract.mjs", import.meta.url);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl.href)}); console.log('INERT')`],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", DATABASE_URL: "mysql://must-not-connect", MYSQL_HOST: "must-not-connect" } });
  assert.equal(child.status, 0); assert.equal(child.stdout, "INERT\n"); assert.equal(child.stderr, "");
  const source = fs.readFileSync(moduleUrl, "utf8");
  assert.deepEqual([...source.matchAll(/^import .+ from "([^"]+)";/gm)].map(match => match[1]), ["node:crypto", "node:util"]);
  assert.doesNotMatch(source, /\b(?:process\.env|import\(|require\(|fetch\(|createConnection|execute\(|query\()\b/);
  for (const [file, expected] of Object.entries(SOURCE_EVIDENCE_PINS)) assert.equal(hash(fs.readFileSync(new URL(`../../${file}`, import.meta.url))), expected, file);
  assert.equal(Object.isFrozen(SOURCE_EVIDENCE_PINS), true); assert.equal(Object.isFrozen(COLUMN_CONTRACTS), true);
  assert.ok(COLUMN_CONTRACTS.every(Object.isFrozen));
});

test("explicit isolated-local scope and exact semantic policy are mandatory", () => {
  for (const value of [{}, { scope: "isolated-local-only" }, { defaultPolicy: "align-null-default" },
    { scope: "production", defaultPolicy: "align-null-default" }, { scope: "isolated-local-only", defaultPolicy: "preserve-zero" }]) {
    assert.throws(() => planCampaignNullability(fixture(), value), code("NULLABILITY_EXPLICIT_LOCAL_POLICY_REQUIRED"));
  }
  assert.throws(() => planCampaignNullability(fixture()), code("NULLABILITY_EXPLICIT_LOCAL_POLICY_REQUIRED"));
});

test("all five reviewed NOT NULL zero defaults produce one fixed forward ALTER with explicit NULL defaults", () => {
  const before = fixture(), preserved = clone(before), candidate = planCampaignNullability(before, options);
  assert.equal(candidate.action, "alter"); assert.equal(candidate.sql, CANDIDATE_SQL); assert.equal(candidate.sqlSha256, hash(CANDIDATE_SQL));
  assert.equal(candidate.defaultPolicy, "align-null-default"); assert.deepEqual(candidate.allowedFieldChanges, ["isNullable", "columnDefault"]);
  assert.deepEqual(candidate.columnNames, ["impressions", "clicks", "spend", "sales", "orders"]);
  assert.equal(candidate.changes.length, 5); assert.equal(candidate.beforeCatalogSha256, jhash(before));
  assert.equal(candidate.expectedAfterCatalogSha256, jhash(fulfilled(before))); assert.deepEqual(before, preserved);
  assert.deepEqual(candidate.changes.map(change => change.before.columnDefault), ["0", "0", "0.00", "0.00", "0"]);
  assert.ok(candidate.changes.every(change => change.before.isNullable === "NO" && change.after.isNullable === "YES" && change.after.columnDefault === null));
  assert.equal(CANDIDATE_SQL, "ALTER TABLE `ops_ad_mcp_campaign_daily_facts`\n  MODIFY COLUMN `impressions` bigint NULL DEFAULT NULL,\n  MODIFY COLUMN `clicks` bigint NULL DEFAULT NULL,\n  MODIFY COLUMN `spend` decimal(14,2) NULL DEFAULT NULL,\n  MODIFY COLUMN `sales` decimal(14,2) NULL DEFAULT NULL,\n  MODIFY COLUMN `orders` int NULL DEFAULT NULL;");
  assert.equal((CANDIDATE_SQL.match(/MODIFY COLUMN/g) ?? []).length, 5); assert.equal((CANDIDATE_SQL.match(/;/g) ?? []).length, 1);
  assert.doesNotMatch(CANDIDATE_SQL, /amz_listing|\b(?:CREATE|DROP|INSERT|UPDATE|DELETE|INDEX|FOREIGN|FIRST|AFTER)\b/i);
});

test("candidate records real default semantic change and never grants migration/ledger/production authority", () => {
  const candidate = planCampaignNullability(fixture(), options);
  assert.match(candidate.defaultSemantics, /Explicit semantic change: known zero defaults become NULL defaults/);
  assert.match(candidate.defaultSemantics, /Historical 0196 is reference only, not replayed/);
  assert.equal(candidate.kind, "local-forward-nullability-candidate-not-registered-migration");
  for (const field of ["productionApproved", "registeredMigration", "historicalSqlChanged", "ledgerWriteAllowed"]) assert.equal(candidate[field], false);
});

test("only all five already nullable with NULL defaults are a no-op, and no-op verifies without changes", () => {
  const before = fulfilled(), candidate = planCampaignNullability(before, options);
  assert.equal(candidate.action, "noop"); assert.equal(candidate.sql, null); assert.equal(candidate.sqlSha256, null); assert.deepEqual(candidate.changes, []);
  assert.equal(candidate.beforeCatalogSha256, candidate.expectedAfterCatalogSha256);
  const result = verifyCampaignNullabilityTransition(before, clone(before), candidate, options);
  assert.equal(result.verified, true); assert.equal(result.changedColumns, 0); assert.equal(result.action, "noop");
});

test("mixed original and satisfied states fail closed rather than generating a partial repair", () => {
  for (const name of COLUMN_CONTRACTS.map(column => column.name)) {
    const before = fixture(); metric(before, name).isNullable = "YES"; metric(before, name).columnDefault = null;
    assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_PARTIAL_STATE_REFUSED"));
  }
});

test("wrong original/default pairing is rejected including nullable zero and NOT NULL null", () => {
  for (const column of COLUMN_CONTRACTS) for (const values of [
    { isNullable: "NO", columnDefault: null }, { isNullable: "YES", columnDefault: column.defaultValue },
    { isNullable: "NO", columnDefault: "1" }, { isNullable: "NO", columnDefault: 0 }, { isNullable: "NO", columnDefault: "NULL" },
    { isNullable: "YES", columnDefault: "" }, { isNullable: "MAYBE", columnDefault: null },
  ]) {
    const before = fixture(); Object.assign(metric(before, column.name), values);
    assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_COLUMN_CONTRACT_MISMATCH"));
  }
});

test("each metric type, signedness, position and companion metadata is exact", () => {
  const mutations = { columnType: "bigint unsigned", dataType: "varchar", ordinalPosition: 999, numericPrecision: 99, numericScale: 9,
    characterMaximumLength: 10, characterOctetLength: 40, datetimePrecision: 6, srsId: 4326, characterSetName: "utf8mb4", collationName: "utf8mb4_bin",
    extra: "INVISIBLE", columnComment: "synthetic-sensitive-comment", columnKey: "MUL", generationExpression: "1 + 1" };
  for (const name of COLUMN_CONTRACTS.map(column => column.name)) for (const [field, value] of Object.entries(mutations)) {
    const before = fixture(); metric(before, name)[field] = value;
    assert.throws(() => planCampaignNullability(before, options), error => {
      assert.match(error.code, /^NULLABILITY_(?:COLUMN_CONTRACT_MISMATCH|COLUMN_ORDER_INVALID)$/);
      assert.equal(error.message, error.code); assert.doesNotMatch(error.message, /sensitive/); return true;
    });
  }
  const before = fixture(); metric(before, "impressions").columnType = "int";
  assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_COLUMN_CONTRACT_MISMATCH"));
});

test("schema must be a fresh synthetic name and target must be one InnoDB base table", () => {
  for (const name of ["amz_listing", "amazon_rehearsal_0123456789abcdef_restored", "amazon_rehearsal_01234_synthetic", "x` ; DROP DATABASE x"]) {
    const before = fixture(); before.schema[0].schemaName = name;
    assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_ISOLATED_SCHEMA_REQUIRED"));
  }
  for (const mutate of [before => before.tables[0].engine = "MyISAM", before => before.tables[0].tableType = "VIEW",
    before => before.tables.splice(0, 1), before => before.tables.push(clone(before.tables[0])), before => before.schema.push(clone(before.schema[0]))]) {
    const before = fixture(); mutate(before); assert.throws(() => planCampaignNullability(before, options));
  }
});

test("complete fixed catalog projection is required; missing/extra/unsupported fields cannot be hashed away", () => {
  for (const collection of Object.keys(DDL_CATALOG)) {
    const before = fixture(); delete before[collection];
    assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_FULL_CATALOG_REQUIRED"));
  }
  for (const mutate of [before => before.extra = [], before => before.indexes = {},
    before => delete metric(before).numericPrecision, before => metric(before).extraField = "hidden",
    before => metric(before).numericPrecision = undefined, before => metric(before).numericPrecision = NaN,
    before => metric(before).numericPrecision = Infinity, before => metric(before).columnComment = { hidden: true },
    before => before.columns.push(null), before => before.tables[0].tableComment = () => "hidden",
    before => before.columns.push(row("columns", { tableName: "not-in-catalog" }))]) {
    const before = fixture(); mutate(before); assert.throws(() => planCampaignNullability(before, options));
  }
  // The fixture factory uses every exporter field, including optional nulls;
  // successful planning binds the pure module's copied shape to DDL_CATALOG.
  assert.equal(planCampaignNullability(fixture(), options).action, "alter");
});

test("duplicate/missing/reordered metric columns cannot pass as the five-column source", () => {
  for (const mutate of [before => before.columns.push(clone(metric(before))),
    before => before.columns.splice(before.columns.indexOf(metric(before)), 1),
    before => metric(before).columnName = "impressions_changed", before => metric(before).ordinalPosition = 16,
    before => before.columns = before.columns.filter(column => column.tableName !== TABLE_NAME || Number(column.ordinalPosition) < 19)]) {
    const before = fixture(); mutate(before); assert.throws(() => planCampaignNullability(before, options));
  }
  const before = fixture(), impressions = metric(before), clicks = metric(before, "clicks");
  [impressions.ordinalPosition, clicks.ordinalPosition] = [clicks.ordinalPosition, impressions.ordinalPosition];
  assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_COLUMN_CONTRACT_MISMATCH"));
});

test("direct and functional index dependencies, inbound/outbound keys, checks and triggers fail closed", () => {
  for (const name of COLUMN_CONTRACTS.map(column => column.name)) {
    const before = fixture(); before.indexes[0].columnName = name;
    assert.throws(() => planCampaignNullability(before, options), code("NULLABILITY_INDEX_DEPENDENCY_UNREVIEWED"));
    const key = fixture(); key.keyColumns[0].columnName = name;
    assert.throws(() => planCampaignNullability(key, options), code("NULLABILITY_KEY_DEPENDENCY_UNREVIEWED"));
    const referenced = fixture(); referenced.keyColumns.push(row("keyColumns", { tableName: "unrelated", columnName: "note",
      referencedTableSchema: schema, referencedTableName: TABLE_NAME, referencedColumnName: name }));
    assert.throws(() => planCampaignNullability(referenced, options), code("NULLABILITY_KEY_DEPENDENCY_UNREVIEWED"));
  }
  const functional = fixture(); functional.indexes[0].expression = "(`clicks` + 1)";
  assert.throws(() => planCampaignNullability(functional, options), code("NULLABILITY_INDEX_DEPENDENCY_UNREVIEWED"));
  const checks = fixture(); checks.checks.push(row("checks", { tableName: TABLE_NAME, constraintName: "positive", checkClause: "clicks >= 0" }));
  assert.throws(() => planCampaignNullability(checks, options), code("NULLABILITY_CHECK_DEPENDENCY_UNREVIEWED"));
  const triggers = fixture(); triggers.triggers.push(row("triggers", { triggerName: "t", tableName: TABLE_NAME }));
  assert.throws(() => planCampaignNullability(triggers, options), code("NULLABILITY_TRIGGER_DEPENDENCY_UNREVIEWED"));
});

test("transition verifies exactly two semantic fields on five columns and never mutates either catalog", () => {
  const before = fixture(), after = fulfilled(before), originalBefore = clone(before), originalAfter = clone(after);
  const candidate = planCampaignNullability(before, options), result = verifyCampaignNullabilityTransition(before, after, candidate, options);
  assert.equal(result.verified, true); assert.equal(result.changedColumns, 5); assert.equal(result.allOtherCatalogFieldsEqual, true);
  assert.equal(result.alignedNullDefaults, true); assert.deepEqual(result.allowedFieldChanges, ["isNullable", "columnDefault"]);
  assert.equal(result.productionApproved, false); assert.equal(result.ledgerWriteAllowed, false);
  assert.equal(result.beforeCatalogSha256, jhash(before)); assert.equal(result.afterCatalogSha256, jhash(after));
  assert.deepEqual(before, originalBefore); assert.deepEqual(after, originalAfter);
});

test("numeric catalog metadata may arrive as numbers or strings but its captured representation is preserved", () => {
  const before = fixture();
  for (const column of COLUMN_CONTRACTS) {
    const actual = metric(before, column.name);
    actual.numericPrecision = Number(actual.numericPrecision); actual.numericScale = Number(actual.numericScale);
  }
  const candidate = planCampaignNullability(before, options), after = fulfilled(before);
  assert.equal(verifyCampaignNullabilityTransition(before, after, candidate, options).verified, true);
  metric(after).numericPrecision = String(metric(after).numericPrecision);
  assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
});

test("changing only nullable, or failing to update even one column, is not a successful repair", () => {
  const before = fixture(), candidate = planCampaignNullability(before, options);
  const onlyNullable = clone(before);
  for (const column of COLUMN_CONTRACTS) metric(onlyNullable, column.name).isNullable = "YES";
  assert.throws(() => verifyCampaignNullabilityTransition(before, onlyNullable, candidate, options), code("NULLABILITY_COLUMN_CONTRACT_MISMATCH"));
  for (const column of COLUMN_CONTRACTS) {
    const after = fulfilled(before); Object.assign(metric(after, column.name), { isNullable: "NO", columnDefault: column.defaultValue });
    assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
  }
  assert.throws(() => verifyCampaignNullabilityTransition(before, before, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
});

test("candidate SQL, defaults, hashes, policy and authority cannot be tampered", () => {
  const before = fixture(), after = fulfilled(before), expected = planCampaignNullability(before, options);
  for (const mutate of [candidate => candidate.sql += " DROP TABLE unrelated;", candidate => candidate.sqlSha256 = hash("other"),
    candidate => candidate.action = "noop", candidate => candidate.defaultPolicy = "preserve-zero", candidate => candidate.productionApproved = true,
    candidate => candidate.ledgerWriteAllowed = true, candidate => candidate.registeredMigration = true, candidate => candidate.historicalSqlChanged = true,
    candidate => candidate.beforeCatalogSha256 = jhash(after), candidate => candidate.expectedAfterCatalogSha256 = jhash(before),
    candidate => candidate.changes[0].after.columnDefault = "0", candidate => candidate.columnNames.pop(), candidate => candidate.extra = true]) {
    const candidate = clone(expected); mutate(candidate);
    assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_CANDIDATE_CHANGED"));
  }
});

test("all other table and column attributes remain exact, including defaults/comments and autoIncrement", () => {
  const before = fixture(), candidate = planCampaignNullability(before, options);
  for (const mutate of [after => after.tables[0].autoIncrement = "43", after => after.tables[0].collationName = "utf8mb4_general_ci",
    after => after.tables[1].tableComment = "changed", after => after.columns[0].columnDefault = "2",
    after => after.columns[0].columnType = "bigint", after => after.columns[0].columnComment = "changed",
    after => after.columns.at(-1).columnDefault = "changed", after => after.columns.at(-1).collationName = "utf8mb4_general_ci",
    after => after.schema[0].collationName = "utf8mb4_general_ci", after => after.tables.push(row("tables", { tableName: "extra" })),
    after => after.columns[0].isNullable = "YES", after => after.columns[0].extra = "INVISIBLE"]) {
    const after = fulfilled(before); mutate(after);
    assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
  }
});

test("index definitions and every other catalog collection are unchanged after repair", () => {
  const before = fixture(), candidate = planCampaignNullability(before, options);
  for (const [field, value] of Object.entries({ nonUnique: 1, sequence: 2, direction: "D", prefixLength: 10, visible: "NO",
    indexName: "changed", indexType: "HASH", indexComment: "changed" })) {
    const after = fulfilled(before); after.indexes[0][field] = value;
    assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
  }
  for (const collection of ["constraints", "keyColumns", "foreignKeys", "checks", "partitions", "views", "triggers", "routines", "events"]) {
    const after = fulfilled(before);
    after[collection].push(row(collection, DDL_CATALOG[collection].fields.includes("tableName") ? { tableName: "unrelated" } : {}));
    assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
  }
});

test("no-op cannot hide unrelated drift or re-enable zero defaults", () => {
  const before = fulfilled(), candidate = planCampaignNullability(before, options), after = clone(before);
  after.tables[1].autoIncrement = "100";
  assert.throws(() => verifyCampaignNullabilityTransition(before, after, candidate, options), code("NULLABILITY_UNAPPROVED_CATALOG_CHANGE"));
  const reverted = clone(before); metric(reverted).columnDefault = "0";
  assert.throws(() => verifyCampaignNullabilityTransition(before, reverted, candidate, options), code("NULLABILITY_COLUMN_CONTRACT_MISMATCH"));
});
